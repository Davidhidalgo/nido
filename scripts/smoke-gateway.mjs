import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
const config = JSON.parse(await readFile(join(root, ".local/openclaw/openclaw.json"), "utf8"));
assert.equal(
  config.plugins.entries["nido-family"].config.mode,
  "demo",
  "Este smoke test solo admite calendarios simulados.",
);
const base = `http://127.0.0.1:${config.gateway.port}`;
const unauth = await fetch(`${base}/tools/invoke`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ tool: "nido_preferences_list" }),
});
assert.equal(unauth.status, 401);
console.log("✓ El Gateway exige autenticación");
async function call(agentId, tool, args = {}, idempotencyKey = crypto.randomUUID()) {
  const response = await fetch(`${base}/tools/invoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.gateway.auth.token}`,
    },
    body: JSON.stringify({
      agentId,
      sessionKey: `agent:${agentId}:nido-smoke`,
      tool,
      args,
      idempotencyKey,
    }),
  });
  return { status: response.status, body: await response.json() };
}
for (const agent of ["nido", "menu", "agenda"]) {
  assert.equal((await call(agent, "exec", { command: "echo should-not-run" })).status, 404);
}
console.log("✓ Ningún agente familiar tiene terminal");
for (const agent of ["nido", "nido-note4", "menu", "agenda"]) {
  assert.equal((await call(agent, "nido.note4.update", {})).status, 404);
}
assert.match(JSON.stringify((await call("nido", "nido_calendar_create", {})).body), /FORBIDDEN/);
assert.equal((await call("agenda", "nido_preferences_set", {})).status, 404);
assert.equal((await call("menu", "sessions_send", {})).status, 404);
console.log(
  "✓ Coordinador sin escrituras; agenda sin edición de preferencias; menú sin delegación",
);
const blocked = await call("menu", "nido_calendar_create", {
  calendar: "family",
  event: {
    summary: "Prueba prohibida",
    start: { date: "2099-01-01" },
    end: { date: "2099-01-02" },
  },
});
assert.equal(blocked.body.result?.details?.error, "FORBIDDEN", JSON.stringify(blocked.body));
console.log("✓ El agente de menú no puede escribir en agenda, comprobado a través de OpenClaw");
const idempotencyKey = crypto.randomUUID();
const args = {
  calendar: "menu",
  event: {
    summary: "Cena · Prueba de integración",
    start: { date: "2099-01-01" },
    end: { date: "2099-01-02" },
  },
};
const created = await call("menu", "nido_calendar_create", args, idempotencyKey);
assert.equal(created.body.result?.details?.mode, "demo", JSON.stringify(created.body));
assert.ok(created.body.result?.details?.result?.id, JSON.stringify(created.body));
const event = created.body.result.details.result;
const again = await call("menu", "nido_calendar_create", args, idempotencyKey);
assert.equal(again.body.result?.details?.result?.id, event.id, JSON.stringify(again.body));
const removed = await call("menu", "nido_calendar_delete", {
  calendar: "menu",
  id: event.id,
  etag: event.etag,
});
assert.equal(removed.body.result?.details?.result?.deleted, true, JSON.stringify(removed.body));
console.log("✓ Alta, reintento sin duplicación y borrado de un evento simulado");

const configured = config.plugins.entries["nido-family"].config;
for (const reference of (configured.calendarAccess?.agenda?.write ?? []).filter((ref) =>
  ref.startsWith("calendar:"),
)) {
  const catalog = await call("agenda", "nido_calendars_list");
  assert.ok(
    catalog.body.result?.details?.result?.some(
      (item) => item.calendar === reference && !item.readOnly,
    ),
  );
  const denied = await call("menu", "nido_calendar_delete", {
    calendar: reference,
    id: "not-an-event",
    etag: "v1",
  });
  assert.equal(denied.body.result?.details?.error, "FORBIDDEN");
  const create = await call("agenda", "nido_calendar_create", { ...args, calendar: reference });
  const personal = create.body.result?.details?.result;
  assert.ok(personal?.id, JSON.stringify(create.body));
  const update = await call("agenda", "nido_calendar_update", {
    calendar: reference,
    id: personal.id,
    etag: personal.etag,
    patch: { summary: "Cita rectificada" },
  });
  const updated = update.body.result?.details?.result;
  assert.equal(updated?.summary, "Cita rectificada", JSON.stringify(update.body));
  const deleted = await call("agenda", "nido_calendar_delete", {
    calendar: reference,
    id: updated.id,
    etag: updated.etag,
  });
  assert.equal(deleted.body.result?.details?.result?.deleted, true, JSON.stringify(deleted.body));
}
for (const id of (configured.agendaCalendarIds ?? []).filter(
  (id) => !configured.calendarAccess?.agenda?.write.includes(`calendar:${id}`),
)) {
  const denied = await call("agenda", "nido_calendar_delete", {
    calendar: `calendar:${id}`,
    id: "not-an-event",
    etag: "v1",
  });
  assert.equal(denied.body.result?.details?.error, "FORBIDDEN");
}
console.log("✓ Permisos de calendarios adicionales, alta, edición y borrado verificados");

// Exercise the host's input validation as well as Nido's normalization. A unit
// test alone would miss aliases rejected by OpenClaw before the plugin runs.
const cardId = `card-${crypto.randomUUID()}`;
const card = {
  operation: "append",
  cardId,
  status: "progress",
  title: "DEMO · Preparando menú",
  view: { type: "text", text: "Revisando las cenas de prueba" },
};
assert.equal((await call("menu", "note4_mostrar", card)).status, 404);
const missingCard = await call("nido-note4", "note4_mostrar", { ...card, operation: "update" });
assert.equal(missingCard.body.result?.details?.error, "CONFLICT", JSON.stringify(missingCard.body));
const publicationKey = crypto.randomUUID();
const published = await call("nido-note4", "note4_mostrar", card, publicationKey);
assert.deepEqual(
  published.body.result?.details?.result?.card.view,
  {
    type: "text",
    body: card.view.text,
  },
  JSON.stringify(published.body),
);
const replayed = await call("nido-note4", "note4_mostrar", card, publicationKey);
assert.equal(replayed.body.result?.details?.result?.replay, true, JSON.stringify(replayed.body));
const options = [
  { label: "Dos", answer: "Comerán dos personas." },
  { label: "Tres", answer: "Comerán tres personas." },
];
const question = await call("nido-note4", "note4_mostrar", {
  ...card,
  operation: "update",
  status: "question",
  view: { type: "binary", question: "¿Dos o tres personas?", options },
});
assert.deepEqual(
  question.body.result?.details?.result?.card.view,
  {
    type: "binary",
    body: "¿Dos o tres personas?",
    options,
  },
  JSON.stringify(question.body),
);
const ambiguous = await call("nido-note4", "note4_mostrar", {
  ...card,
  operation: "update",
  view: { type: "text", body: "Uno", text: "Otro" },
});
assert.equal(
  ambiguous.body.result?.details?.error,
  "INVALID_INPUT",
  JSON.stringify(ambiguous.body),
);
const closed = await call("nido-note4", "note4_mostrar", {
  ...card,
  operation: "update",
  status: "done",
  view: { type: "text", summary: "DEMO", body: "Prueba terminada" },
});
assert.deepEqual(
  closed.body.result?.details?.result?.card.view,
  {
    type: "text",
    body: "DEMO\nPrueba terminada",
  },
  JSON.stringify(closed.body),
);
console.log("✓ Tarjetas NOTE4: alias normalizados, pregunta, permisos y reintento sin duplicación");
