import { readFile, writeFile, rename, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { GoogleCalendar } from "../integrations/nido-family/dist/google.js";
import { validateFamily } from "./family-config.mjs";

// Operator-only configuration. Never reads or mutates events, or grants Google ACLs.
const root = fileURLToPath(new URL("../", import.meta.url));
const options = process.argv.slice(2);
const requested = options
  .filter(
    (arg) =>
      arg.startsWith("--writable-name=") ||
      arg.startsWith("--pending-writable-name=") ||
      arg.startsWith("--readable-name="),
  )
  .map((arg) => ({
    name: arg.slice(arg.indexOf("=") + 1),
    pending: arg.startsWith("--pending-writable-name="),
    writable: !arg.startsWith("--readable-name="),
  }));
const apply = options.includes("--apply");
if (
  !requested.length ||
  options.some(
    (arg) =>
      arg !== "--apply" &&
      !arg.startsWith("--writable-name=") &&
      !arg.startsWith("--pending-writable-name=") &&
      !arg.startsWith("--readable-name="),
  )
)
  throw new Error(
    "Uso: calendar-access.mjs --writable-name=Nombre [--pending-writable-name=Otro] [--readable-name=Consulta] [--apply]",
  );
const path = join(root, ".local/family.json");
const original = await readFile(path, "utf8");
const family = JSON.parse(original);
validateFamily(family);
if (family.mode !== "google") throw new Error("Este comando requiere una instalación Google.");
const calendar = new GoogleCalendar(
  join(root, ".local/family-data/google/google-credentials.json"),
);
const available = await calendar.calendars();
const normalized = (name) => name.trim().toLocaleLowerCase("es");
const selected = requested.map(({ name, pending, writable }) => {
  const matches = available.filter((item) =>
    [item.summary, item.summaryOverride].some(
      (label) => typeof label === "string" && normalized(label) === normalized(name),
    ),
  );
  if (matches.length !== 1)
    throw new Error(`El nombre solicitado debe identificar exactamente un calendario: ${name}`);
  const match = matches[0];
  if (
    writable &&
    !["owner", "writer"].includes(match.accessRole) &&
    !(pending && match.accessRole === "reader")
  )
    throw new Error(`Google no permite escribir en ${name}.`);
  if (match.id === family.menuCalendarId)
    throw new Error("El menú conserva sus permisos separados.");
  if (!["owner", "writer", "reader"].includes(match.accessRole))
    throw new Error(`Google no permite consultar eventos en ${name}.`);
  return { ...match, writable };
});
const additional = selected
  .filter((item) => item.id !== family.familyCalendarId)
  .map((item) => item.id);
family.agendaCalendarIds = [...new Set([...(family.agendaCalendarIds ?? []), ...additional])];
const references = selected.map((item) =>
  item.id === family.familyCalendarId ? "family" : `calendar:${item.id}`,
);
const writableReferences = selected
  .filter((item) => item.writable)
  .map((item) => (item.id === family.familyCalendarId ? "family" : `calendar:${item.id}`));
const current = family.calendarAccess?.agenda ?? {
  defaultCalendar: "family",
  read: [
    "menu",
    "family",
    ...(family.agendaCalendarIds ?? [])
      .filter((id) => ![family.menuCalendarId, family.familyCalendarId].includes(id))
      .map((id) => `calendar:${id}`),
  ],
  write: ["family"],
};
family.calendarAccess = {
  menu: {
    defaultCalendar: "menu",
    read: [
      "menu",
      "family",
      ...(family.agendaCalendarIds ?? [])
        .filter((id) => ![family.menuCalendarId, family.familyCalendarId].includes(id))
        .map((id) => `calendar:${id}`),
    ],
    write: ["menu"],
  },
  ...family.calendarAccess,
  agenda: {
    ...current,
    read: [...new Set([...current.read, ...references])],
    write: [...new Set([...current.write, ...writableReferences])],
  },
};
family.calendarNames = {
  ...family.calendarNames,
  ...Object.fromEntries(selected.map((item) => [item.id, item.summaryOverride ?? item.summary])),
};
validateFamily(family);
for (const item of selected)
  console.log(
    `${item.summaryOverride ?? item.summary}: Google=${item.accessRole}; Nido=${item.writable ? "crear, editar y borrar" : "lectura"}${item.writable && item.accessRole === "reader" ? "; pendiente de ampliar permiso en Google" : ""}.`,
  );
if (apply) {
  if ((await readFile(path, "utf8")) !== original)
    throw new Error("La configuración cambió; vuelve a revisarla.");
  const backup = `${path}.before-calendar-access-${Date.now()}`;
  await copyFile(path, backup);
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(family, null, 2) + "\n", { mode: 0o600 });
  await rename(temporary, path);
  console.log(
    "Configuración guardada con respaldo. Prepara la configuración y recarga los servicios para aplicarla.",
  );
} else
  console.log("Vista previa: no se ha cambiado la configuración. Añade --apply para guardarla.");
