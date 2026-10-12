import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: "inherit" });
run(process.execPath, [join(root, "scripts/release-check.mjs")]);
run("pnpm", ["run", "build"]);
const stage = join(root, ".cache/plugin-package");
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
const source = join(root, "integrations/nido-family");
run("pnpm", ["exec", "tsc", "-p", join(source, "tsconfig.json"), "--outDir", join(stage, "dist")]);
for (const path of ["openclaw.plugin.json"])
  await cp(join(source, path), join(stage, path), { recursive: true });
const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
delete pkg.private;
delete pkg.scripts;
delete pkg.devDependencies;
pkg.files = ["dist", "openclaw.plugin.json", "README.md"];
const manifest = JSON.parse(await readFile(join(source, "openclaw.plugin.json"), "utf8"));
const uiAssets = dirname(manifest.controlUi.entry);
if (!/^dist\/control-ui\/[a-f0-9]+$/.test(uiAssets))
  throw new Error("Unexpected Control UI asset path.");
await cp(join(source, uiAssets), join(stage, uiAssets), { recursive: true });
await cp(join(source, "dist/calendar-element.js"), join(stage, "dist/calendar-element.js"));
await writeFile(join(stage, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
await cp(join(root, "docs/plugin-install.md"), join(stage, "README.md"));
for (const id of ["nido", "menu", "agenda", "nido-note4"]) {
  await mkdir(join(stage, "dist/agent-templates", id), { recursive: true });
  await cp(
    join(root, "agents", id, "AGENTS.md"),
    join(stage, "dist/agent-templates", id, "AGENTS.md"),
  );
}
const out = join(root, "release");
await mkdir(out, { recursive: true });
run(
  "npm",
  ["pack", "--ignore-scripts", "--cache", join(root, ".cache/npm"), "--pack-destination", out],
  stage,
);
console.log(
  "Paquete creado en release/ mediante una lista explícita de archivos. No se ha publicado.",
);
