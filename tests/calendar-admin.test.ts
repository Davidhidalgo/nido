import { expect, it } from "vitest";
import { Script } from "node:vm";
import {
  calendarProposal,
  calendarVersion,
  adminBearerMatches,
} from "../integrations/nido-family/src/calendar-admin.js";
import { calendarPanel } from "../integrations/nido-family/src/calendar-panel.js";
import type { FamilyConfig } from "../integrations/nido-family/src/core.js";
import type { IncomingMessage } from "node:http";
const config: FamilyConfig = {
  mode: "demo",
  dataDir: "/tmp/fake",
  menuCalendarId: "meals",
  familyCalendarId: "family",
  writesEnabled: true,
  timeZone: "Europe/Madrid",
};
const available = [
  { id: "meals", summary: "Menú", accessRole: "owner" },
  { id: "family", summary: "Familia", accessRole: "owner" },
  { id: "school", summary: "Escuela", accessRole: "writer" },
  { id: "personal", summary: "Persona", accessRole: "reader" },
];
const selection = () => ({
  version: calendarVersion(config),
  writesEnabled: true,
  defaults: { menu: "menu", agenda: "calendar:school" },
  calendars: available.map((item) => ({
    id: item.id,
    enabled: true,
    shortName: item.summary,
    menu: item.id === "meals" ? "write" : "read",
    agenda: item.id === "school" ? "write" : "read",
  })),
});
it("connects a discovered calendar, selects a default and preserves unrelated settings", () => {
  const next = calendarProposal(config, available, selection());
  expect(next.agendaCalendarIds).toEqual(["school", "personal"]);
  expect(next.calendarAccess?.agenda?.defaultCalendar).toBe("calendar:school");
  expect(next.calendarShortNames?.school).toBe("Escuela");
  expect(next.timeZone).toBe(config.timeZone);
  expect(config.agendaCalendarIds).toBeUndefined();
});
it("rejects Google read-only escalation and preserves explicitly pending permissions", () => {
  const raw = selection();
  raw.calendars[3].agenda = "write";
  expect(() => calendarProposal(config, available, raw)).toThrow(/Google/);
  const pending = {
    ...config,
    agendaCalendarIds: ["personal"],
    calendarAccess: {
      agenda: {
        defaultCalendar: "family" as const,
        read: ["family" as const, "calendar:personal" as const],
        write: ["calendar:personal" as const],
      },
    },
  };
  raw.version = calendarVersion(pending);
  expect(calendarProposal(pending, available, raw).calendarAccess?.agenda?.write).toContain(
    "calendar:personal",
  );
});
it("rejects stale, unknown, duplicate calendars and unreadable defaults", () => {
  const raw = selection();
  raw.version = "a".repeat(64);
  expect(() => calendarProposal(config, available, raw)).toThrow(/cambió/);
  raw.version = calendarVersion(config);
  raw.calendars[2].id = "unknown";
  expect(() => calendarProposal(config, available, raw)).toThrow(/disponible/);
  raw.calendars[2].id = "family";
  expect(() => calendarProposal(config, available, raw)).toThrow(/repetidos/);
  raw.calendars[2].id = "school";
  raw.calendars[2].agenda = "none";
  expect(() => calendarProposal(config, available, raw)).toThrow(/Permisos/);
});
it("enforces menu separation and disconnection without access", () => {
  const raw = selection();
  raw.calendars[2].menu = "write";
  expect(() => calendarProposal(config, available, raw)).toThrow(/Permisos/);
  raw.calendars[2].menu = "none";
  raw.calendars[2].agenda = "none";
  raw.calendars[2].enabled = false;
  raw.defaults.agenda = "family";
  expect(calendarProposal(config, available, raw).agendaCalendarIds).toEqual(["personal"]);
  raw.calendars[0].enabled = false;
  expect(() => calendarProposal(config, available, raw)).toThrow(/permanecer/);
});
it("requires an explicit bearer and never accepts cookies or query credentials", () => {
  const req = (headers: Record<string, string>) => ({ headers }) as IncomingMessage;
  expect(adminBearerMatches(req({ authorization: "Bearer secret" }), "secret")).toBe(true);
  expect(adminBearerMatches(req({ cookie: "token=secret" }), "secret")).toBe(false);
  expect(adminBearerMatches(req({ authorization: "Bearer wrong" }), "secret")).toBe(false);
  expect(adminBearerMatches(req({ authorization: "Bearer secret" }), undefined)).toBe(false);
});
it("embeds names as inert data and emits valid browser JavaScript", () => {
  const html = calendarPanel({ error: "</script><script>alert(1)</script>" });
  expect(html).not.toContain("<script>alert");
  const code = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  expect(code).toBeTruthy();
  expect(() => new Script(code!)).not.toThrow();
});
