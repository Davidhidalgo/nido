import { expect, it } from "vitest";
import { note4Home } from "../integrations/nido-family/src/note4-home.js";
import type {
  CalendarEvent,
  CalendarPort,
  FamilyConfig,
} from "../integrations/nido-family/src/core.js";
const config: FamilyConfig = {
  mode: "demo",
  dataDir: "/tmp",
  menuCalendarId: "menu",
  familyCalendarId: "family",
  writesEnabled: false,
  timeZone: "Europe/Madrid",
};
const timed = (id: string, start: string, end: string, summary = id): CalendarEvent => ({
  id,
  etag: id,
  summary,
  start: { dateTime: start, timeZone: config.timeZone },
  end: { dateTime: end, timeZone: config.timeZone },
});
const all = (id: string, start: string, end: string): CalendarEvent => ({
  id,
  etag: id,
  summary: id,
  start: { date: start },
  end: { date: end },
});
const port = (meals: CalendarEvent[], events: CalendarEvent[]): CalendarPort => ({
  list: async (c) => (c === "menu" ? meals : events),
  get: async () => {
    throw Error("unused");
  },
  create: async () => {
    throw Error("read-only");
  },
  update: async () => {
    throw Error("read-only");
  },
  delete: async () => {
    throw Error("read-only");
  },
});
it("shows meals, all-day first, ongoing and next appointments, with a real overflow count", async () => {
  const events = [
    all("Sin cole", "2026-10-01", "2026-10-03"),
    timed("Finished", "2026-10-02T10:00:00+02:00", "2026-10-02T11:00:00+02:00"),
    ...Array.from({ length: 7 }, (_, i) =>
      timed(
        `Appointment ${i}`,
        `2026-10-02T${String(15 + i).padStart(2, "0")}:00:00+02:00`,
        `2026-10-02T${String(16 + i).padStart(2, "0")}:00:00+02:00`,
      ),
    ),
  ];
  const snapshot = await note4Home(
    port(
      [
        timed(
          "Lunch",
          "2026-10-02T13:00:00+02:00",
          "2026-10-02T14:00:00+02:00",
          "Comida · Lentejas",
        ),
      ],
      events,
    ),
    config,
    undefined,
    new Date("2026-10-02T13:30:00Z"),
  );
  expect(snapshot.days).toHaveLength(15);
  const day = snapshot.days.find((d) => d.date === snapshot.today)!;
  expect(day.lunch).toBe("Lentejas");
  expect(day.dinner).toBe("");
  expect(day.events).toHaveLength(6);
  expect(day.more).toBe(2);
  expect(day.events[0]).toMatchObject({
    summary: "Sin cole",
    time: "todo el día",
    allDay: true,
    startDate: "2026-10-01",
    endDate: "2026-10-02",
  });
  expect(day.events.some((e) => e.summary === "Finished")).toBe(false);
  expect(day.events[1].time).toBe("15:00–16:00");
  expect(
    snapshot.days
      .find((d) => d.date === "2026-10-03")!
      .events.some((e) => e.summary === "Sin cole"),
  ).toBe(false);
});
it("uses local dates across midnight and exclusive all-day ends, including DST", async () => {
  const events = [
    all("Trip", "2026-10-24", "2026-10-27"),
    timed("Midnight", "2026-10-24T23:30:00+02:00", "2026-10-25T00:30:00+02:00"),
    timed("Ends midnight", "2026-10-24T23:00:00+02:00", "2026-10-25T00:00:00+02:00"),
    timed("DST", "2026-10-25T02:30:00+02:00", "2026-10-25T02:45:00+01:00"),
  ];
  const snapshot = await note4Home(
    port([], events),
    config,
    "2026-10-25",
    new Date("2026-10-24T20:00:00Z"),
  );
  const next = snapshot.days.find((d) => d.date === "2026-10-25")!;
  expect(next.events.map((e) => e.summary)).toEqual(["Trip", "Midnight", "DST"]);
  expect(next.events[1].time).toBe("23:30–00:30");
  expect(next.events[2].time).toBe("02:30–02:45");
  expect(snapshot.days.find((d) => d.date === "2026-10-27")!.events).toHaveLength(0);
});
it("does not turn read errors or duplicate meals into an empty successful day", async () => {
  const bad = port([], []);
  bad.list = async () => {
    throw Error("offline");
  };
  await expect(note4Home(bad, config, undefined, new Date("2026-10-02T12:00Z"))).rejects.toThrow(
    "offline",
  );
  await expect(
    note4Home(
      port(
        [
          all("Comida · Sopa", "2026-10-02", "2026-10-03"),
          all("Comida · Arroz", "2026-10-02", "2026-10-03"),
        ],
        [],
      ),
      config,
      undefined,
      new Date("2026-10-02T12:00Z"),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
it("rejects invalid anchors and never breaks UTF-8 in display limits", async () => {
  await expect(note4Home(port([], []), config, "2026-02-30")).rejects.toMatchObject({
    code: "INVALID_INPUT",
  });
  const snapshot = await note4Home(
    port([], [all("á".repeat(200), "2026-10-02", "2026-10-03")]),
    config,
    "2026-10-02",
    new Date("2026-10-02T12:00Z"),
  );
  const title = snapshot.days.find((d) => d.date === "2026-10-02")!.events[0].summary;
  expect(Buffer.byteLength(title)).toBeLessThanOrEqual(128);
  expect(title.endsWith("…")).toBe(true);
  expect(title.includes("�")).toBe(false);
});

it("combines extra read-only agenda calendars once without adding meals as events", async () => {
  const ids: string[] = [];
  const adapter = {
    ...port([], []),
    list: async (id: string) => {
      ids.push(id);
      return id === "personal" ? [all("personal-event", "2026-10-03", "2026-10-04")] : [];
    },
  };
  const home = await note4Home(
    adapter,
    { ...config, agendaCalendarIds: ["personal", "family", "menu"] },
    undefined,
    new Date("2026-10-02T10:00:00Z"),
  );
  expect(ids.sort()).toEqual(["family", "menu", "personal"]);
  expect(home.days.find((day) => day.date === "2026-10-03")?.events[0].summary).toBe(
    "personal-event",
  );
});

it("prioritizes a running multi-day event and preserves its identity across daily views", async () => {
  const snapshot = await note4Home(
    port(
      [],
      [
        all("Birthday", "2026-10-02", "2026-10-03"),
        timed("Trip", "2026-10-01T18:00:00+02:00", "2026-10-03T10:00:00+02:00"),
      ],
    ),
    config,
    undefined,
    new Date("2026-10-02T12:00:00Z"),
  );
  const today = snapshot.days.find((day) => day.date === "2026-10-02")!;
  const tomorrow = snapshot.days.find((day) => day.date === "2026-10-03")!;
  expect(today.events[0]).toMatchObject({
    summary: "Trip",
    startDate: "2026-10-01",
    endDate: "2026-10-03",
    time: "18:00–10:00",
  });
  expect(today.events[0].key).toBe(tomorrow.events[0].key);
  expect(today.events[0].key).toMatch(/^[a-f0-9]{32}$/u);
});

it("projects only configured short labels, preserving origin without exposing calendar IDs", async () => {
  const adapter = {
    ...port([], []),
    list: async (id: string) => (id === "menu" ? [] : [all("same-id", "2026-10-02", "2026-10-03")]),
  };
  const snapshot = await note4Home(
    adapter,
    {
      ...config,
      agendaCalendarIds: ["personal@example.test"],
      calendarNames: { "personal@example.test": "Nombre largo privado" },
      calendarShortNames: { family: "Casa", "personal@example.test": "Álex" },
    },
    "2026-10-02",
    new Date("2026-10-02T12:00Z"),
  );
  expect(snapshot.days[7].events.map((event) => event.calendarLabel)).toEqual(["Casa", "Álex"]);
  expect(JSON.stringify(snapshot)).not.toContain("personal@example.test");
  expect(JSON.stringify(snapshot)).not.toContain("Nombre largo privado");
  expect(new Set(snapshot.days[7].events.map((event) => event.key)).size).toBe(2);
});

it.each([
  ["2026-10-02T14:29:59Z", false, false],
  ["2026-10-02T14:30:00Z", true, false],
  ["2026-10-02T21:15:00Z", true, true],
])(
  "attenuates planned meals two hours after configured local time at %s",
  async (stamp, lunchPast, dinnerPast) => {
    const settings = {
      ...config,
      mealTimes: { lunch: "14:30", dinner: "21:15", durationMinutes: 60 },
    };
    const meals = [
      timed("l", "2026-10-02T14:30:00+02:00", "2026-10-02T15:30:00+02:00", "Comida · Sopa"),
      timed("d", "2026-10-02T21:15:00+02:00", "2026-10-02T22:15:00+02:00", "Cena · Tortilla"),
      timed("y", "2026-10-01T14:30:00+02:00", "2026-10-01T15:30:00+02:00", "Comida · Arroz"),
    ];
    const home = await note4Home(port(meals, []), settings, undefined, new Date(stamp));
    expect(home.days.find((d) => d.date === home.today)).toMatchObject({
      lunchPast,
      dinnerPast,
      lunch: "Sopa",
      dinner: "Tortilla",
    });
    expect(
      home.days.filter((d) => d.date !== home.today).every((d) => !d.lunchPast && !d.dinnerPast),
    ).toBe(true);
  },
);

it("does not wrap a late dinner's grace period into the same day", async () => {
  const settings = {
    ...config,
    mealTimes: { lunch: "14:00", dinner: "23:00", durationMinutes: 60 },
  };
  const meals = [
    timed("l", "2026-10-02T14:00:00+02:00", "2026-10-02T15:00:00+02:00", "Arroz"),
    timed("d", "2026-10-02T23:00:00+02:00", "2026-10-03T00:00:00+02:00", "Cena · Sopa"),
  ];
  const home = await note4Home(
    port(meals, []),
    settings,
    undefined,
    new Date("2026-10-02T21:59:00Z"),
  );
  expect(home.days.find((d) => d.date === home.today)).toMatchObject({
    lunchPast: true,
    dinnerPast: false,
  });
});

it.each([
  [30, "2026-10-02T11:29:59Z", false],
  [30, "2026-10-02T11:30:00Z", true],
  [0, "2026-10-02T11:00:00Z", true],
  [null, "2026-10-02T19:00:00Z", false],
])("uses configurable meal dimming (%s minutes) at %s", async (delay, stamp, expected) => {
  const meals = [
    timed("l", "2026-10-02T13:00:00+02:00", "2026-10-02T14:00:00+02:00", "Comida · Sopa"),
  ];
  const home = await note4Home(
    port(meals, []),
    { ...config, mealDimmingMinutes: delay },
    undefined,
    new Date(stamp),
  );
  expect(home.days.find((d) => d.date === home.today)?.lunchPast).toBe(expected);
});

it("orders each menu day independently of configured times, labels and API order", async () => {
  const meals = [
    timed("late", "2026-10-02T21:00:00+02:00", "2026-10-02T22:00:00+02:00", "Comida · Tortilla"),
    timed("early", "2026-10-02T14:00:00+02:00", "2026-10-02T15:00:00+02:00", "Cena · Lentejas"),
    {
      ...timed("cancelled", "2026-10-02T10:00:00+02:00", "2026-10-02T11:00:00+02:00"),
      status: "cancelled",
    },
    timed("single", "2026-10-03T21:00:00+02:00", "2026-10-03T22:00:00+02:00", "Sopa"),
  ];
  const home = await note4Home(
    port(meals, []),
    { ...config, mealTimes: { lunch: "14:30", dinner: "21:30", durationMinutes: 60 } },
    undefined,
    new Date("2026-10-02T12:00Z"),
  );
  expect(home.days.find((d) => d.date === "2026-10-02")).toMatchObject({
    lunch: "Lentejas",
    dinner: "Tortilla",
  });
  expect(home.days.find((d) => d.date === "2026-10-03")).toMatchObject({
    lunch: "Sopa",
    dinner: "",
  });
  meals.push(timed("third", "2026-10-02T18:00:00+02:00", "2026-10-02T19:00:00+02:00"));
  await expect(
    note4Home(port(meals, []), config, undefined, new Date("2026-10-02T12:00Z")),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it.each([
  ["Europe/Madrid", "2026-10-01T22:30:00Z", "2026-10-02T19:00:00Z"],
  ["America/Bogota", "2026-10-02T17:00:00Z", "2026-10-03T02:00:00Z"],
])(
  "groups menu events by their start date in %s, not the UTC or event zone",
  async (timeZone, early, late) => {
    const event = (id: string, start: string) => ({
      ...timed(id, start, new Date(Date.parse(start) + 3600000).toISOString()),
      start: { dateTime: start, timeZone: "UTC" },
    });
    const home = await note4Home(
      port([event("Late", late), event("Early", early)], []),
      { ...config, timeZone },
      "2026-10-02",
      new Date("2026-10-02T12:00:00Z"),
    );
    expect(home.days.find((d) => d.date === "2026-10-02")).toMatchObject({
      lunch: "Early",
      dinner: "Late",
    });
    expect(home.days.filter((d) => d.lunch || d.dinner)).toHaveLength(1);
  },
);

it("orders distinct instants during the repeated autumn hour", async () => {
  const home = await note4Home(
    port(
      [
        timed("Second", "2026-10-25T02:15:00+01:00", "2026-10-25T03:15:00+01:00"),
        timed("First", "2026-10-25T02:45:00+02:00", "2026-10-25T02:45:00+01:00"),
      ],
      [],
    ),
    config,
    "2026-10-25",
    new Date("2026-10-25T12:00:00Z"),
  );
  expect(home.days.find((d) => d.date === "2026-10-25")).toMatchObject({
    lunch: "First",
    dinner: "Second",
  });
});

it.each([
  [
    timed("One", "2026-10-02T14:00:00+02:00", "2026-10-02T15:00:00+02:00"),
    timed("Two", "2026-10-02T12:00:00Z", "2026-10-02T13:00:00Z"),
  ],
  [
    all("All day", "2026-10-02", "2026-10-03"),
    timed("Timed", "2026-10-02T21:00:00+02:00", "2026-10-02T22:00:00+02:00"),
  ],
])("rejects a pair whose order is ambiguous: %j", async (first, second) => {
  await expect(
    note4Home(port([first, second], []), config, undefined, new Date("2026-10-02T12:00:00Z")),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("keeps a single legacy all-day meal and leaves the unplanned dinner undimmed", async () => {
  const home = await note4Home(
    port([all("Cena · Sopa", "2026-10-02", "2026-10-03")], []),
    config,
    undefined,
    new Date("2026-10-02T21:00:00Z"),
  );
  expect(home.days.find((d) => d.date === "2026-10-02")).toMatchObject({
    lunch: "Sopa",
    dinner: "",
    lunchPast: true,
    dinnerPast: false,
  });
});
