import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
const template = readFileSync("integrations/trmnl/calendar-full.liquid", "utf8");
const script = template.split("<script>")[1].split("(function ()")[0];
function week(events: unknown, now = "2026-09-23T00:00:00+02:00") {
  return runInNewContext(script + "\nnidoCalendarWeek(events, now)", { events, now });
}
describe("menú desde el plugin nativo Calendar de TRMNL", () => {
  it("mantiene los días pasados de la semana y separa comida y cena", () => {
    const data = week([
      { summary: "Comida · Lentejas", start_full: "2026-09-21T13:00:00+02:00" },
      { summary: "Cena · Sopa", date_time: "2026-09-23T19:00:00+02:00" },
      { summary: "Cumpleaños", start_full: "2026-09-23T19:00:00+02:00" },
    ]);
    expect(data.days).toHaveLength(7);
    expect(data.days[0].lunch).toEqual(["Lentejas"]);
    expect(data.days[2].dinner).toEqual(["Sopa"]);
  });
  it("respeta medianoche, cambio de año y cambio de hora", () => {
    expect(week([], "2026-09-20T22:30:00Z").days[0].date).toBe("2026-09-21");
    expect(week([], "2027-01-01T12:00:00Z").days[0].date).toBe("2026-12-28");
    expect(
      week([{ summary: "Cena · Sopa", start_full: "2026-10-24T22:30:00Z" }], "2026-10-25T12:00:00Z")
        .days[6].dinner,
    ).toEqual(["Sopa"]);
  });
  it("no confunde fuente ausente con calendario vacío", () => {
    expect(() => week(null)).toThrow(/Selecciona/);
    expect(week([]).days[0].lunch).toEqual([]);
    expect(() => week([{ summary: "Cena · Sopa", start: "19:00" }])).toThrow(/formato/);
  });
  it("detecta duplicados, omite cancelados y no incorpora datos privados", () => {
    const e = {
      summary: "Cena · Sopa",
      start_full: "2026-09-23T19:00:00+02:00",
      description: "secreto",
    };
    expect(week([e, e]).conflicts).toBe(true);
    expect(week([e, { ...e, status: "cancelled" }]).conflicts).toBe(false);
    expect(JSON.stringify(week([e]))).not.toContain("secreto");
  });
});
