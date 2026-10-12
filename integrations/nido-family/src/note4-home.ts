import { createHash } from "node:crypto";
import {
  menuSlot,
  NidoError,
  type CalendarEvent,
  type CalendarPort,
  type FamilyConfig,
} from "./core.js";

export const validHomeDate = (date: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(date)) &&
  new Date(date).toISOString().slice(0, 10) === date;
export const shiftHomeDate = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const clip = (text: string, bytes: number): string => {
  const clean = text.replace(/\s+/gu, " ").trim();
  if (Buffer.byteLength(clean) <= bytes) return clean;
  let result = "";
  for (const glyph of clean) {
    if (Buffer.byteLength(result + glyph) > bytes - 3) break;
    result += glyph;
  }
  return result.trimEnd() + "…";
};
export type HomeDay = {
  date: string;
  label: string;
  lunch: string;
  dinner: string;
  events: {
    key: string;
    startDate: string;
    endDate: string;
    summary: string;
    calendarLabel: string;
    time: string;
    allDay: boolean;
  }[];
  more: number;
};
export type HomeSnapshot = {
  today: string;
  serverTime: number;
  demo: boolean;
  days: HomeDay[];
};
export async function note4Home(
  calendar: CalendarPort,
  config: FamilyConfig,
  anchor?: string,
  now = new Date(),
): Promise<HomeSnapshot> {
  const dateFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = dateFormat.format(now);
  const center = anchor ?? today;
  if (!validHomeDate(center)) throw new NidoError("INVALID_INPUT", "Fecha inválida.");
  if (Math.abs(Date.parse(center) - Date.parse(today)) > 366 * 86400000)
    throw new NidoError("INVALID_INPUT", "Fecha fuera del intervalo permitido.");
  const start = shiftHomeDate(center, -7),
    end = shiftHomeDate(center, 8);
  // The broad UTC window covers every local day, including DST and positive offsets.
  const from = `${shiftHomeDate(start, -1)}T00:00:00Z`,
    to = `${shiftHomeDate(end, 1)}T00:00:00Z`;
  const [meals, events] = await Promise.all([
    calendar.list(config.menuCalendarId, from, to),
    Promise.all(
      [...new Set([config.familyCalendarId, ...(config.agendaCalendarIds ?? [])])]
        .filter((id) => id !== config.menuCalendarId)
        .map(async (id) =>
          (await calendar.list(id, from, to)).map((event) => ({
            ...event,
            calendarLabel: clip(config.calendarShortNames?.[id] ?? "", 64),
            homeKey: createHash("sha256")
              .update(JSON.stringify([id, event.id]))
              .digest("hex")
              .slice(0, 32),
          })),
        ),
    ).then((groups) => groups.flat()),
  ]);
  const dateOf = (when: CalendarEvent["start"]) =>
    "date" in when ? when.date : dateFormat.format(new Date(when.dateTime));
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: config.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const label = new Intl.DateTimeFormat("es-ES", {
    timeZone: "UTC",
    weekday: "long",
    day: "2-digit",
    month: "short",
  });
  const days = Array.from({ length: 15 }, (_, offset): HomeDay => {
    const date = shiftHomeDate(start, offset);
    const day: HomeDay = {
      date,
      label: label
        .format(new Date(`${date}T12:00:00Z`))
        .replace(/,/gu, "")
        .replace(/ de /gu, " ")
        .replace(/\./gu, ""),
      lunch: "",
      dinner: "",
      events: [],
      more: 0,
    };
    for (const meal of meals) {
      if (meal.status === "cancelled" || dateOf(meal.start) !== date) continue;
      let slot: string;
      try {
        slot = menuSlot(meal, config.timeZone, config.mealTimes);
      } catch {
        continue;
      }
      const key = slot.endsWith(":comida") ? "lunch" : "dinner";
      if (day[key]) throw new NidoError("CONFLICT", "Hay más de un plato para el mismo horario.");
      day[key] = clip(meal.summary.replace(/^(Comida|Cena)\s*·\s*/iu, ""), 160);
    }
    const visible = events
      .filter((event) => {
        if (event.status === "cancelled") return false;
        const first = dateOf(event.start);
        if ("date" in event.end) return first <= date && event.end.date > date;
        const finish = dateFormat.format(new Date(Date.parse(event.end.dateTime) - 1));
        return (
          first <= date &&
          finish >= date &&
          (date !== today || Date.parse(event.end.dateTime) > now.getTime())
        );
      })
      .sort((a, b) => {
        const ongoingA = dateOf(a.start) < date,
          ongoingB = dateOf(b.start) < date;
        if (ongoingA !== ongoingB) return ongoingA ? -1 : 1;
        const allA = "date" in a.start,
          allB = "date" in b.start;
        if (allA !== allB) return allA ? -1 : 1;
        return allA
          ? a.summary.localeCompare(b.summary, "es")
          : Date.parse((a.start as { dateTime: string }).dateTime) -
              Date.parse((b.start as { dateTime: string }).dateTime);
      });
    day.more = Math.max(0, visible.length - 6);
    day.events = visible.slice(0, 6).map((event) => {
      const allDay = "date" in event.start;
      const startDate = dateOf(event.start);
      const endDate =
        "date" in event.end
          ? shiftHomeDate(event.end.date, -1)
          : dateFormat.format(new Date(Date.parse(event.end.dateTime) - 1));
      let time = "todo el día";
      if (!allDay && "dateTime" in event.start && "dateTime" in event.end) {
        time = `${clock.format(new Date(event.start.dateTime))}–${clock.format(new Date(event.end.dateTime))}`;
      }
      return {
        key: event.homeKey,
        calendarLabel: event.calendarLabel,
        startDate,
        endDate,
        summary: clip(event.summary, 128),
        time,
        allDay,
      };
    });
    return day;
  });
  return {
    today,
    serverTime: Math.floor(now.getTime() / 1000),
    demo: config.mode === "demo",
    days,
  };
}
