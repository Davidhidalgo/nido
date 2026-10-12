import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, expect, it } from "vitest";
let root: string;
const family = {
  mode: "google",
  menuCalendarId: "meals",
  familyCalendarId: "family",
  writesEnabled: true,
  timeZone: "Europe/Madrid",
  members: ["Persona ficticia"],
  calendarAccess: { menu: { defaultCalendar: "menu", read: ["menu"], write: ["menu"] } },
};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nido-calendar-config-"));
  for (const dir of ["scripts", ".local", "integrations/nido-family/dist"])
    mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
  for (const script of ["calendar-access.mjs", "family-config.mjs"])
    copyFileSync(join(process.cwd(), "scripts", script), join(root, "scripts", script));
  writeFileSync(join(root, ".local/family.json"), JSON.stringify(family));
  // Fake Google metadata only; this fixture cannot access events or the network.
  writeFileSync(
    join(root, "integrations/nido-family/dist/google.js"),
    `export class GoogleCalendar {async calendars() {return ${JSON.stringify([
      { id: "personal-a", summary: "Persona A", accessRole: "owner" },
      { id: "personal-b", summary: "Persona B", accessRole: "reader" },
      { id: "school", summary: "Escuela", accessRole: "owner" },
    ])}}}`,
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const run = (...args: string[]) =>
  execFileSync(process.execPath, [join(root, "scripts/calendar-access.mjs"), ...args], {
    encoding: "utf8",
    stdio: "pipe",
  });
const saved = () => JSON.parse(readFileSync(join(root, ".local/family.json"), "utf8"));
it("previews without mutation and preserves per-agent preferences when applying", () => {
  const args = [
    "--writable-name=Persona A",
    "--pending-writable-name=Persona B",
    "--readable-name=Escuela",
  ];
  expect(run(...args)).toContain("Vista previa");
  expect(saved()).toEqual(family);
  expect(run(...args, "--apply")).toContain("pendiente");
  const config = saved();
  expect(config.calendarAccess.menu).toEqual(family.calendarAccess.menu);
  expect(config.members).toEqual(family.members);
  expect(config.calendarAccess.agenda).toEqual({
    defaultCalendar: "family",
    read: ["menu", "family", "calendar:personal-a", "calendar:personal-b", "calendar:school"],
    write: ["family", "calendar:personal-a", "calendar:personal-b"],
  });
});
it("requires explicit pending authorization for Google read-only access", () => {
  expect(() => run("--writable-name=Persona B", "--apply")).toThrow();
  expect(saved()).toEqual(family);
});
it("does not partially apply a request with an unknown calendar", () => {
  expect(() => run("--writable-name=Persona A", "--readable-name=Unknown", "--apply")).toThrow();
  expect(saved()).toEqual(family);
});
