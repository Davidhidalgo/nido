import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { GoogleCalendar } from "../integrations/nido-family/dist/google.js";
import {
  buildMenu,
  weekStart,
  addDays,
  publishMenu,
  webhookBody,
  validDate,
} from "../integrations/trmnl/menu.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const publish = args.includes("--publish");
const demo = args.includes("--demo");
const watch = args.includes("--watch");
const startArg = args.find((a) => a.startsWith("--start="))?.slice(8);
if (args.some((a) => !["--publish", "--demo", "--watch"].includes(a) && !a.startsWith("--start=")))
  throw new Error("Uso: pnpm run trmnl:preview|trmnl:sync [--demo] [--start=YYYY-MM-DD] [--watch]");
if (watch && !publish) throw new Error("--watch requiere --publish.");
async function run() {
  const family = demo ? null : JSON.parse(await readFile(join(root, ".local/family.json"), "utf8"));
  const timeZone = family?.timeZone ?? "Europe/Madrid";
  const now = new Date();
  const start = startArg ?? weekStart(now, timeZone);
  if (!validDate(start)) throw new Error("Fecha inválida: usa --start=YYYY-MM-DD.");
  let events;
  let sourceDemo = demo;
  let zone = timeZone;
  if (demo) {
    events = [
      { summary: "Comida · Lentejas con verduras", start: { date: start } },
      { summary: "Cena · Tortilla y ensalada", start: { date: start } },
      { summary: "Cena · Crema de calabaza", start: { date: addDays(start, 1) } },
      { summary: "Comida · Arroz con pollo", start: { date: addDays(start, 2) } },
      { summary: "Cena · Pescado al horno", start: { date: addDays(start, 3) } },
      { summary: "Cena · Pizza casera", start: { date: addDays(start, 4) } },
    ];
  } else {
    if (!["demo", "google"].includes(family.mode) || !family.menuCalendarId)
      throw new Error("Configuración familiar inválida.");
    zone = family.timeZone ?? timeZone;
    sourceDemo = family.mode === "demo";
    if (sourceDemo) {
      const db = new DatabaseSync(join(root, ".local/family-data/demo/nido.sqlite"), {
        readOnly: true,
      });
      try {
        events = db
          .prepare("SELECT body FROM demo_events WHERE calendar = ?")
          .all(family.menuCalendarId)
          .map((row) => JSON.parse(row.body));
      } finally {
        db.close();
      }
    } else {
      const calendar = new GoogleCalendar(
        join(root, ".local/family-data/google/google-credentials.json"),
      );
      // Pad UTC bounds to cover the local week across offsets and DST, then project local dates.
      events = await calendar.list(
        family.menuCalendarId,
        `${addDays(start, -1)}T00:00:00Z`,
        `${addDays(start, 8)}T00:00:00Z`,
      );
    }
  }
  const menu = buildMenu(events, { start, timeZone: zone, now, demo: sourceDemo });
  const body = webhookBody(menu);
  if (publish) {
    await publishMenu(menu, process.env.TRMNL_WEBHOOK_URL);
    console.log(
      `Menú ${sourceDemo ? "DEMO " : ""}enviado a TRMNL. Aparecerá en el próximo refresco del dispositivo.`,
    );
  } else {
    const dir = join(root, ".local/trmnl");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, "preview.json");
    await writeFile(path, body + "\n", { mode: 0o600 });
    console.log(
      `Vista previa ${sourceDemo ? "DEMO " : ""}guardada en .local/trmnl/preview.json. No se ha enviado a TRMNL.`,
    );
  }
}
if (watch) {
  console.log(
    "Actualización TRMNL cada 10 minutos mientras este proceso esté abierto. Ctrl+C para detener.",
  );
  while (true) {
    try {
      await run();
    } catch (error) {
      console.error(error.message);
    }
    await new Promise((resolve) => setTimeout(resolve, 10 * 60 * 1000));
  }
} else {
  try {
    await run();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
