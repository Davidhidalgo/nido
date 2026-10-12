import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
const base = await mkdtemp(join(tmpdir(), "nido-install-test-"));
const cli = join(root, ".runtime/openclaw/node_modules/openclaw/openclaw.mjs");
const configPath = join(base, "openclaw.json");
const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", resolve);
});
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const env = {
  ...process.env,
  OPENCLAW_STATE_DIR: base,
  OPENCLAW_CONFIG_PATH: configPath,
  OPENCLAW_SKIP_CHANNELS: "1",
  npm_config_cache: join(root, ".cache/npm"),
  npm_config_offline: "true",
};
delete env.OPENCLAW_GATEWAY_TOKEN;
const run = (args) =>
  execFileSync(process.execPath, [cli, ...args], {
    env,
    cwd: base,
    encoding: "utf8",
    timeout: 120000,
  });
const rpc = (method, params = {}) =>
  JSON.parse(run(["gateway", "call", method, "--params", JSON.stringify(params), "--json"]));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const original = {
  discovery: { mdns: { mode: "off" } },
  logging: { file: join(base, "gateway.log") },
  gateway: {
    mode: "local",
    bind: "loopback",
    port,
    auth: { mode: "token", token: "nido-install-fixture-secret" },
    controlUi: { experimental: { customPlugins: true } },
  },
  agents: {
    entries: {
      existing: {
        name: "Asistente de prueba",
        model: "openai/example-model",
        workspace: join(base, "existing-workspace"),
      },
    },
  },
  tools: { deny: ["browser"] },
  plugins: { slots: { memory: "none" } },
};
let child,
  log = "";
