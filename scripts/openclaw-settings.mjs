import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, brotliCompressSync } from "node:zlib";

export function nidoSettingsPatch(source) {
  const marker = "/* Nido native settings 2026.9.4 */";
  if (source.includes(marker)) return source;
  const edits = source.includes("function zr(e,t){")
    ? [
        [
          "function zr(e,t){",
          "function zr(e,t){if(t.id===`nido-family`){import(`/plugins/nido-family/settings.js`).catch(()=>{});return y`<nido-calendar-settings .client=${e.nidoClient}></nido-calendar-settings>`;}",
        ],
        ["m={connected:e.connected,", "m={nidoClient:e.nidoClient,connected:e.connected,"],
        [
          "return Kr({context:this.context,",
          "return Kr({nidoClient:this.gateway.client,context:this.context,",
        ],
      ]
    : [
        [
          "render(){let e=this.model;if(!e)return O;",
          "render(){let e=this.model;if(!e)return O;if(e.pluginId===`nido-family`){import(`/plugins/nido-family/settings.js`).catch(()=>{});return D`<nido-calendar-settings .client=${e.nidoClient}></nido-calendar-settings>`;}",
        ],
        ["_={connected:e.connected,", "_={nidoClient:e.nidoClient,connected:e.connected,"],
        [
          "return Zr({mcpLogin:this.mcpLogin.render(),",
          "return Zr({nidoClient:this.gateway.client,mcpLogin:this.mcpLogin.render(),",
        ],
      ];
  for (const [before, after] of edits) {
    if (source.split(before).length !== 2)
      throw new Error(
        "La UI de OpenClaw cambió; revisa la integración de ajustes antes de aplicar.",
      );
    source = source.replace(before, after);
  }
  return marker + "\n" + source;
}
export async function installNidoSettings(runtime) {
  const version = JSON.parse(await readFile(join(runtime, "package.json"), "utf8")).version;
  if (!["2026.9.4", "2026.9.8"].includes(version))
    throw new Error("La integración nativa de ajustes requiere OpenClaw 2026.9.4 o 2026.9.8.");
  const directory = join(runtime, "dist/control-ui/assets");
  const files = (await readdir(directory)).filter((name) => /^plugins-page-.*\.js$/.test(name));
  if (files.length !== 1)
    throw new Error("No se pudo localizar la pantalla de ajustes de plugins.");
  const path = join(directory, files[0]);
  const original = await readFile(path, "utf8"),
    patched = nidoSettingsPatch(original);
  if (patched !== original) await writeFile(path, patched);
  await writeFile(path + ".gz", gzipSync(patched));
  await writeFile(path + ".br", brotliCompressSync(patched));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runtime = fileURLToPath(
    new URL("../.runtime/openclaw/node_modules/openclaw/", import.meta.url),
  );
  await installNidoSettings(runtime);
  console.log("Integración de ajustes de Nido aplicada al runtime local de OpenClaw.");
}
