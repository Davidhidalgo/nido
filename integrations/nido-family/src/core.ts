import { createHash } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class NidoError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const fail = (code: string, message: string): never => {
  throw new NidoError(code, message);
};
export type CalendarAlias = "menu" | "family" | `calendar:${string}`;
export type When = { date: string } | { dateTime: string; timeZone: string };
export type EventInput = {
  summary: string;
  start: When;
  end: When;
  description?: string;
  location?: string;
};
export type CalendarEvent = EventInput & {
  id: string;
  etag: string;
  status?: string;
  attendees?: unknown[];
  attendeesOmitted?: boolean;
  recurrence?: string[];
  recurringEventId?: string;
  eventType?: string;
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
};
export type EventPatch = Partial<EventInput>;
export interface CalendarPort {
  list(calendar: string, from: string, to: string): Promise<CalendarEvent[]>;
  get(calendar: string, id: string): Promise<CalendarEvent>;
  create(calendar: string, event: EventInput & { id: string }): Promise<CalendarEvent>;
  update(calendar: string, id: string, etag: string, patch: EventPatch): Promise<CalendarEvent>;
  delete(calendar: string, id: string, etag: string): Promise<void>;
}
export type MealTimes = { lunch: string; dinner: string; durationMinutes: number };
export const defaultMealTimes: MealTimes = { lunch: "13:00", dinner: "19:00", durationMinutes: 60 };
export type CalendarAccess = {
  defaultCalendar: CalendarAlias;
  read: CalendarAlias[];
  write: CalendarAlias[];
};
export type FamilyConfig = {
  mode: "demo" | "google";
  dataDir: string;
  familyConfigFile?: string;
  menuCalendarId: string;
  familyCalendarId: string;
  agendaCalendarIds?: string[];
  calendarAccess?: Partial<Record<"menu" | "agenda", CalendarAccess>>;
  calendarNames?: Record<string, string>;
  calendarShortNames?: Record<string, string>;
  writesEnabled: boolean;
  timeZone: string;
  mealTimes?: MealTimes;
};
export function calendarReference(config: FamilyConfig, id: string): CalendarAlias {
  return id === config.menuCalendarId
    ? "menu"
    : id === config.familyCalendarId
      ? "family"
      : `calendar:${id}`;
}
export function calendarAccessFor(config: FamilyConfig, agent: "menu" | "agenda"): CalendarAccess {
  return (
    config.calendarAccess?.[agent] ?? {
      defaultCalendar: agent === "menu" ? "menu" : "family",
      read: [
        ...new Set([
          config.menuCalendarId,
          config.familyCalendarId,
          ...(config.agendaCalendarIds ?? []),
        ]),
      ].map((id) => calendarReference(config, id)),
      write: [agent === "menu" ? "menu" : "family"],
    }
  );
}
export function calendarWritable(config: FamilyConfig, id: string) {
  return (
    config.writesEnabled &&
    calendarAccessFor(config, id === config.menuCalendarId ? "menu" : "agenda").write.includes(
      calendarReference(config, id),
    )
  );
}
export function validateCalendarAccess(config: FamilyConfig) {
  const known = new Set(
    [config.menuCalendarId, config.familyCalendarId, ...(config.agendaCalendarIds ?? [])].map(
      (id) => calendarReference(config, id),
    ),
  );
  for (const [agent, access] of Object.entries(config.calendarAccess ?? {})) {
    if (
      !["menu", "agenda"].includes(agent) ||
      !access ||
      !Array.isArray(access.read) ||
      !Array.isArray(access.write) ||
      access.read.length > 12 ||
      access.write.length > 12 ||
      new Set(access.read).size !== access.read.length ||
      new Set(access.write).size !== access.write.length ||
      access.read.some((ref) => !known.has(ref)) ||
      !access.read.includes(access.defaultCalendar) ||
      access.write.some(
        (ref) => !access.read.includes(ref) || (agent === "menu" ? ref !== "menu" : ref === "menu"),
      )
    )
      fail(
        "CONFIG",
        "Permisos de calendarios inválidos: revisa lectura, escritura, calendario por defecto y separación menú/agenda.",
      );
  }
}
export type Actor = { agentId: string; sessionId: string; toolCallId: string };
export function authorize(agent: string, calendar: CalendarAlias, write = false) {
  if (!["menu", "family"].includes(calendar)) fail("FORBIDDEN", "Calendario no autorizado.");
  if (!["menu", "agenda"].includes(agent))
    fail("FORBIDDEN", "Este agente no tiene acceso a Calendar.");
  if (
    write &&
    ((agent === "menu" && calendar !== "menu") || (agent === "agenda" && calendar !== "family"))
  ) {
    fail("FORBIDDEN", "Este agente no puede escribir en ese calendario.");
  }
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function dateValue(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    fail("INVALID_DATE", "Fecha inexistente.");
  return Date.parse(value);
}
export function validateEvent(event: EventInput) {
  if (!event.summary.trim()) fail("INVALID_EVENT", "Falta el título.");
  if ("date" in event.start !== "date" in event.end)
    fail("INVALID_DATE", "No mezclar días completos y horas.");
  const stamp = (when: When) => {
    if ("date" in when) return dateValue(when.date);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(when.dateTime))
      fail("INVALID_DATE", "La hora requiere segundos y offset explícito.");
    dateValue(when.dateTime.slice(0, 10));
    try {
      new Intl.DateTimeFormat("es", { timeZone: when.timeZone }).format();
    } catch {
      fail("INVALID_DATE", "Zona IANA inválida.");
    }
    const value = Date.parse(when.dateTime);
    if (!Number.isFinite(value)) fail("INVALID_DATE", "Hora inválida.");
    return value;
  };
  if (stamp(event.end) <= stamp(event.start))
    fail("INVALID_DATE", "El final debe ser posterior al inicio; en días completos es exclusivo.");
}
function mutable(event: CalendarEvent) {
  if (event.recurrence || event.recurringEventId)
    fail("UNSUPPORTED", "La edición de recurrencias queda fuera del MVP.");
  if (event.attendees?.length || event.attendeesOmitted)
    fail("UNSUPPORTED", "La edición de eventos con invitados queda fuera del MVP.");
  if (event.eventType && event.eventType !== "default")
    fail("UNSUPPORTED", "Solo se modifican eventos ordinarios.");
  if (event.status === "cancelled") fail("NOT_FOUND", "El evento está eliminado.");
}
export function menuSlot(event: EventInput, timeZone: string, mealTimes = defaultMealTimes) {
  const clock =
    "dateTime" in event.start
      ? new Intl.DateTimeFormat("en-GB", {
          timeZone,
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(new Date(event.start.dateTime))
      : undefined;
  const meal =
    clock === mealTimes.lunch
      ? "comida"
      : clock === mealTimes.dinner
        ? "cena"
        : /^(Comida|Cena) · /i.exec(event.summary)?.[1]?.toLowerCase();
  if (!meal)
    fail(
      "INVALID_MENU",
      `Usa el nombre del plato y el horario de comida (${mealTimes.lunch}) o cena (${mealTimes.dinner}).`,
    );
  const date =
    "date" in event.start
      ? event.start.date
      : new Intl.DateTimeFormat("en-CA", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(event.start.dateTime));
  return `${date}:${meal}`;
}
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, request TEXT NOT NULL, status TEXT NOT NULL, result TEXT, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS preferences (id TEXT PRIMARY KEY, person TEXT NOT NULL, text TEXT NOT NULL, expires TEXT, version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS demo_events (calendar TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(calendar,id));`);
  }
  close() {
    this.db.close();
  }
}
export class DemoCalendar implements CalendarPort {
  constructor(private store: Store) {}
  async list(calendar: string, from: string, to: string) {
    return (
      this.store.db.prepare("SELECT body FROM demo_events WHERE calendar=?").all(calendar) as {
        body: string;
      }[]
    )
      .map((row) => JSON.parse(row.body) as CalendarEvent)
      .filter(
        (e) =>
          Date.parse("date" in e.start ? e.start.date : e.start.dateTime) < Date.parse(to) &&
          Date.parse("date" in e.end ? e.end.date : e.end.dateTime) > Date.parse(from),
      );
  }
  async get(calendar: string, id: string) {
    const row = this.store.db
      .prepare("SELECT body FROM demo_events WHERE calendar=? AND id=?")
      .get(calendar, id) as { body: string } | undefined;
    if (!row) return fail("NOT_FOUND", "Evento inexistente.");
    return JSON.parse(row.body) as CalendarEvent;
  }
  async create(calendar: string, input: EventInput & { id: string }) {
    const event = { ...input, etag: '"1"' };
    const result = this.store.db
      .prepare("INSERT OR IGNORE INTO demo_events VALUES (?,?,?)")
      .run(calendar, input.id, JSON.stringify(event));
    if (!result.changes) fail("CONFLICT", "El evento ya existe.");
    return event;
  }
  async update(calendar: string, id: string, etag: string, patch: EventPatch) {
    const current = await this.get(calendar, id);
    const event = {
      ...current,
      ...patch,
      etag: JSON.stringify(Number(JSON.parse(current.etag)) + 1),
    };
    const result = this.store.db
      .prepare(
        "UPDATE demo_events SET body=? WHERE calendar=? AND id=? AND json_extract(body,'$.etag')=?",
      )
      .run(JSON.stringify(event), calendar, id, etag);
    if (!result.changes) fail("CONFLICT", "El evento cambió. Vuelve a leerlo.");
    return event;
  }
  async delete(calendar: string, id: string, etag: string) {
    const result = this.store.db
      .prepare(
        "DELETE FROM demo_events WHERE calendar=? AND id=? AND json_extract(body,'$.etag')=?",
      )
      .run(calendar, id, etag);
    if (!result.changes) fail("CONFLICT", "El evento cambió o fue eliminado.");
  }
}
export class FamilyService {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    public config: FamilyConfig,
    public store: Store,
    public calendar: CalendarPort,
  ) {
    if (config.menuCalendarId === config.familyCalendarId)
      fail("CONFIG", "Menú y agenda deben usar calendarios distintos.");
    validateCalendarAccess(config);
  }
  private calendarId(actor: Actor, requested: CalendarAlias | undefined, write = false) {
    authorize(actor.agentId, "family");
    const access = calendarAccessFor(this.config, actor.agentId as "menu" | "agenda");
    const alias = requested ?? access.defaultCalendar;
    const id =
      alias === "menu"
        ? this.config.menuCalendarId
        : alias === "family"
          ? this.config.familyCalendarId
          : alias.startsWith("calendar:")
            ? alias.slice("calendar:".length)
            : "";
    if (
      !id ||
      ![
        this.config.menuCalendarId,
        this.config.familyCalendarId,
        ...(this.config.agendaCalendarIds ?? []),
      ].includes(id)
    )
      fail("FORBIDDEN", "Calendario no autorizado.");
    authorize(actor.agentId, id === this.config.menuCalendarId ? "menu" : "family", write);
    const reference = calendarReference(this.config, id);
    if (!access.read.includes(reference))
      fail("FORBIDDEN", "Este agente no puede leer ese calendario.");
    if (write && !this.config.writesEnabled)
      fail("WRITES_DISABLED", "Las escrituras no están activadas.");
    if (write && !access.write.includes(reference))
      fail("FORBIDDEN", "Este calendario es de solo lectura.");
    return id;
  }
  calendars(actor: Actor) {
    authorize(actor.agentId, "family");
    const access = calendarAccessFor(this.config, actor.agentId as "menu" | "agenda");
    return [
      ...new Set([
        this.config.menuCalendarId,
        this.config.familyCalendarId,
        ...(this.config.agendaCalendarIds ?? []),
      ]),
    ]
      .filter((id) => access.read.includes(calendarReference(this.config, id)))
      .map((id) => ({
        calendar: calendarReference(this.config, id),
        name:
          this.config.calendarNames?.[id] ??
          (id === this.config.menuCalendarId
            ? "Menú"
            : id === this.config.familyCalendarId
              ? "Agenda familiar"
              : id),
        readOnly:
          !this.config.writesEnabled || !access.write.includes(calendarReference(this.config, id)),
        shortName: this.config.calendarShortNames?.[id] ?? "",
        isDefault: access.defaultCalendar === calendarReference(this.config, id),
      }));
  }
  async list(actor: Actor, alias: CalendarAlias | undefined, from: string, to: string) {
    const calendar = this.calendarId(actor, alias);
    const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
    if (!instant.test(from) || !instant.test(to))
      fail("INVALID_RANGE", "El intervalo requiere RFC3339 con offset.");
    dateValue(from.slice(0, 10));
    dateValue(to.slice(0, 10));
    const delta = Date.parse(to) - Date.parse(from);
    if (!Number.isFinite(delta) || delta <= 0 || delta > 93 * 86400000)
      fail("INVALID_RANGE", "Consulta un intervalo positivo de hasta 93 días.");
    return this.calendar.list(calendar, from, to);
  }
  async get(actor: Actor, alias: CalendarAlias, id: string) {
    return this.calendar.get(this.calendarId(actor, alias), id);
  }
  private async operation(
    actor: Actor,
    request: unknown,
    run: (operationId: string) => Promise<unknown>,
  ) {
    if (!actor.sessionId || !actor.toolCallId) fail("CONTEXT", "Falta el contexto de ejecución.");
    const id = hash(`${actor.agentId}:${actor.sessionId}:${actor.toolCallId}`);
    const serialized = JSON.stringify({ actor, request });
    const job = async () => {
      const row = this.store.db
        .prepare("SELECT request,status,result FROM operations WHERE id=?")
        .get(id) as { request: string; status: string; result: string } | undefined;
      if (row) {
        if (row.request !== serialized)
          fail("CONFLICT", "La misma operación no puede cambiar de contenido.");
        if (row.status === "done") return JSON.parse(row.result);
        fail(
          "UNCERTAIN",
          "Esta operación ya se intentó. Consulta Calendar antes de decidir el siguiente paso; no repetir a ciegas.",
        );
      }
      this.store.db
        .prepare("INSERT INTO operations VALUES (?,?,?,?,?)")
        .run(id, serialized, "pending", null, new Date().toISOString());
      try {
        const result = await run(id);
        this.store.db
          .prepare("UPDATE operations SET status='done',result=? WHERE id=?")
          .run(JSON.stringify(result), id);
        return result;
      } catch (error) {
        this.store.db
          .prepare("UPDATE operations SET status='uncertain',result=? WHERE id=?")
          .run(JSON.stringify({ code: error instanceof NidoError ? error.code : "ERROR" }), id);
        throw error;
      }
    };
    const result = this.queue.then(job, job);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async vacant(calendar: string, input: EventInput, excluding?: string) {
    const slot = menuSlot(input, this.config.timeZone, this.config.mealTimes);
    const date = slot.split(":")[0]!;
    const start = new Date(Date.parse(date) - 86400000).toISOString();
    const end = new Date(Date.parse(date) + 2 * 86400000).toISOString();
    const events = await this.calendar.list(calendar, start, end);
    if (
      events.some(
        (e) =>
          e.id !== excluding &&
          e.status !== "cancelled" &&
          (() => {
            try {
              return menuSlot(e, this.config.timeZone, this.config.mealTimes) === slot;
            } catch (error) {
              if (error instanceof NidoError && error.code === "INVALID_MENU") return false;
              throw error;
            }
          })(),
      )
    )
      fail(
        "OCCUPIED",
        "Ese hueco del menú está ocupado. Lee el evento y rectifícalo explícitamente.",
      );
    return slot;
  }
  async create(actor: Actor, alias: CalendarAlias | undefined, input: EventInput) {
    const calendar = this.calendarId(actor, alias, true);
    validateEvent(input);
    return this.operation(
      actor,
      { kind: "create", alias: calendarReference(this.config, calendar), input },
      async (op) => {
        if (calendar === this.config.menuCalendarId) await this.vacant(calendar, input);
        const id = `nido${hash(`${calendar}:${op}`)}`;
        return this.calendar.create(calendar, { ...input, id });
      },
    );
  }
  async update(actor: Actor, alias: CalendarAlias, id: string, etag: string, patch: EventPatch) {
    const calendar = this.calendarId(actor, alias, true);
    return this.operation(actor, { kind: "update", alias, id, etag, patch }, async () => {
      const before = await this.calendar.get(calendar, id);
      mutable(before);
      if (before.etag !== etag) fail("CONFLICT", "El evento cambió. Vuelve a leerlo.");
      const after = { ...before, ...patch };
      validateEvent(after);
      if (calendar === this.config.menuCalendarId) {
        menuSlot(before, this.config.timeZone, this.config.mealTimes);
        await this.vacant(calendar, after, id);
      }
      return this.calendar.update(calendar, id, etag, patch);
    });
  }
  async delete(actor: Actor, alias: CalendarAlias, id: string, etag: string) {
    const calendar = this.calendarId(actor, alias, true);
    return this.operation(actor, { kind: "delete", alias, id, etag }, async () => {
      const before = await this.calendar.get(calendar, id);
      mutable(before);
      if (before.etag !== etag) fail("CONFLICT", "El evento cambió. Vuelve a leerlo.");
      if (calendar === this.config.menuCalendarId)
        menuSlot(before, this.config.timeZone, this.config.mealTimes);
      await this.calendar.delete(calendar, id, etag);
      return { deleted: true, id };
    });
  }
  preferences(actor: Actor) {
    authorize(actor.agentId, "menu");
    return this.store.db
      .prepare("SELECT * FROM preferences WHERE expires IS NULL OR expires > ? ORDER BY id")
      .all(
        new Intl.DateTimeFormat("en-CA", {
          timeZone: this.config.timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date()),
      );
  }
  async setPreference(
    actor: Actor,
    input: { id: string; person: string; text: string; expires?: string; expectedVersion: number },
  ) {
    authorize(actor.agentId, "menu", true);
    if (input.expires) dateValue(input.expires);
    return this.operation(actor, { kind: "preference", ...input }, async () => {
      const { id, person, text, expires, expectedVersion } = input;
      const query =
        expectedVersion === 0
          ? this.store.db
              .prepare("INSERT OR IGNORE INTO preferences VALUES (?,?,?,?,1)")
              .run(id, person, text, expires ?? null)
          : this.store.db
              .prepare(
                "UPDATE preferences SET person=?,text=?,expires=?,version=version+1 WHERE id=? AND version=?",
              )
              .run(person, text, expires ?? null, id, expectedVersion);
      if (!query.changes) fail("CONFLICT", "La preferencia cambió. Vuelve a consultarla.");
      return { id, version: expectedVersion + 1 };
    });
  }
  async deletePreference(actor: Actor, id: string, expectedVersion: number) {
    authorize(actor.agentId, "menu", true);
    return this.operation(actor, { kind: "delete_preference", id, expectedVersion }, async () => {
      const result = this.store.db
        .prepare("DELETE FROM preferences WHERE id=? AND version=?")
        .run(id, expectedVersion);
      if (!result.changes) fail("CONFLICT", "La preferencia cambió o no existe.");
      return { deleted: true, id };
    });
  }
}
