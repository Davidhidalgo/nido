import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const plugin = join(root, "integrations/nido-family");
const runtime = join(root, ".runtime/openclaw/node_modules/openclaw/openclaw.mjs");
const temporary = await mkdtemp(join(tmpdir(), "nido-build-"));
try {
  execFileSync("pnpm", ["exec", "tsc", "-p", join(plugin, "tsconfig.json")], {
    cwd: root,
    stdio: "inherit",
  });
  const { calendarSettingsModule } = await import(
    new URL("../integrations/nido-family/dist/calendar-settings.js", import.meta.url)
  );
  await writeFile(join(plugin, "dist/calendar-element.js"), calendarSettingsModule());
  for (const id of ["nido", "menu", "agenda", "nido-note4"]) {
    const destination = join(plugin, "dist/agent-templates", id);
    await mkdir(destination, { recursive: true });
    await cp(join(root, "agents", id, "AGENTS.md"), join(destination, "AGENTS.md"));
  }
  const configPath = join(temporary, "openclaw.json");
  await writeFile(configPath, "{}\n");
  execFileSync(
    process.execPath,
    [runtime, "plugins", "build", "--root", plugin, "--entry", "./dist/index.js"],
    {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: temporary,
        OPENCLAW_CONFIG_PATH: configPath,
        OPENCLAW_SKIP_CHANNELS: "1",
      },
    },
  );
  // The SDK's tool-plugin builder discovers tools but not trusted policy registrations.
  const manifestPath = join(plugin, "openclaw.plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.contracts.trustedToolPolicies = ["nido-session-scope"];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
