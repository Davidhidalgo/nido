import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const versions = JSON.parse(readFileSync(join(root, "config/runtime-versions.json"), "utf8"));
const [major, minor] = process.versions.node.split(".").map(Number);
if (major !== 24 || minor < 16)
  throw new Error(
    "Instala Node 24.16 o posterior de la rama 24; .nvmrc indica la versión probada.",
  );
if (!["darwin", "linux"].includes(process.platform))
  throw new Error("Usa macOS, Linux o WSL2. Los comandos de Nido requieren un shell POSIX.");
const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}` };
execFileSync(
  "npm",
  [
    "install",
    "--prefix",
    ".runtime/openclaw",
    "--cache",
    ".cache/npm",
    "--no-audit",
    "--no-fund",
    "--save-exact",
    `openclaw@${versions.openclaw}`,
  ],
  { cwd: root, stdio: "inherit", env },
);
console.log(
  "Runtime instalado. Continúa con pnpm install --frozen-lockfile, pnpm run setup y pnpm run build.",
);
