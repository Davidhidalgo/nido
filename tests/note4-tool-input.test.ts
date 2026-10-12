import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Value } from "typebox/value";
import { Store } from "../integrations/nido-family/src/core.js";
import { Note4Device } from "../integrations/nido-family/src/note4-device.js";
import { note4Definition, note4Events, showNote4 } from "../integrations/nido-family/src/note4.js";

let directory: string;
let store: Store;
let device: Note4Device | undefined;
const actor = {
  agentId: "nido-note4",
  sessionId: "synthetic-conversation",
  toolCallId: "card-call",
};
const base = {
  operation: "append",
  cardId: "weekly-menu",
  status: "question",
  title: "Una pregunta",
};
const options = [
  { label: "Dos", answer: "Comerán dos personas." },
  { label: "Tres", answer: "Comerán tres personas." },
];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "nido-card-input-"));
  store = new Store(join(directory, "state.sqlite"));
});
afterEach(async () => {
  await device?.idle();
  device = undefined;
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

it.each([
  [
    { type: "text", text: "¿Cuántas personas comerán?" },
    { type: "text", body: "¿Cuántas personas comerán?" },
  ],
  [
    { type: "text", summary: "Comensales", body: "¿Cuántas personas comerán?" },
    { type: "text", body: "Comensales\n¿Cuántas personas comerán?" },
  ],
  [
    { type: "binary", question: "¿Dos o tres personas?", options },
    { type: "binary", body: "¿Dos o tres personas?", options },
  ],
])("admite el alias en el esquema y conserva solo la vista canónica: %j", (view, expected) => {
  const input = { ...base, view };
  const original = structuredClone(input);
  // OpenClaw rejects inputs before the plugin runs; the public schema must admit the alias too.
  expect(Value.Check(note4Definition.parameters, input)).toBe(true);
  const result = showNote4(store, actor, input);
  expect(result.card.view).toEqual(expected);
  expect(note4Events(store, actor.sessionId)[0].data).toEqual(result.card);
  expect(input).toEqual(original);
  expect(showNote4(store, actor, { ...base, view: expected }).replay).toBe(true);
  expect(note4Events(store, actor.sessionId)).toHaveLength(1);
});

it.each([
  { type: "text", body: "Uno", text: "Otro" },
  { type: "binary", body: "Uno", question: "Otro", options },
  { type: "text", summary: "Falta la pregunta" },
  { type: "binary", options },
  { type: "text", text: "x".repeat(241) },
  { type: "text", summary: "Encabezado", body: "x".repeat(240) },
  { type: "text", body: "Una pregunta", privateNotes: "No se envían" },
  { type: "text", question: "Alias de otra vista" },
  { type: "binary", question: "¿Dos o tres?", options: [options[0]] },
  { type: "binary", question: "¿Dos o tres?", options: [options[0], options[0]] },
])("rechaza alias ambiguos, campos ajenos o límites inválidos sin publicar: %j", (view) => {
  expect(() => showNote4(store, actor, { ...base, view })).toThrow();
  expect(note4Events(store, actor.sessionId)).toEqual([]);
});

it("normalizar presentación no cambia permisos, estados, propiedad ni deduplicación", () => {
  const input = { ...base, view: { type: "binary", question: "¿Dos o tres personas?", options } };
  expect(() => showNote4(store, { ...actor, agentId: "menu" }, input)).toThrow("Solo");
  expect(() => showNote4(store, actor, { ...input, status: "done" })).toThrow("preguntas");
  expect(() => showNote4(store, actor, { ...input, operation: "update" })).toThrow("existente");
  showNote4(store, actor, input);
  expect(() => showNote4(store, actor, { ...input, title: "Otro contenido" })).toThrow(
    "otra tarjeta",
  );
  expect(() =>
    showNote4(
      store,
      { ...actor, sessionId: "different-session" },
      { ...input, operation: "update" },
    ),
  ).toThrow("existente");
  expect(note4Events(store, actor.sessionId)).toHaveLength(1);
});

it("entrega la aclaración y acepta su botón aunque el progreso anterior fallase", async () => {
  const calls: { session: string; message: string }[] = [];
  device = new Note4Device(store, {
    transcribe: async () => "Organiza las cenas de los próximos días",
    agent: async (session, message) => {
      calls.push({ session, message });
      const context = { ...actor, sessionId: session };
      if (calls.length === 1) {
        expect(() =>
          showNote4(
            store,
            { ...context, toolCallId: "progress" },
            {
              ...base,
              operation: "update",
              status: "progress",
              view: { type: "text", text: "Preparando las cenas" },
            },
          ),
        ).toThrow("existente");
        const question = {
          ...base,
          view: { type: "binary", question: "¿Dos o tres personas?", options },
        };
        expect(Value.Check(note4Definition.parameters, question)).toBe(true);
        showNote4(store, context, question);
      } else {
        showNote4(
          store,
          { ...context, toolCallId: "answer" },
          {
            ...base,
            operation: "update",
            status: "done",
            view: { type: "text", body: "Aclaración recibida" },
          },
        );
      }
    },
  });
  const audio = Buffer.alloc(3244);
  audio.write("RIFF");
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24);
  audio.writeUInt32LE(32000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write("data", 36);
  audio.writeUInt32LE(audio.length - 44, 40);
  const first = randomUUID();
  device.submit(first, audio);
  await device.idle();
  expect(device.status(first)).toMatchObject({
    phase: "question",
    active: false,
    card: { view: { type: "binary", body: "¿Dos o tres personas?", options } },
  });
  const answer = randomUUID();
  const input = { turnId: first, cardId: base.cardId, button: "lower" as const };
  device.submit(answer, input);
  await device.idle();
  device.submit(answer, input);
  expect(calls).toHaveLength(2);
  expect(calls[1].session).toBe(calls[0].session);
  expect(calls[1].message).toContain("Comerán tres personas.");
  expect(device.status(answer).phase).toBe("done");
  expect(store.db.prepare("SELECT count(*) count FROM operations").get()?.count).toBe(0);
});
