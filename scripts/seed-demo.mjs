import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Store, DemoCalendar } from "../integrations/nido-family/dist/core.js";
const root = fileURLToPath(new URL("../", import.meta.url));
const config = JSON.parse(await readFile(join(root, ".local/openclaw/openclaw.json"), "utf8"))
  .plugins.entries["nido-family"].config;
if (config.mode !== "demo") throw new Error("Solo se pueden sembrar datos ficticios en modo demo.");
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: config.timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const day = new Date(`${today}T12:00:00Z`);
day.setUTCDate(day.getUTCDate() + ((6 - day.getUTCDay() + 7) % 7));
const saturday = day.toISOString().slice(0, 10);
const date = (offset) => new Date(day.getTime() + offset * 86400000).toISOString().slice(0, 10);
const store = new Store(join(config.dataDir, "nido.sqlite"));
const calendar = new DemoCalendar(store);
try {
  for (const [calendarId, input] of [
    [
      config.familyCalendarId,
      {
        id: `demobirthday${saturday.replaceAll("-", "")}`,
        summary: "Cumpleaños de ejemplo · DEMO",
        description: "Datos ficticios para probar si Nido pregunta si comeremos fuera.",
        start: { date: saturday },
        end: { date: date(1) },
      },
    ],
    [
      config.menuCalendarId,
      {
        id: `demodinner${saturday.replaceAll("-", "")}`,
        summary: "Cena · Tortilla (DEMO)",
        description: "Plan previo ficticio; conservar salvo petición de rectificación.",
        start: { date: date(-1) },
        end: { date: saturday },
      },
    ],
  ]) {
    try {
      await calendar.create(calendarId, input);
    } catch (e) {
      if (e.code !== "CONFLICT") throw e;
    }
  }
  console.log(
    `Demo preparada: cumpleaños el ${saturday} y cena ya planificada el viernes anterior. Google no se ha utilizado.`,
  );
} finally {
  store.close();
}
