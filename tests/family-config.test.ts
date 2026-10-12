import { expect, test } from "vitest";
// @ts-expect-error Local operator script.
import { validateFamily } from "../scripts/family-config.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { note4Home } from "../integrations/nido-family/src/note4-home.js";
import {
  Store,
  DemoCalendar,
  FamilyService,
  menuSlot,
} from "../integrations/nido-family/src/core.js";
const family = {
  mode: "demo",
  writesEnabled: true,
  menuCalendarId: "a",
  familyCalendarId: "b",
  timeZone: "America/Bogota",
  mealTimes: { lunch: "12:30", dinner: "20:15", durationMinutes: 45 },
};
test("the legacy schedule helper uses the family zone and minutes", () => {
  validateFamily(family);
  const meal = {
    summary: "Sopa",
    start: { dateTime: "2026-10-02T01:15:00Z", timeZone: "America/Bogota" },
    end: { dateTime: "2026-10-02T02:00:00Z", timeZone: "America/Bogota" },
  };
  expect(menuSlot(meal, family.timeZone, family.mealTimes)).toBe("2026-10-01:cena");
  expect(() => menuSlot(meal, family.timeZone)).toThrow("horario");
});
test("invalid schedules and zones fail before configuration is written", () => {
  expect(() => validateFamily({ ...family, timeZone: "Invalid/Zone" })).toThrow();
  expect(() =>
    validateFamily({
      ...family,
      mealTimes: { lunch: "25:00", dinner: "20:00", durationMinutes: 60 },
    }),
  ).toThrow("Horarios");
  expect(() =>
    validateFamily({
      ...family,
      mealTimes: { lunch: "20:00", dinner: "20:00", durationMinutes: 60 },
    }),
  ).toThrow("Horarios");
});

test("menu capacity and NOTE4 assignment use local dates across UTC midnight", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nido-meals-"));
  const store = new Store(join(dir, "data.sqlite"));
  const calendar = new DemoCalendar(store);
  const config = { ...family, mode: "demo" as const, dataDir: dir };
  const service = new FamilyService(config, store, calendar);
  const actor = { agentId: "menu", sessionId: "fixture", toolCallId: "first" };
  const meal = {
    summary: "Sopa",
    start: { dateTime: "2026-10-02T01:15:00Z", timeZone: family.timeZone },
    end: { dateTime: "2026-10-02T02:00:00Z", timeZone: family.timeZone },
  };
  try {
    await service.create(actor, "menu", meal);
    await expect(
      service.create({ ...actor, toolCallId: "duplicate" }, "menu", {
        ...meal,
        start: { dateTime: "2026-10-01T20:15:00-05:00", timeZone: family.timeZone },
      }),
    ).rejects.toMatchObject({ code: "OCCUPIED" });
    const earlier = {
      summary: "Arroz",
      start: { dateTime: "2026-10-01T17:30:00Z", timeZone: family.timeZone },
      end: { dateTime: "2026-10-01T18:15:00Z", timeZone: family.timeZone },
    };
    await service.create({ ...actor, toolCallId: "earlier" }, "menu", earlier);
    await expect(
      service.create({ ...actor, toolCallId: "third" }, "menu", {
        ...meal,
        start: { dateTime: "2026-10-02T03:00:00Z", timeZone: family.timeZone },
        end: { dateTime: "2026-10-02T04:00:00Z", timeZone: family.timeZone },
      }),
    ).rejects.toMatchObject({ code: "OCCUPIED" });
    await service.create({ ...actor, toolCallId: "next-day" }, "menu", {
      ...meal,
      summary: "Pasta",
      start: { dateTime: "2026-10-02T17:30:00Z", timeZone: family.timeZone },
      end: { dateTime: "2026-10-02T18:15:00Z", timeZone: family.timeZone },
    });
    const snapshot = await note4Home(
      calendar,
      config,
      "2026-10-01",
      new Date("2026-10-01T18:00:00Z"),
    );
    expect(snapshot.days.find((day) => day.date === "2026-10-01")).toMatchObject({
      lunch: "Arroz",
      dinner: "Sopa",
    });
    expect(snapshot.days.find((day) => day.date === "2026-10-02")).toMatchObject({
      lunch: "Pasta",
      dinner: "",
    });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("additional write access is explicit, bounded and separate from menu", () => {
  const config = {
    ...family,
    agendaCalendarIds: ["personal"],
    calendarAccess: {
      agenda: {
        defaultCalendar: "calendar:personal",
        read: ["calendar:personal"],
        write: ["calendar:personal"],
      },
    },
    calendarNames: { personal: "Persona de ejemplo" },
  };
  expect(() => validateFamily(config)).not.toThrow();
  for (const ids of [["outside"], ["a"], ["personal", "personal"], null, "personal"]) {
    expect(() =>
      validateFamily({
        ...config,
        calendarAccess: { agenda: { ...config.calendarAccess.agenda, write: ids } },
      }),
    ).toThrow();
  }
  expect(() =>
    validateFamily({ ...config, calendarNames: { outside: "No configurado" } }),
  ).toThrow();
});

test("short calendar labels belong only to configured calendars and have a bounded length", () => {
  expect(() => validateFamily({ ...family, calendarShortNames: { b: "Casa" } })).not.toThrow();
  for (const names of [{ outside: "Casa" }, { b: " " }, { b: "x".repeat(17) }, null]) {
    expect(() => validateFamily({ ...family, calendarShortNames: names })).toThrow("cortos");
  }
});
