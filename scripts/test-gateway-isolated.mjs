import { mkdtemp, mkdir, copyFile, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { pathToFileURL } from "node:url";
import { spawn, execFileSync } from "node:child_process";

const source = fileURLToPath(new URL("../", import.meta.url));
const base = await mkdtemp(join(tmpdir(), "nido-gateway-test-"));
const root = join(base, "repo");
const state = join(root, ".local/openclaw");
let gateway;
let log = "";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const env = { ...process.env, NIDO_HOME: join(base, "private") };
delete env.NIDO_MODEL;
delete env.OPENCLAW_GATEWAY_TOKEN;
const run = (script, extraEnv = env) =>
  execFileSync(process.execPath, [join(root, "scripts", script)], {
    cwd: root,
    env: extraEnv,
    stdio: "inherit",
    timeout: 30000,
  });
async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
async function stop() {
  if (!gateway || !gateway.pid || gateway.exitCode !== null || gateway.signalCode !== null) return;
  const child = gateway;
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
}
const interrupted = () => {
  void stop();
};
process.once("SIGINT", interrupted);
process.once("SIGTERM", interrupted);
try {
  for (const path of ["scripts", "config", "integrations"])
    await mkdir(join(root, path), { recursive: true });
  for (const script of [
    "prepare-local.mjs",
    "private-state.mjs",
    "family-config.mjs",
    "honcho-runtime.mjs",
    "smoke-gateway.mjs",
  ])
    await copyFile(join(source, "scripts", script), join(root, "scripts", script));
  await copyFile(
    join(source, "config/family.example.json"),
    join(root, "config/family.example.json"),
  );
  for (const id of ["nido", "menu", "agenda", "nido-note4"]) {
    await mkdir(join(root, "agents", id), { recursive: true });
    await copyFile(join(source, "agents", id, "AGENTS.md"), join(root, "agents", id, "AGENTS.md"));
  }
  // Share only the compiled plugin, never the operator's config or workspace.
  await symlink(
    join(source, "integrations/nido-family"),
    join(root, "integrations/nido-family"),
    "dir",
  );
  run("prepare-local.mjs");
  const path = join(state, "openclaw.json");
  const config = JSON.parse(await readFile(path, "utf8"));
  if (config.plugins.entries["nido-family"].config.mode !== "demo")
    throw new Error("La fixture debe ser demo.");
  config.plugins.entries["nido-family"].config.agendaCalendarIds = [
    "demo-personal-a",
    "demo-personal-b",
    "demo-readonly",
  ];
  config.plugins.entries["nido-family"].config.calendarAccess = {
    agenda: {
      defaultCalendar: "calendar:demo-personal-a",
      read: [
        "menu",
        "family",
        "calendar:demo-personal-a",
        "calendar:demo-personal-b",
        "calendar:demo-readonly",
      ],
      write: ["family", "calendar:demo-personal-a", "calendar:demo-personal-b"],
    },
  };
  const otaKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKeyFile = join(base, "firmware-fixture-public.pem");
  await writeFile(publicKeyFile, otaKeys.publicKey.export({ format: "pem", type: "spki" }), {
    mode: 0o600,
  });
  config.plugins.entries["nido-family"].config.note4Maintenance = { publicKeyFile };
  config.gateway.port = await freePort();
  if (process.argv.includes("--ui")) config.gateway.auth.token = "nido-settings-fixture-secret";
  await writeFile(path, JSON.stringify(config), { mode: 0o600 });
  const runtimeEnv = { ...env, OPENCLAW_STATE_DIR: state, OPENCLAW_CONFIG_PATH: path };
  const cli = join(source, ".runtime/openclaw/node_modules/openclaw/openclaw.mjs");
  const startGateway = async () => {
    gateway = spawn(process.execPath, [cli, "gateway", "run"], {
      cwd: root,
      env: runtimeEnv,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let spawnError;
    gateway.on("error", (error) => {
      spawnError = error;
    });
    const append = (chunk) => {
      log = (log + chunk.toString()).slice(-16000);
    };
    gateway.stdout.on("data", append);
    gateway.stderr.on("data", append);
    let ready = false;
    for (let i = 0; i < 90; i++) {
      if (spawnError) throw spawnError;
      if (gateway.exitCode !== null || gateway.signalCode !== null) break;
      try {
        const response = await fetch(`http://127.0.0.1:${config.gateway.port}/health`, {
          signal: AbortSignal.timeout(300),
        });
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* The child may still be loading its plugins. */
      }
      await delay(500);
    }
    if (!ready) throw new Error("No arrancó el Gateway demo temporal.");
  };
  await startGateway();
  run("smoke-gateway.mjs", runtimeEnv);
  const origin = `http://127.0.0.1:${config.gateway.port}`;
  const headers = { Authorization: `Bearer ${config.gateway.auth.token}` };
  const panelPath = "/plugins/nido-family/calendars";
  const adminPath = "/plugins/nido-family/calendar-admin";
  const denied = await fetch(origin + panelPath);
  if (denied.status !== 401) throw new Error("Panel de calendarios sin autenticación.");
  const panel = await fetch(origin + panelPath, { headers });
  const html = await panel.text();
  if (panel.status !== 200) throw new Error(`Panel HTTP ${panel.status}: ${html.slice(0, 400)}`);
  const metadata = JSON.parse(
    html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/)[1],
  );
  const selection = {
    version: metadata.version,
    writesEnabled: true,
    defaults: { menu: "menu", agenda: "family" },
    calendars: metadata.calendars.map((item) => ({
      id: item.id,
      enabled: item.enabled,
      shortName: item.id === "demo-personal-a" ? "Persona A" : item.shortName,
      menu: metadata.access.menu.write.includes(item.reference)
        ? "write"
        : metadata.access.menu.read.includes(item.reference)
          ? "read"
          : "none",
      agenda: metadata.access.agenda.write.includes(item.reference)
        ? "write"
        : metadata.access.agenda.read.includes(item.reference)
          ? "read"
          : "none",
    })),
  };
  const post = (extraHeaders = {}) =>
    fetch(origin + adminPath, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify(selection),
    });
  if ((await post({ Authorization: "Bearer incorrect" })).status !== 401)
    throw new Error("Guardado sin credencial válida.");
  if ((await post({ Origin: "https://untrusted.example" })).status !== 403)
    throw new Error("Origen externo autorizado.");
  const saved = await post({ Origin: "null" });
  const result = await saved.json();
  if (saved.status !== 200 || result.warning)
    throw new Error(`Guardado del panel: ${JSON.stringify(result)}`);
  const persisted = JSON.parse(await readFile(path, "utf8"));
  const family = JSON.parse(await readFile(join(root, ".local/family.json"), "utf8"));
  if (
    persisted.plugins.entries["nido-family"].config.calendarShortNames["demo-personal-a"] !==
      "Persona A" ||
    family.calendarShortNames["demo-personal-a"] !== "Persona A"
  )
    throw new Error("No persistió el nombre corto.");
  if (
    JSON.stringify(persisted.agents) !== JSON.stringify(config.agents) ||
    JSON.stringify(persisted.gateway.auth) !== JSON.stringify(config.gateway.auth)
  )
    throw new Error("Se alteraron preferencias o autenticación.");
  // Re-register instance-scoped SDK callbacks after the calendar config reload.
  // This restarts only this temporary fixture, never an operational Gateway.
  await stop();
  await startGateway();
  const rpcCatalog = JSON.parse(
    execFileSync(process.execPath, [cli, "gateway", "call", "nido.calendars.catalog", "--json"], {
      cwd: root,
      env: runtimeEnv,
      encoding: "utf8",
      timeout: 20000,
    }),
  );
  if (!rpcCatalog.calendars?.length) throw new Error("Catálogo RPC nativo vacío.");
  const rpc = (method, params = {}) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [cli, "gateway", "call", method, "--params", JSON.stringify(params), "--json"],
        { cwd: root, env: runtimeEnv, encoding: "utf8", timeout: 20000 },
      ),
    );
  if (rpc("nido.note4.githubCheck").configured !== false)
    throw new Error("GitHub debe permanecer desactivado sin repositorio.");
  if (rpc("nido.note4.status").devices.length)
    throw new Error("NOTE4 ficticio debía estar sin vincular.");
  const certificatePath = join(base, "server-fixture.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=192.168.1.2",
      "-addext",
      "subjectAltName=IP:192.168.1.2",
      "-keyout",
      join(base, "server-fixture-key.pem"),
      "-out",
      certificatePath,
    ],
    { stdio: "ignore" },
  );
  const pairing = rpc("nido.note4.pair", {
    endpoint: "https://192.168.1.2:18791",
    certificate: await readFile(certificatePath, "utf8"),
  });
  const { Note4Maintenance } = await import(
    pathToFileURL(join(source, "integrations/nido-family/dist/note4-maintenance.js"))
  );
  const maintenance = new Note4Maintenance(
    join(config.plugins.entries["nido-family"].config.dataDir, "note4-maintenance"),
    await readFile(publicKeyFile, "utf8"),
  );
  try {
    maintenance.redeem({ grant: pairing.grant, token: "a".repeat(64), deviceId: "note4-fixture" });
    const binary = Buffer.alloc(1024);
    binary[0] = 0xe9;
    binary.writeUInt16LE(9, 12);
    binary.writeUInt32LE(0xabcd5432, 32);
    binary.write("gateway-fixture", 48);
    binary.write("nido_note4", 80);
    const manifest = JSON.stringify({
      board: "note4-mono-v1",
      version: "gateway-fixture",
      configVersion: 1,
      size: binary.length,
      sha256: createHash("sha256").update(binary).digest("hex"),
    });
    const envelope = {
      manifest,
      signature: sign("sha256", Buffer.from(manifest), otaKeys.privateKey).toString("hex"),
    };
    rpc("nido.note4.publish", { envelope, binary: binary.toString("base64") });
    const request = {
      id: "gateway-update-fixture",
      deviceId: "note4-fixture",
      version: "gateway-fixture",
    };
    rpc("nido.note4.update", request);
    rpc("nido.note4.update", request);
    if (rpc("nido.note4.status").updates.length !== 1) throw new Error("La orden OTA se duplicó.");
    if (!maintenance.check("note4-fixture", "old-fixture", "valid").update)
      throw new Error("El puente no recibió la orden del plugin.");
    maintenance.report("note4-fixture", { id: request.id, phase: "installing" });
    maintenance.check("note4-fixture", "gateway-fixture", "valid");
    if (rpc("nido.note4.status").updates[0].phase !== "complete")
      throw new Error("El plugin no reconcilió el arranque.");
  } finally {
    maintenance.close();
  }
  // Explicit read-only operator session: the runtime must deny maintenance writes.
  const { GatewayClient } = await import(
    pathToFileURL(
      join(source, ".runtime/openclaw/node_modules/openclaw/dist/plugin-sdk/gateway-runtime.js"),
    )
  );
  let client;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("No conectó el operador de solo lectura.")),
      10000,
    );
    client = new GatewayClient({
      url: `ws://127.0.0.1:${config.gateway.port}`,
      token: config.gateway.auth.token,
      clientName: "cli",
      mode: "cli",
      deviceIdentity: null,
      scopes: ["operator.read"],
      env: runtimeEnv,
      onHelloOk: () => {
        clearTimeout(timer);
        resolve();
      },
      onConnectError: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    client.start();
  });
  try {
    await client.request("nido.note4.status", {});
    for (const method of [
      "pair",
      "pairCode",
      "discover",
      "publish",
      "update",
      "resolve",
      "githubCheck",
      "githubDownload",
    ]) {
      let denied = false;
      try {
        await client.request(`nido.note4.${method}`, {});
      } catch (error) {
        denied = /scope|permission|forbidden/i.test(String(error));
      }
      if (!denied) throw new Error(`Scope administrativo no aplicado: ${method}`);
    }
  } finally {
    client.stop();
  }
  console.log(
    "NOTE4 administrativo verificado: vinculación, firma, órdenes, reconciliación y scopes del Gateway.",
  );
  const stale = await post();
  if (stale.status !== 409) throw new Error(`Conflicto de versión no detectado: ${stale.status}`);
  console.log(
    "Panel Nido verificado: autenticación, origen, guardado, sincronización y conflictos.",
  );

  console.log(
    "Gateway aislado verificado con datos ficticios; sin llamadas al modelo ni a Google.",
  );
  if (process.argv.includes("--ui")) {
    console.log(
      `UI ficticia: http://127.0.0.1:${config.gateway.port}/settings/plugins/nido-family`,
    );
    process.stdin.resume();
    await new Promise((resolve) => process.stdin.once("data", resolve));
    process.stdin.pause();
  }
} catch (error) {
  if (log) console.error(log);
  throw error;
} finally {
  await stop();
  process.removeListener("SIGINT", interrupted);
  process.removeListener("SIGTERM", interrupted);
  await rm(base, { recursive: true, force: true });
}
