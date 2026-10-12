import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { AgentContext } from "../integrations/nido-family/src/agent-context.js";
import type { CalendarPort, FamilyConfig } from "../integrations/nido-family/src/core.js";

test.each(["offline", "ambiguous-menu"])(
  "context persists full references beyond the display limit and survives %s refresh",
  async (failure) => {
    const dir = await mkdtemp(join(tmpdir(), "nido-context-"));
    let fails = false;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(
      new Date(),
    );
    const events = Array.from({ length: 8 }, (_, i) => ({
      id: `event-${i}`,
      etag: `version-${i}`,
      summary: "W".repeat(180),
      start: { date: today },
      end: { date: new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10) },
      location: "Lugar",
    }));
    const calendar = {
      list: async (id: string) => {
        if (fails && failure === "offline") throw Error("offline");
        if (fails && id === "menu-id") return events.slice(0, 2);
        return id === "family-id" ? events : [];
      },
    } as CalendarPort;
    const config: FamilyConfig = {
      mode: "demo",
      dataDir: dir,
      timeZone: "Europe/Madrid",
      menuCalendarId: "menu-id",
      familyCalendarId: "family-id",
      writesEnabled: false,
    };
    try {
      const cache = new AgentContext(calendar, config, join(dir, "context.json"));
      const home = await cache.refresh();
      expect(home.days.find((day) => day.date === today)?.events).toHaveLength(6);
      const saved = JSON.parse(await readFile(join(dir, "context.json"), "utf8"));
      expect(saved.events).toHaveLength(8);
      expect(saved.events[0]).toMatchObject({
        calendar: "family",
        id: "event-0",
        etag: "version-0",
        summary: "W".repeat(180),
        location: "Lugar",
      });
      fails = true;
      await expect(cache.refresh()).rejects.toThrow(
        failure === "offline" ? "offline" : "horas de inicio distintas",
      );
      expect(JSON.parse(await readFile(join(dir, "context.json"), "utf8"))).toEqual(saved);
      expect(await cache.context()).toMatchObject({ available: true, stale: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("additional calendar references preserve origin and configured write access", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nido-context-access-"));
  const config: FamilyConfig = {
    mode: "demo",
    dataDir: dir,
    timeZone: "Europe/Madrid",
    menuCalendarId: "meals",
    familyCalendarId: "family",
    agendaCalendarIds: ["personal", "readonly"],
    calendarAccess: {
      agenda: {
        defaultCalendar: "family",
        read: ["family", "calendar:personal", "calendar:readonly"],
        write: ["family", "calendar:personal"],
      },
    },
    writesEnabled: true,
  };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: config.timeZone }).format(new Date());
  const calendar = {
    list: async () => [
      {
        id: "same-id",
        etag: "v1",
        summary: "Evento",
        start: { date: today },
        end: { date: new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10) },
      },
    ],
  } as unknown as CalendarPort;
  try {
    const context = new AgentContext(calendar, config, join(dir, "context.json"));
    await context.refresh();
    expect((await context.context()).events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          calendar: "family",
          sourceCalendarId: "family",
          readOnly: false,
        }),
        expect.objectContaining({
          calendar: "calendar:personal",
          sourceCalendarId: "personal",
          readOnly: false,
        }),
        expect.objectContaining({
          calendar: "calendar:readonly",
          sourceCalendarId: "readonly",
          readOnly: true,
        }),
      ]),
    );
    config.writesEnabled = false;
    await context.refresh();
    expect((await context.context()).events?.every((event) => event.readOnly)).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
