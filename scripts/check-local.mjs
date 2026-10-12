import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const has = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};
const configPath = join(root, ".local/openclaw/openclaw.json");
if (!(await has(configPath))) {
  console.log("Pendiente: ./scripts/pnpm prepare:local");
  process.exitCode = 1;
} else {
  const c = JSON.parse(await readFile(configPath, "utf8"));
  const family = c.plugins.entries["nido-family"].config;
  console.log(`Modo de calendarios: ${family.mode}`);
  console.log(
    `Modelo configurado (acceso aún debe verificarse): ${c.agents.defaults.model.primary}`,
  );
  console.log(`Interfaz: http://127.0.0.1:${c.gateway.port} (solo este equipo)`);
  console.log(
    `Credenciales Google locales: ${(await has(join(root, ".local/family-data/google/google-credentials.json"))) ? "presentes, falta validar acceso" : "pendientes"}`,
  );
  console.log(
    `OPENAI_API_KEY en esta sesión: ${process.env.OPENAI_API_KEY ? "presente" : "no disponible; también puede configurarse mediante OpenClaw"}`,
  );
  console.log(
    `Escrituras: ${family.writesEnabled ? "activadas en " + family.mode : "desactivadas"}`,
  );
  console.log("Respaldos: aplazados. No hay configuración de copias en Nido.");
}
