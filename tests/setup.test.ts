import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import {
  applySetup,
  pluginConfig,
  setupPlan,
  setupVersion,
  type SetupRequest,
} from "../integrations/nido-family/src/setup.js";
import { GoogleSetup, registerSetupAdmin } from "../integrations/nido-family/src/setup-admin.js";
import { childSessionAllowed } from "../integrations/nido-family/src/session-policy.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
function hostConfig(): OpenClawPluginApi["config"] {
  return {
    agents: {
      entries: {
        existing: {
          name: "Asistente existente",
          model: "openai/example-model",
          workspace: "/tmp/existing-workspace",
        },
      },
    },
    gateway: { mode: "local", bind: "loopback" },
    tools: { sessions: { visibility: "all" }, deny: ["exec"] },
    channels: { telegram: { enabled: true } },
    bindings: [{ agentId: "existing", match: { channel: "telegram", accountId: "*" } }],
    plugins: {
      entries: {
        "nido-family": { enabled: true, config: {} },
        example: { enabled: true, config: { keep: true } },
      },
    },
  };
}
const request = (host = hostConfig()): SetupRequest => ({
  version: setupVersion(host),
  requestId: "fixture-operation-01",
  mode: "demo",
  timeZone: "Europe/Madrid",
  members: ["Persona de prueba"],
  mealTimes: { lunch: "13:30", dinner: "20:00", durationMinutes: 60 },
  writesEnabled: true,
  modelAgentId: "existing",
});
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "nido-setup-test-"));
  directories.push(base);
  const packageRoot = join(base, "package");
  for (const id of ["nido", "menu", "agenda"]) {
    const destination = join(packageRoot, "dist/agent-templates", id);
    await mkdir(destination, { recursive: true });
    await copyFile(resolve("agents", id, "AGENTS.md"), join(destination, "AGENTS.md"));
  }
  let config = hostConfig();
  const mutate = vi.fn(
    async ({
      mutate: change,
    }: {
      mutate: (draft: typeof config, context: unknown) => Promise<void>;
    }) => {
      const draft = structuredClone(config);
      await change(draft, { snapshot: { sourceConfig: structuredClone(config) } });
      config = draft;
    },
  );
  const api = {
    rootDir: packageRoot,
    runtime: {
      state: { resolveStateDir: () => base },
      config: { current: () => config, mutateConfigFile: mutate },
    },
  } as unknown as OpenClawPluginApi;
  return { base, root: join(base, "nido-family"), api, mutate, config: () => config };
}
it("previews without mutating the host and rejects agent collisions, legacy installs and stale requests", () => {
  const host = hostConfig(),
    before = structuredClone(host),
    input = request(host);
  const plan = setupPlan(host, "/tmp/nido-family", input);
  expect(host).toEqual(before);
  expect(plan.entries.nido).toMatchObject({
    model: "openai/example-model",
    subagents: { allowAgents: ["menu", "agenda"] },
  });
  expect(plan.entries.menu.tools.allow).toContain("nido_preferences_set");
  expect(plan.entries.agenda.tools.allow).not.toContain("nido_preferences_set");
  host.agents!.entries!.menu = { workspace: "/tmp/other" };
  expect(() => setupPlan(host, "/tmp/nido-family", input)).toThrow(/cambió/);
  input.version = setupVersion(host);
  expect(() => setupPlan(host, "/tmp/nido-family", input)).toThrow(/existe el agente menu/);
  delete host.agents!.entries!.menu;
  host.plugins!.entries!["nido-family"].config = { ...plan.config, setup: undefined };
  input.version = setupVersion(host);
  expect(() => setupPlan(host, "/tmp/nido-family", input)).toThrow(/fuera del asistente/);
});
it("validates timezone, meal times, exact fields and Google permissions before writing", () => {
  const host = hostConfig(),
    input = request(host);
  expect(() => setupPlan(host, "/tmp/nido-family", { ...input, timeZone: "Not/AZone" })).toThrow(
    /zona horaria/,
  );
  expect(() => setupPlan(host, "/tmp/nido-family", { ...input, dataDir: "/tmp/escape" })).toThrow(
    /formulario/,
  );
  expect(() =>
    setupPlan(host, "/tmp/nido-family", {
      ...input,
      mealTimes: { ...input.mealTimes, lunch: "25:60" },
    }),
  ).toThrow(/formulario/);
  const google = { ...input, mode: "google", menuCalendarId: "meals", familyCalendarId: "family" };
  const catalog = [
    { id: "meals", summary: "Meals", accessRole: "owner" },
    { id: "family", summary: "Family", accessRole: "reader" },
  ];
  expect(() => setupPlan(host, "/tmp/nido-family", google, catalog)).toThrow(/escribir/);
  expect(
    setupPlan(host, "/tmp/nido-family", { ...google, writesEnabled: false }, catalog).config
      .dataDir,
  ).toBe("/tmp/nido-family/google");
  expect(() =>
    setupPlan(host, "/tmp/nido-family", { ...google, familyCalendarId: "meals" }, catalog),
  ).toThrow(/distintos/);
});
it("adds a private family and preserves existing configuration, then reconciles a replay without writing", async () => {
  const f = await fixture(),
    before = structuredClone(f.config()),
    input = request(before);
  await applySetup(f.api, input);
  const config = f.config();
  for (const field of ["gateway", "tools", "channels", "bindings"] as const)
    expect(config[field]).toEqual(before[field]);
  expect(config.plugins!.entries!.example).toEqual(before.plugins!.entries!.example);
  expect(config.agents!.entries!.existing).toEqual(before.agents!.entries!.existing);
  expect(config.agents!.defaults!.systemAgent!.agentId).toBe("existing");
  expect(config.agents!.entries!.nido.model).toBe("openai/example-model");
  const workspace = config.agents!.entries!.menu.workspace!;
  expect(await readFile(join(workspace, "AGENTS.md"), "utf8")).toContain("Persona de prueba");
  expect((await stat(join(workspace, "AGENTS.md"))).mode & 0o777).toBe(0o600);
  expect((await stat(workspace)).mode & 0o777).toBe(0o700);
  await expect(applySetup(f.api, input)).resolves.toEqual({
    applied: true,
    requestId: input.requestId,
  });
  expect(f.mutate).toHaveBeenCalledTimes(1);
  await expect(applySetup(f.api, { ...input, writesEnabled: false })).rejects.toThrow(
    /otros datos/,
  );
});
it("keeps demo data separate when connecting Google and preserves agent customizations", async () => {
  const f = await fixture();
  await applySetup(f.api, request());
  const demoDir = pluginConfig(f.config())!.dataDir;
  await writeFile(join(demoDir, "fixture.txt"), "demo");
  f.config().agents!.entries!.nido.model = "openai/custom-model";
  const input = {
    ...request(f.config()),
    requestId: "fixture-operation-02",
    mode: "google" as const,
    menuCalendarId: "meals",
    familyCalendarId: "family",
    writesEnabled: false,
  };
  await applySetup(
    f.api,
    input,
    ["meals", "family"].map((id) => ({ id, summary: id, accessRole: "owner" })),
  );
  expect(pluginConfig(f.config())!.dataDir).not.toBe(demoDir);
  expect(await readFile(join(demoDir, "fixture.txt"), "utf8")).toBe("demo");
  expect(f.config().agents!.entries!.nido.model).toBe("openai/custom-model");
});
it("rejects symlink destinations and conflicting templates without replacing files", async () => {
  const f = await fixture();
  const outside = join(f.base, "outside");
  await mkdir(outside);
  await symlink(outside, f.root);
  await expect(applySetup(f.api, request())).rejects.toThrow(/enlaces/);
  expect(f.mutate).not.toHaveBeenCalled();
});
it("detects changes made between preparing files and committing config", async () => {
  const f = await fixture();
  f.mutate.mockImplementationOnce(async () => {
    f.config().agents!.entries!.menu = { workspace: "/tmp/conflict" };
    throw new Error("Conflict");
  });
  await expect(applySetup(f.api, request())).rejects.toThrow(/Conflict/);
  expect(pluginConfig(f.config())!.mode).toBeUndefined();
  expect(f.config().agents!.entries!.menu.workspace).toBe("/tmp/conflict");
});
it("scopes coordinator access to its own specialist sessions", () => {
  const key = "agent:menu:subagent:fixture";
  expect(childSessionAllowed("agent:nido:one", key, "agent:nido:one")).toBe(true);
  expect(childSessionAllowed("agent:nido:two", key, "agent:nido:one")).toBe(false);
  expect(childSessionAllowed("agent:nido:one", "agent:existing:main", "agent:nido:one")).toBe(
    false,
  );
  expect(childSessionAllowed(undefined, key, undefined)).toBe(false);
});
it("keeps Google unavailable until the publisher configures the shared service", async () => {
  const f = await fixture();
  const google = new GoogleSetup(f.root, undefined, undefined, undefined, "");
  expect(google.available()).toBe(false);
  await expect(google.start({})).rejects.toThrow(/todavía no está disponible/);
  await expect(google.start({ client: {} })).rejects.toThrow(/aplicación de Google de Nido/);
});
it("registers all setup RPC with administrator scope and performs no eager filesystem work", () => {
  const methods: { name: string; scope: string }[] = [];
  const api = {
    registerGatewayMethod(name: string, _handler: unknown, options: { scope: string }) {
      methods.push({ name, scope: options.scope });
    },
    registerHttpRoute() {},
    registerService() {},
  } as unknown as OpenClawPluginApi;
  registerSetupAdmin(api);
  expect(methods).toHaveLength(6);
  expect(methods.every((method) => method.scope === "operator.admin")).toBe(true);
});
