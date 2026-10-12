import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function loadNote4Runtime(root, { demo = false } = {}) {
  const state = join(root, demo ? ".local/note4/openclaw" : ".local/openclaw");
  const configPath = join(state, "openclaw.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const family = config.plugins?.entries?.["nido-family"]?.config;
  if (demo) {
    if (family?.mode !== "demo" || config.gateway?.port !== 18790)
      throw new Error("La opción --demo requiere el Gateway NOTE4 demo aislado.");
  } else if (
    family?.mode !== "google" ||
    typeof family.menuCalendarId !== "string" ||
    typeof family.familyCalendarId !== "string" ||
    !family.menuCalendarId ||
    !family.familyCalendarId ||
    family.menuCalendarId === family.familyCalendarId ||
    [family.menuCalendarId, family.familyCalendarId].some((id) => id.startsWith("demo-"))
  ) {
    throw new Error("Configura los calendarios de Google en Nido, o usa --demo para una prueba.");
  }
  if (!config.agents?.entries?.["nido-note4"] || !family.dataDir)
    throw new Error("Falta preparar el agente nido-note4 y su almacenamiento en este Gateway.");
  return { state, configPath, config, family };
}

export function note4DemoFamily(family, dataDir) {
  // Keep private IDs, names and per-agent permissions out of the simulated installation.
  return {
    mode: "demo",
    writesEnabled: true,
    menuCalendarId: "demo-note4-menu",
    familyCalendarId: "demo-note4-family",
    dataDir,
    timeZone: family.timeZone,
    ...(family.mealTimes ? { mealTimes: family.mealTimes } : {}),
  };
}
