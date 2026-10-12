import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../integrations/nido-family/src/core.js";
import { showNote4, note4Events, answerNote4 } from "../integrations/nido-family/src/note4.js";

let dir: string;
let store: Store;
const actor = { agentId: "nido-note4", sessionId: "conversation-a", toolCallId: "call-a" };
const progress = {
  operation: "append",
  cardId: "meal",
  status: "progress",
  title: "Revisando el menú",
  view: { type: "text", body: "Voy a revisar la cena de mañana…" },
};
const question = {
  ...progress,
  cardId: "question",
  status: "question",
  title: "Una pregunta",
  view: {
    type: "binary",
    body: "¿Cambio también la cena del viernes?",
    options: [
      { label: "Sí", answer: "Sí, cambia también la cena del viernes." },
      { label: "No", answer: "No, conserva la cena del viernes." },
    ],
  },
};
const event = {
  ...progress,
  cardId: "event",
  status: "done",
  title: "Evento añadido",
  view: {
    type: "event",
    summary: "Reunión de I2",
    date: "2026-10-15",
    endDate: "2026-10-15",
    startTime: "17:00",
    endTime: "18:00",
    allDay: false,
    durationEstimated: true,
    location: "L'escola bressol",
  },
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nido-note4-"));
  store = new Store(join(dir, "state.sqlite"));
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

it("conserva historial, español y revisiones sin mezclar conversaciones", () => {
  showNote4(store, actor, progress);
  showNote4(
    store,
    { ...actor, toolCallId: "call-b" },
    {
      ...progress,
      operation: "update",
      status: "done",
      title: "DEMO · Cena actualizada",
      view: {
        type: "meal_change",
        date: "2026-09-30",
        meal: "cena",
        before: "Merluza",
        after: "Tortilla con pimientos",
      },
    },
  );
  expect(note4Events(store, actor.sessionId)).toHaveLength(2);
  expect(note4Events(store, "conversation-b")).toEqual([]);
  store.close();
  store = new Store(join(dir, "state.sqlite"));
  expect(note4Events(store, actor.sessionId)[0].data).toEqual(progress);
});

it("deduplica una llamada y rechaza reutilizarla con otro contenido", () => {
  showNote4(store, actor, progress);
  expect(showNote4(store, actor, progress).replay).toBe(true);
  expect(note4Events(store, actor.sessionId)).toHaveLength(1);
  expect(() => showNote4(store, actor, { ...progress, title: "Otro cambio" })).toThrow(
    "otra tarjeta",
  );
});

it("los botones responden a la pregunta concreta una sola vez y producen un aviso", () => {
  expect(showNote4(store, actor, question).alert).toBe("attention");
  expect(() => answerNote4(store, "otra-conversación", "question", "upper")).toThrow();
  expect(answerNote4(store, actor.sessionId, "question", "lower")).toEqual({
    button: "lower",
    answer: question.view.options[1].answer,
  });
  expect(() => answerNote4(store, actor.sessionId, "question", "upper")).toThrow();
  expect(() =>
    showNote4(store, { ...actor, toolCallId: "reopen" }, { ...question, operation: "update" }),
  ).toThrow("cardId nuevo");
  expect(note4Events(store, actor.sessionId).at(-1)?.kind).toBe("answer");
});

it("rechaza una segunda pregunta pendiente y botones después de cerrar una pregunta", () => {
  showNote4(store, actor, question);
  expect(() =>
    showNote4(store, { ...actor, toolCallId: "second" }, { ...question, cardId: "second" }),
  ).toThrow("pendiente");
  showNote4(
    store,
    { ...actor, toolCallId: "close" },
    {
      ...progress,
      cardId: "question",
      operation: "update",
      status: "done",
    },
  );
  expect(() => answerNote4(store, actor.sessionId, "question", "upper")).toThrow();
});

it("limita presentación e identidad, sin permitir payloads arbitrarios ni actualizar tarjetas ajenas", () => {
  expect(() => showNote4(store, { ...actor, agentId: "menu" }, progress)).toThrow("Solo");
  expect(() => showNote4(store, actor, { ...progress, secret: "anything" })).toThrow("inválida");
  expect(() => showNote4(store, actor, { ...question, status: "done" })).toThrow("preguntas");
  expect(() => showNote4(store, actor, { ...progress, operation: "update" })).toThrow("existente");
  showNote4(store, actor, progress);
  expect(() =>
    showNote4(store, { ...actor, sessionId: "other" }, { ...progress, operation: "update" }),
  ).toThrow("existente");
});

it("los resultados parciales y errores piden aviso, el éxito permanece silencioso", () => {
  expect(showNote4(store, actor, { ...progress, status: "partial" }).alert).toBe("failure");
  expect(
    showNote4(
      store,
      { ...actor, toolCallId: "error" },
      { ...progress, operation: "update", status: "error" },
    ).alert,
  ).toBe("failure");
  expect(
    showNote4(
      store,
      { ...actor, toolCallId: "done" },
      { ...progress, operation: "update", status: "done" },
    ).alert,
  ).toBe("none");
});

it("conserva una tarjeta de evento estimado y su rectificación sin activar botones", () => {
  expect(showNote4(store, actor, event).alert).toBe("none");
  expect(() => answerNote4(store, actor.sessionId, event.cardId, "upper")).toThrow();
  const updated = {
    ...event,
    operation: "update",
    title: "Horario actualizado",
    view: { ...event.view, startTime: "18:30", endTime: "19:15", durationEstimated: false },
  };
  showNote4(store, { ...actor, toolCallId: "correct-event" }, updated);
  expect(note4Events(store, actor.sessionId).map((row) => row.data)).toEqual([event, updated]);
});

it("permite eventos de todo el día y horarios que cruzan medianoche", () => {
  showNote4(store, actor, {
    ...event,
    view: { ...event.view, startTime: "", endTime: "", allDay: true, durationEstimated: false },
  });
  showNote4(
    store,
    { ...actor, toolCallId: "overnight" },
    {
      ...event,
      cardId: "overnight",
      view: { ...event.view, startTime: "23:30", endTime: "00:30", endDate: "2026-10-16" },
    },
  );
  expect(note4Events(store, actor.sessionId)).toHaveLength(2);
});

it.each([
  { date: "2026-02-30" },
  { endDate: "2026-10-14" },
  { startTime: "25:00" },
  { startTime: "" },
  { endTime: "17:00" },
  { allDay: true },
  { allDay: true, startTime: "", endTime: "", durationEstimated: true },
])("rechaza intervalos incoherentes en la tarjeta de evento: %j", (patch) => {
  expect(() => showNote4(store, actor, { ...event, view: { ...event.view, ...patch } })).toThrow();
});

it("acepta las nuevas vistas sin cambiar revisiones, avisos ni respuestas con botones", async () => {
  const { default: fixtures } = await import("./fixtures/note4-cards.json");
  for (const { name, card } of fixtures) {
    const result = showNote4(store, { ...actor, toolCallId: name }, card);
    expect(result.card).toEqual(card);
    expect(result.alert).toBe(card.status === "partial" ? "failure" : "none");
    expect(() => answerNote4(store, actor.sessionId, card.cardId, "upper")).toThrow();
  }
  const card = fixtures[0].card;
  expect(showNote4(store, { ...actor, toolCallId: fixtures[0].name }, card).replay).toBe(true);
  showNote4(
    store,
    { ...actor, toolCallId: "refine-list" },
    { ...card, operation: "update", title: "Menú rectificado" },
  );
  expect(note4Events(store, actor.sessionId).at(-1)?.data).toMatchObject({
    title: "Menú rectificado",
  });
});

it.each([
  { type: "list", items: [] },
  { type: "list", items: Array.from({ length: 4 }, () => ({ label: "Uno" })) },
  { type: "list", items: [{ label: "Uno", detail: "x".repeat(81) }] },
  { type: "list", items: [{ label: "Uno", checked: true }] },
  { type: "facts", items: [{ label: "Duración" }] },
  { type: "facts", items: [{ label: "x".repeat(25), value: "Una hora" }] },
  { type: "compare", beforeLabel: "Antes", afterLabel: "Ahora", before: "Uno" },
  { type: "highlight", value: "x".repeat(41), caption: "Dato" },
  { type: "highlight", value: "3", caption: "" },
])("rechaza contenido estructurado fuera del contrato: %j", (view) => {
  expect(() => showNote4(store, actor, { ...progress, status: "done", view })).toThrow("inválida");
});

it("las nuevas vistas informativas no activan una pregunta ni eluden una pregunta pendiente", () => {
  showNote4(store, actor, question);
  expect(() =>
    showNote4(
      store,
      { ...actor, toolCallId: "highlight-question" },
      {
        ...progress,
        cardId: "other",
        status: "question",
        view: { type: "highlight", value: "¿Lo cambio?", caption: "Una pregunta" },
      },
    ),
  ).toThrow("preguntas");
  expect(() => answerNote4(store, actor.sessionId, "other", "lower")).toThrow();
  expect(answerNote4(store, actor.sessionId, question.cardId, "upper").answer).toBe(
    question.view.options[0].answer,
  );
});
