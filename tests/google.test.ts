import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoogleCalendar } from "../integrations/nido-family/src/google.js";
const event = {
  id: "testevent",
  etag: '"1"',
  summary: "Dentista",
  start: { date: "2026-09-19" },
  end: { date: "2026-09-20" },
};
let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nido-google-"));
  path = join(dir, "credentials.json");
  writeFileSync(path, JSON.stringify({ client_id: "fake-client", refresh_token: "fake-token" }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
function setup(responses: Response[]) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({ access_token: "fake-access", expires_in: 3600 }));
  for (const response of responses) fetcher.mockResolvedValueOnce(response);
  return { client: new GoogleCalendar(path, fetcher, "meals"), fetcher };
}
it("sigue la paginación sin presentar una agenda parcial", async () => {
  const { client, fetcher } = setup([
    json({ items: [event], nextPageToken: "page2" }),
    json({ items: [{ ...event, id: "second" }] }),
  ]);
  expect(await client.list("family", "2026-09-18T00:00:00Z", "2026-09-21T00:00:00Z")).toHaveLength(
    2,
  );
  expect(fetcher.mock.calls[2][0]).toContain("pageToken=page2");
});
it.each([
  [401, "AUTH_REQUIRED"],
  [403, "FORBIDDEN"],
  [404, "NOT_FOUND"],
  [412, "CONFLICT"],
  [429, "RATE_LIMIT"],
  [503, "GOOGLE_ERROR"],
])("HTTP %s no se interpreta como agenda vacía", async (status, code) => {
  const { client } = setup([json({}, status)]);
  await expect(
    client.list("family", "2026-09-18T00:00:00Z", "2026-09-21T00:00:00Z"),
  ).rejects.toMatchObject({ code });
});
it("envía PATCH con If-Match y solo los campos solicitados", async () => {
  const { client, fetcher } = setup([json(event)]);
  await client.update("family/id", event.id, event.etag, { summary: "Nuevo título" });
  const [url, options] = fetcher.mock.calls[1];
  expect(url).toContain("family%2Fid");
  expect(options?.method).toBe("PATCH");
  expect(options?.headers).toMatchObject({ "If-Match": event.etag });
  expect(JSON.parse(options!.body as string)).toEqual({ summary: "Nuevo título" });
});
it("reconcilia un alta cuya respuesta se perdió sin repetir el POST", async () => {
  const { client, fetcher } = setup([]);
  fetcher.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(json(event));
  expect(await client.create("family", event)).toEqual(event);
  expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(2); // OAuth + una única alta
  expect(fetcher.mock.calls[2][1]?.method).toBe("GET");
});
it("no considera éxito un id que pertenece a otro contenido", async () => {
  const { client } = setup([json({}, 409), json({ ...event, summary: "Otro evento" })]);
  await expect(client.create("family", event)).rejects.toMatchObject({ code: "CONFLICT" });
});
it("desactiva recordatorios solo en el calendario del menú", async () => {
  const { client, fetcher } = setup([json(event), json(event)]);
  await client.create("meals", event);
  await client.create("family", event);
  expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toMatchObject({
    reminders: { useDefault: false },
    transparency: "transparent",
  });
  expect(JSON.parse(fetcher.mock.calls[2][1]!.body as string)).not.toHaveProperty("reminders");
});
it("no reconcilia como alta exitosa un evento que ya está cancelado", async () => {
  const { client } = setup([json({}, 409), json({ ...event, status: "cancelled" })]);
  await expect(client.create("family", event)).rejects.toMatchObject({ code: "CONFLICT" });
});

it("consulta nombres y permisos paginados sin acceder a eventos", async () => {
  const first = { id: "personal-a", summary: "Persona A", accessRole: "owner" };
  const second = { id: "personal-b", summary: "Persona B", accessRole: "writer" };
  const { client, fetcher } = setup([
    json({ items: [first], nextPageToken: "next" }),
    json({ items: [second] }),
  ]);
  expect(await client.calendars()).toEqual([first, second]);
  expect(fetcher.mock.calls[1][0]).toContain("/users/me/calendarList?");
  expect(fetcher.mock.calls[1][0]).toContain("showHidden=true");
  expect(fetcher.mock.calls[2][0]).toContain("pageToken=next");
  expect(fetcher.mock.calls.slice(1).every(([url]) => !String(url).includes("/events"))).toBe(true);
});
it("un fallo al comprobar permisos no se interpreta como lista vacía", async () => {
  const { client } = setup([json({}, 403)]);
  await expect(client.calendars()).rejects.toMatchObject({ code: "GOOGLE_ERROR" });
});

it("adopta credenciales renovadas sin reutilizar el token anterior", async () => {
  const { client, fetcher } = setup([json({ items: [] })]);
  await client.calendars();
  writeFileSync(
    path,
    JSON.stringify({ client_id: "fake-client", refresh_token: "replacement-fixture-token" }),
  );
  fetcher
    .mockResolvedValueOnce(json({ access_token: "replacement-access", expires_in: 3600 }))
    .mockResolvedValueOnce(json({ items: [] }));
  await client.calendars();
  expect((fetcher.mock.calls[2][1]!.body as URLSearchParams).get("refresh_token")).toBe(
    "replacement-fixture-token",
  );
  expect(fetcher.mock.calls[3][1]?.headers).toMatchObject({
    Authorization: "Bearer replacement-access",
  });
});
