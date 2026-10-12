import { readFile, open, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const state = join(root, ".local/note4/openclaw");
const configPath = join(state, "openclaw.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
if (config.plugins.entries["nido-family"].config.mode !== "demo" || config.gateway.port !== 18790)
  throw new Error("El dashboard NOTE4 solo admite el Gateway demo aislado.");
const lockPath = join(root, ".local/note4/conversation.lock");
let lock;
try {
  lock = await open(lockPath, "wx", 0o600);
} catch (error) {
  if (error.code === "EEXIST")
    throw new Error(
      "Hay una prueba en curso. Espera a que termine antes de abrir el dashboard demo.",
    );
  throw error;
}
const nodePath = process.execPath;
const cliPath = join(root, ".runtime/openclaw/node_modules/openclaw/openclaw.mjs");
try {
  await new Promise((resolve, reject) => {
    const child = spawn(nodePath, [cliPath, "gateway", "run"], {
      cwd: root,
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: state,
        OPENCLAW_CONFIG_PATH: configPath,
        OPENCLAW_GATEWAY_TOKEN: config.gateway.auth.token,
        PATH: process.env.PATH,
      },
      stdio: "inherit",
    });
    console.log(
      "Dashboard demo NOTE4: http://127.0.0.1:18790 · Ctrl+C para detener. Usa la credencial local del Gateway demo.",
    );
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
    child.on("error", reject);
    child.on("close", (code) => {
      process.exitCode = code ?? 0;
      resolve();
    });
  });
} finally {
  await lock.close();
  await unlink(lockPath);
}
