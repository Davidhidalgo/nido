import { describe, it, expect, vi } from "vitest";
import { buildMenu, weekStart, publishMenu, webhookBody } from "../integrations/trmnl/menu.mjs";
const options = {
  start: "2026-10-19",
  timeZone: "Europe/Madrid",
  now: new Date("2026-10-20T10:00:00Z"),
};
const event = (date: string, summary = "Cena · Tortilla") => ({ summary, start: { date } });
describe("TRMNL: proyección de solo lectura", () => {
  it("calcula el lunes con la fecha local y respeta el cambio de año", () => {
    expect(weekStart(new Date("2026-10-18T22:30:00Z"), "Europe/Madrid")).toBe("2026-10-19");
    expect(weekStart(new Date("2027-01-01T12:00:00Z"), "Europe/Madrid")).toBe("2026-12-28");
  });
  it("solo publica títulos de comida/cena, excluyendo privados, cancelados y fuera de rango", () => {
    const menu = buildMenu(
      [
        { ...event("2026-10-19"), description: "privado", attendees: ["correo"], id: "secret-id" },
        event("2026-10-19", "Cumpleaños privado"),
        { ...event("2026-10-20"), status: "cancelled" },
        event("2026-10-26"),
      ],
      options,
    );
    expect(menu.days).toHaveLength(7);
    expect(menu.days[0].dinner).toBe("Tortilla");
    expect(menu.days[1].dinner).toBe("");
    expect(JSON.stringify(menu)).not.toMatch(/privado|correo|secret-id/);
  });
  it("clasifica por fecha local incluso en el cambio de horario", () => {
    const menu = buildMenu(
      [{ summary: "Cena · Sopa", start: { dateTime: "2026-10-24T22:30:00Z" } }],
      options,
    );
    expect(menu.days[6].dinner).toBe("Sopa");
  });
  it("rechaza duplicados en vez de elegir un plato arbitrario", () => {
    expect(() =>
      buildMenu([event("2026-10-19"), event("2026-10-19", "Cena · Sopa")], options),
    ).toThrow(/más de una cena/);
  });
  it("rechaza fechas inexistentes y payloads que exceden el límite en bytes", () => {
    expect(() => buildMenu([], { ...options, start: "2026-02-30" })).toThrow(/fecha/i);
    expect(() =>
      webhookBody(buildMenu([event("2026-10-19", "Cena · " + "é".repeat(1100))], options)),
    ).toThrow(/2000 bytes/);
  });
  it("sustituye los datos completos sin deep_merge para eliminar platos borrados", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const menu = buildMenu([], options);
    await publishMenu(menu, "https://trmnl.com/api/custom_plugins/example", fetcher);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ merge_variables: menu });
    expect(fetcher.mock.calls[0][1].redirect).toBe("error");
  });
  it("no reintenta ni revela el webhook en errores de red", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValue(new Error("https://trmnl.com/api/custom_plugins/SECRET"));
    await expect(
      publishMenu(buildMenu([], options), "https://trmnl.com/api/custom_plugins/SECRET", fetcher),
    ).rejects.toThrow(/URL privada no se muestra/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("no envía a endpoints inseguros y propaga límites del servidor", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    await expect(
      publishMenu(buildMenu([], options), "http://example.com/api/custom_plugins/secret", fetcher),
    ).rejects.toThrow(/HTTPS/);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      publishMenu(buildMenu([], options), "https://trmnl.com/api/custom_plugins/secret", fetcher),
    ).rejects.toThrow(/429/);
  });
});

it("mantiene la plantilla de siete columnas y marca sus pruebas", () => {
  const menu = buildMenu([], { ...options, demo: true });
  expect(menu.week).toBe(`DEMO · ${menu.range}`);
  expect(menu.days[0].short).toBe("lun");
});