const stop = async () => {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise((resolve) => child.once("exit", resolve));
  const signal = (value) => {
    try {
      process.kill(-child.pid, value);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  signal("SIGTERM");
  const timer = setTimeout(() => signal("SIGKILL"), 5000);
  try {
    await ended;
  } finally {
    clearTimeout(timer);
  }
};
process.once("SIGINT", () => void stop());
try {
  await mkdir(original.agents.entries.existing.workspace);
  await writeFile(configPath, JSON.stringify(original), { mode: 0o600 });
  const pkg = JSON.parse(
    await readFile(join(root, "integrations/nido-family/package.json"), "utf8"),
  );
  const archive = join(root, "release", `${pkg.name}-${pkg.version}.tgz`);
  console.log("Instalando el paquete en un OpenClaw temporal con un agente existente…");
  console.log(run(["plugins", "install", archive, "--force", "--accept-capabilities"]));
  const installedRoot = join(base, "extensions/nido-family");
  const installedPackage = JSON.parse(await readFile(join(installedRoot, "package.json"), "utf8"));
  const installedManifest = JSON.parse(
    await readFile(join(installedRoot, "openclaw.plugin.json"), "utf8"),
  );
  assert.equal(installedPackage.name, pkg.name);
  assert.equal(installedPackage.version, pkg.version);
  assert.equal(installedManifest.version, pkg.version);
  run(["config", "validate"]);
  child = spawn(process.execPath, [cli, "gateway", "run"], {
    cwd: base,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    log = (log + chunk.toString()).slice(-18000);
  });
  child.stderr.on("data", (chunk) => {
    log = (log + chunk.toString()).slice(-18000);
  });
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (child.exitCode !== null) break;
    try {
      if (
        (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(300) })).ok
      ) {
        ready = true;
        break;
      }
    } catch {
      /* startup */
    }
    await delay(500);
  }
  if (!ready) throw new Error("No arrancó el Gateway de instalación.");
  const status = rpc("nido.setup.status");
  assert.equal(status.configured, false);
  assert.equal(status.googleConnected, false);
  if (process.argv.includes("--ui")) {
    console.log(
      `UI de instalación ficticia: http://127.0.0.1:${port}/#token=nido-install-fixture-secret`,
    );
    console.log("Pulsa Enter después de revisar la UI para continuar las comprobaciones.");
    process.stdin.resume();
    await new Promise((resolve) => process.stdin.once("data", resolve));
    process.stdin.pause();
  }
  const latest = rpc("nido.setup.status");
  const input = {
    version: latest.version,
    requestId: "fixture-install-operation",
    modelAgentId: "existing",
    mode: "demo",
    timeZone: "Europe/Madrid",
    members: ["Persona ficticia"],
    mealTimes: { lunch: "13:00", dinner: "19:00", durationMinutes: 60 },
    writesEnabled: true,
  };
  const preview = rpc("nido.setup.preview", input);
  assert.equal(preview.mode, "demo");
  assert.equal(rpc("nido.setup.status").configured, latest.configured);
  rpc("nido.setup.apply", input);
  // The Gateway may reload config; reconcile by reading instead of sending a second mutation.
  let applied;
  for (let i = 0; i < 20; i++) {
    try {
      applied = rpc("nido.setup.status");
      if (applied.requestId === input.requestId) break;
    } catch {
      /* reload */
    }
    await delay(500);
  }
  assert.equal(applied.requestId, input.requestId);
  assert.equal(applied.mode, "demo");
  const saved = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(saved.agents.entries.existing, original.agents.entries.existing);
  assert.deepEqual(saved.gateway, original.gateway);
  assert.deepEqual(saved.tools, original.tools);
  assert.equal(saved.agents.defaults.systemAgent.agentId, "existing");
  const { resolveAgentRoute } = await import(
    pathToFileURL(join(root, ".runtime/openclaw/node_modules/openclaw/dist/plugin-sdk/routing.js"))
  );
  const route = (cfg) =>
    resolveAgentRoute({
      cfg,
      channel: "telegram",
      accountId: "default",
      peer: { kind: "direct", id: "fixture-peer" },
    }).agentId;
  assert.equal(route(saved), route(original));
  assert.equal(saved.agents.entries.nido.model, "openai/example-model");
  assert.deepEqual(saved.agents.entries.nido.subagents.allowAgents, ["menu", "agenda"]);
  assert.equal(saved.plugins.entries["nido-family"].config.dataDir, join(base, "nido-family/demo"));
  assert.equal(rpc("nido.calendars.catalog").mode, "demo");
  const before = await readFile(configPath, "utf8");
  assert.equal(rpc("nido.setup.apply", input).applied, true);
  assert.equal(await readFile(configPath, "utf8"), before);
  const invoke = async (agentId, tool, args = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}/tools/invoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${original.gateway.auth.token}`,
      },
      body: JSON.stringify({
        agentId,
        sessionKey: `agent:${agentId}:install-fixture`,
        tool,
        args,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    return { status: response.status, body: await response.json() };
  };
  assert.match(JSON.stringify((await invoke("nido", "nido_calendar_create")).body), /FORBIDDEN/);
  assert.equal((await invoke("agenda", "nido_preferences_set")).status, 404);
  assert.equal((await invoke("menu", "exec", { command: "should-not-run" })).status, 404);
  const event = {
    summary: "Sopa de prueba",
    start: { dateTime: "2099-01-01T19:00:00+01:00", timeZone: "Europe/Madrid" },
    end: { dateTime: "2099-01-01T20:00:00+01:00", timeZone: "Europe/Madrid" },
  };
  const blocked = await invoke("menu", "nido_calendar_create", { calendar: "family", event });
  assert.equal(blocked.body.result?.details?.error, "FORBIDDEN");
  const created = await invoke("menu", "nido_calendar_create", { calendar: "menu", event });
  assert.ok(created.body.result?.details?.result?.id, JSON.stringify(created.body));
  const earlierEvent = {
    summary: "Arroz de prueba",
    start: { dateTime: "2099-01-01T12:17:00+01:00", timeZone: "Europe/Madrid" },
    end: { dateTime: "2099-01-01T13:17:00+01:00", timeZone: "Europe/Madrid" },
  };
  const earlier = await invoke("menu", "nido_calendar_create", {
    calendar: "menu",
    event: earlierEvent,
  });
  const firstMeal = earlier.body.result?.details?.result;
  assert.ok(firstMeal?.id, JSON.stringify(earlier.body));
  const third = await invoke("menu", "nido_calendar_create", {
    calendar: "menu",
    event: {
      ...earlierEvent,
      start: { ...earlierEvent.start, dateTime: "2099-01-01T12:30:00+01:00" },
    },
  });
  assert.equal(third.body.result?.details?.error, "OCCUPIED");
  const edited = await invoke("menu", "nido_calendar_update", {
    calendar: "menu",
    id: firstMeal.id,
    etag: firstMeal.etag,
    patch: { summary: "Lentejas de prueba" },
  });
  assert.deepEqual(edited.body.result?.details?.result?.start, earlierEvent.start);
  const listed = await invoke("menu", "nido_calendar_list", {
    calendar: "menu",
    from: "2099-01-01T00:00:00+01:00",
    to: "2099-01-02T00:00:00+01:00",
  });
  const meals = listed.body.result?.details?.result;
  assert.equal(meals?.length, 2, JSON.stringify(listed.body));
  const { note4Home } = await import(pathToFileURL(join(installedRoot, "dist/note4-home.js")));
  const installedConfig = saved.plugins.entries["nido-family"].config;
  const home = await note4Home(
    { list: async (id) => (id === installedConfig.menuCalendarId ? meals : []) },
    { ...installedConfig, mealTimes: { lunch: "14:30", dinner: "21:30", durationMinutes: 60 } },
    "2099-01-01",
    new Date("2099-01-01T12:00:00Z"),
  );
  const day = home.days.find((value) => value.date === "2099-01-01");
  assert.equal(day.lunch, "Lentejas de prueba");
  assert.equal(day.dinner, "Sopa de prueba");
  console.log(
    `Plugin ${pkg.version}: installed metadata, chronological menu, old-time edits and full-day protection verified.`,
  );
  const sessionRead = await invoke("nido", "sessions_history", {
    sessionKey: "agent:existing:main",
  });
  assert.match(JSON.stringify(sessionRead.body), /solo puede acceder a los especialistas/);
  const { GatewayClient } = await import(
    pathToFileURL(
      join(root, ".runtime/openclaw/node_modules/openclaw/dist/plugin-sdk/gateway-runtime.js"),
    )
  );
  let reader;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("No conectó el operador de prueba")), 10000);
      reader = new GatewayClient({
        url: `ws://127.0.0.1:${port}`,
        token: original.gateway.auth.token,
        clientName: "cli",
        mode: "cli",
        deviceIdentity: null,
        scopes: ["operator.read"],
        env,
        onHelloOk() {
          clearTimeout(timer);
          resolve();
        },
        onConnectError(error) {
          clearTimeout(timer);
          reject(error);
        },
      });
      reader.start();
    });
    for (const method of [
      "nido.setup.status",
      "nido.setup.preview",
      "nido.setup.apply",
      "nido.google.start",
      "nido.google.status",
      "nido.google.calendars",
    ])
      await assert.rejects(reader.request(method, {}), /scope|permission|forbidden/i);
  } finally {
    reader?.stop();
  }
  run(["config", "validate"]);
  console.log(
    "Paquete verificado: instalación sin config, asistente demo, conservación del host, almacenamiento privado y guardado idempotente. Sin llamadas al modelo ni a Google.",
  );
} catch (error) {
  if (log) console.error(log);
  throw error;
} finally {
  await stop();
  await rm(base, { recursive: true, force: true });
}
