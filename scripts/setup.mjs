import { readFile, writeFile, chmod } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { preparePrivateState } from "./private-state.mjs";
import { validateFamily } from "./family-config.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (args.includes("--help")) {
  console.log(
    "Nido: pnpm run setup [--defaults]. NIDO_HOME elige el directorio privado externo. --defaults conserva la configuración existente o crea una demo.",
  );
  process.exit(0);
}
if (args.some((arg) => arg !== "--defaults")) throw new Error("Opción desconocida.");
if (!args.includes("--defaults") && !process.stdin.isTTY)
  throw new Error("Usa un terminal interactivo o --defaults para preparar una demo.");
const privateDir = await preparePrivateState(root);
const path = join(privateDir, "family.json");
let family;
try {
  family = JSON.parse(await readFile(path, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  family = JSON.parse(await readFile(join(root, "config/family.example.json"), "utf8"));
  family.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
}
if (!args.includes("--defaults")) {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (label, value) =>
    (await input.question(`${label} [${value ?? ""}]: `)).trim() || value;
  try {
    family.gatewayPort = Number(await ask("Puerto local del Gateway", family.gatewayPort ?? 18789));
    family.mode = await ask("Calendarios: demo o google", family.mode);
    family.timeZone = await ask("Zona horaria IANA", family.timeZone);
    family.members = (
      (await ask("Miembros (nombres separados por coma)", (family.members ?? []).join(", "))) ?? ""
    )
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    family.mealTimes = {
      lunch: await ask("Hora de comida HH:MM", family.mealTimes?.lunch ?? "13:00"),
      dinner: await ask("Hora de cena HH:MM", family.mealTimes?.dinner ?? "19:00"),
      durationMinutes: Number(
        await ask("Duración de las comidas en minutos", family.mealTimes?.durationMinutes ?? 60),
      ),
    };
    if (family.mode === "google") {
      family.menuCalendarId = await ask(
        "ID del calendario de menú",
        family.menuCalendarId?.startsWith("demo-") ? "" : family.menuCalendarId,
      );
      family.familyCalendarId = await ask(
        "ID del calendario familiar",
        family.familyCalendarId?.startsWith("demo-") ? "" : family.familyCalendarId,
      );
    } else {
      family.menuCalendarId = "demo-menu";
      family.familyCalendarId = "demo-family";
      delete family.agendaCalendarIds;
      delete family.calendarAccess;
      delete family.calendarNames;
      delete family.calendarShortNames;
    }
    family.writesEnabled =
      (await ask("Permitir escrituras: si o no", family.mode === "demo" ? "si" : "no")) === "si";
  } finally {
    input.close();
  }
}
validateFamily(family);
await writeFile(path, JSON.stringify(family, null, 2) + "\n", { mode: 0o600 });
await chmod(path, 0o600);
await import("./prepare-local.mjs");
console.log(
  `Estado privado: ${privateDir}. Siguiente paso: pnpm run build y configurar el modelo con ./scripts/openclaw configure --section model.`,
);
