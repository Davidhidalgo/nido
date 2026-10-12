import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
// @ts-expect-error Local script has no TypeScript declaration.
import { loadNote4Runtime } from "../scripts/note4-runtime.mjs";

const roots: string[] = [];
async function fixture(mode = "google", menuCalendarId = "menu@google.test") {
  const root = await mkdtemp(join(tmpdir(), "nido-note4-runtime-"));
  roots.push(root);
  for (const demo of [false, true]) {
    const state = join(root, demo ? ".local/note4/openclaw" : ".local/openclaw");
    await mkdir(state, { recursive: true });
    await writeFile(
      join(state, "openclaw.json"),
      JSON.stringify({
        gateway: { port: demo ? 18790 : 18789 },
        agents: { entries: { "nido-note4": {} } },
        plugins: {
          entries: {
            "nido-family": {
              config: {
                mode: demo ? "demo" : mode,
                menuCalendarId: demo ? "demo-note4-menu" : menuCalendarId,
                familyCalendarId: demo ? "demo-note4-family" : "family@google.test",
                dataDir: join(root, demo ? "demo-data" : "family-data"),
                writesEnabled: true,
              },
            },
          },
        },
      }),
    );
  }
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
test("NOTE4 defaults to the family Gateway and its store, independently of demo state", async () => {
  const root = await fixture();
  const real = await loadNote4Runtime(root);
  const demo = await loadNote4Runtime(root, { demo: true });
  expect(real.config.gateway.port).toBe(18789);
  expect(real.family.mode).toBe("google");
  expect(real.family.dataDir).not.toBe(demo.family.dataDir);
  expect(real.state).not.toBe(demo.state);
  expect(demo.config.gateway.port).toBe(18790);
  expect(demo.family.mode).toBe("demo");
});
test("NOTE4 does not silently fall back to demo calendars", async () => {
  await expect(loadNote4Runtime(await fixture("demo"))).rejects.toThrow("Google");
  await expect(loadNote4Runtime(await fixture("google", "demo-menu"))).rejects.toThrow("Google");
  await expect(loadNote4Runtime(await fixture("google", "family@google.test"))).rejects.toThrow(
    "Google",
  );
});

test("demo family drops real calendar identities and per-agent access", async () => {
  // @ts-expect-error Local operator script.
  const { note4DemoFamily } = await import("../scripts/note4-runtime.mjs");
  const result = note4DemoFamily(
    {
      mode: "google",
      timeZone: "Europe/Madrid",
      menuCalendarId: "real-menu",
      familyCalendarId: "real-family",
      agendaCalendarIds: ["real-personal"],
      calendarNames: { "real-personal": "Persona" },
      calendarAccess: {
        agenda: {
          defaultCalendar: "calendar:real-personal",
          read: ["calendar:real-personal"],
          write: ["calendar:real-personal"],
        },
      },
    },
    "/tmp/demo",
  );
  expect(result).toEqual({
    mode: "demo",
    writesEnabled: true,
    timeZone: "Europe/Madrid",
    menuCalendarId: "demo-note4-menu",
    familyCalendarId: "demo-note4-family",
    dataDir: "/tmp/demo",
  });
});
