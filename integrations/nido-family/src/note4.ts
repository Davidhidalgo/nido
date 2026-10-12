import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { Store, NidoError, type Actor } from "./core.js";

const Text = (maxLength: number) => Type.String({ minLength: 1, maxLength });
const DateText = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
const DisplayTime = Type.String({ pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$|^$" });
const cardDefinition = {
  name: "note4_mostrar",
  description:
    "Publica una tarjeta JSON para NOTE4. Añade un paso nuevo o actualiza una tarjeta propia. Los resultados deben proceder de herramientas, no de suposiciones. Preguntas binarias: superior e inferior corresponden a las opciones en ese orden.",
  parameters: Type.Object(
    {
      operation: Type.Union([Type.Literal("append"), Type.Literal("update")]),
      cardId: Type.String({ pattern: "^[a-zA-Z0-9_-]{1,64}$" }),
      status: Type.Union([
        Type.Literal("progress"),
        Type.Literal("question"),
        Type.Literal("done"),
        Type.Literal("partial"),
        Type.Literal("error"),
      ]),
      title: Text(60),
      affectedDates: Type.Optional(
        Type.Array(DateText, {
          minItems: 1,
          maxItems: 31,
          uniqueItems: true,
          description:
            "Solo en status done después de una modificación guardada y confirmada: todas las fechas afectadas, incluidas las del horario anterior si cambió de día. Omitir en consultas, propuestas, preguntas y errores.",
        }),
      ),
      view: Type.Union([
        Type.Object(
          { type: Type.Literal("text"), body: Text(240) },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            type: Type.Literal("event"),
            summary: Text(120),
            date: DateText,
            endDate: Type.String({
              pattern: "^\\d{4}-\\d{2}-\\d{2}$",
              description:
                "Último día visible, inclusivo; para todo el día resta un día al fin exclusivo de Calendar.",
            }),
            startTime: DisplayTime,
            endTime: DisplayTime,
            allDay: Type.Boolean(),
            durationEstimated: Type.Boolean(),
            location: Type.Optional(Text(120)),
          },
          {
            additionalProperties: false,
            description:
              "Evento guardado: fechas y horas locales en la zona horaria familiar configurada. En todo el día las horas están vacías y durationEstimated es false.",
          },
        ),
        Type.Object(
          {
            type: Type.Literal("meal_change"),
            date: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
            meal: Type.Union([Type.Literal("comida"), Type.Literal("cena")]),
            before: Text(120),
            after: Text(120),
          },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            type: Type.Literal("list"),
            items: Type.Array(
              Type.Object(
                { label: Text(60), detail: Type.Optional(Text(80)) },
                { additionalProperties: false },
              ),
              { minItems: 1, maxItems: 3 },
            ),
          },
          {
            additionalProperties: false,
            description:
              "Hasta tres elementos de menú, agenda o resumen. No son botones ni una lista de compra guardada.",
          },
        ),
        Type.Object(
          {
            type: Type.Literal("facts"),
            items: Type.Array(
              Type.Object({ label: Text(24), value: Text(80) }, { additionalProperties: false }),
              { minItems: 1, maxItems: 3 },
            ),
          },
          {
            additionalProperties: false,
            description: "Ficha de hasta tres datos confirmados, con etiqueta y valor.",
          },
        ),
        Type.Object(
          {
            type: Type.Literal("compare"),
            beforeLabel: Text(20),
            afterLabel: Text(20),
            before: Text(120),
            after: Text(120),
          },
          {
            additionalProperties: false,
            description:
              "Dos bloques para comparar alternativas o un cambio confirmado. Las etiquetas explican qué se compara.",
          },
        ),
        Type.Object(
          {
            type: Type.Literal("highlight"),
            value: Text(40),
            caption: Text(60),
            body: Type.Optional(Text(120)),
          },
          {
            additionalProperties: false,
            description:
              "Una respuesta breve o cifra confirmada en grande, con contexto. No inventes métricas ni porcentajes de progreso.",
          },
        ),
        Type.Object(
          {
            type: Type.Literal("binary"),
            body: Text(240),
            options: Type.Tuple([
              Type.Object({ label: Text(40), answer: Text(120) }, { additionalProperties: false }),
              Type.Object({ label: Text(40), answer: Text(120) }, { additionalProperties: false }),
            ]),
          },
          { additionalProperties: false },
        ),
      ]),
    },
    { additionalProperties: false },
  ),
};
export type Note4Card = Static<typeof cardDefinition.parameters>;

// The wire/storage contract stays strict. Accept only known presentation aliases
// at the tool boundary, where OpenClaw validates before calling showNote4.
export const note4Definition = {
  ...cardDefinition,
  description: `${cardDefinition.description}
Primera publicación: operation="append"; usa "update" solo tras publicar ese cardId con éxito.
Texto: view={type:"text",body:"Texto visible"}. No añadas campos de otras vistas.
Pregunta abierta: status="question", view={type:"text",body:"¿Cuántas personas comerán?"}.
Pregunta binaria: status="question", view={type:"binary",body:"¿Comeréis en casa?",options:[{label:"Sí",answer:"Sí, en casa."},{label:"No",answer:"No, fuera."}]}.
Usa body (máximo 240 caracteres), no text ni question. Si view aparece como unknown, consulta el esquema completo antes de usar otras vistas.
Comprueba el resultado de publicación. Ante un error corrige solo la tarjeta; no repitas la delegación ni escrituras familiares.`,
  parameters: Type.Object(
    {
      ...cardDefinition.parameters.properties,
      view: Type.Union(
        cardDefinition.parameters.properties.view.anyOf.map((view) => {
          if (view.properties.type.const === "text")
            return Type.Object(
              {
                type: Type.Literal("text"),
                body: Type.Optional(Text(240)),
                text: Type.Optional(Text(240)),
                summary: Type.Optional(Text(120)),
              },
              { additionalProperties: false },
            );
          if (view.properties.type.const === "binary")
            return Type.Object(
              {
                ...view.properties,
                body: Type.Optional(Text(240)),
                question: Type.Optional(Text(240)),
              },
              { additionalProperties: false },
            );
          return view;
        }),
      ),
    },
    { additionalProperties: false },
  ),
};

function normalizeCard(raw: unknown): Note4Card {
  if (!Value.Check(note4Definition.parameters, raw))
    throw new NidoError("INVALID_INPUT", "Tarjeta inválida. Consulta el esquema de note4_mostrar.");
  const input = raw as { view: Record<string, unknown> };
  let view = input.view;
  if (view.type === "text" || view.type === "binary") {
    const alias = view.type === "text" ? view.text : view.question;
    if (view.body !== undefined && alias !== undefined && view.body !== alias)
      throw new NidoError(
        "INVALID_INPUT",
        "Tarjeta inválida: body y su alias contienen textos distintos. Usa solo body.",
      );
    const body = view.body ?? alias;
    if (typeof body !== "string")
      throw new NidoError(
        "INVALID_INPUT",
        "Tarjeta inválida: falta view.body con el texto visible.",
      );
    view =
      view.type === "text"
        ? { type: "text", body: view.summary ? `${view.summary}\n${body}` : body }
        : { type: "binary", body, options: view.options };
  }
  const card = { ...input, view };
  if (!Value.Check(cardDefinition.parameters, card))
    throw new NidoError(
      "INVALID_INPUT",
      "Tarjeta inválida. El texto visible completo debe respetar los límites de la vista; usa body sin campos adicionales.",
    );
  return card;
}

export type Note4Event = {
  sequence: number;
  cardId: string;
  kind: "append" | "update" | "answer";
  alert: "none" | "attention" | "failure";
  data: Note4Card | { button: "upper" | "lower"; answer: string };
};

export function note4Alert(card: Note4Card): Note4Event["alert"] {
  return card.status === "question"
    ? "attention"
    : ["error", "partial"].includes(card.status)
      ? "failure"
      : "none";
}

function table(store: Store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS note4_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    session TEXT NOT NULL, call_id TEXT NOT NULL,
    card_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL,
    UNIQUE(session,call_id));`);
}
export function note4Events(store: Store, session: string): Note4Event[] {
  table(store);
  const rows = store.db
    .prepare(
      "SELECT sequence,card_id,kind,body FROM note4_events WHERE session=? ORDER BY sequence",
    )
    .all(session) as {
    sequence: number;
    card_id: string;
    kind: Note4Event["kind"];
    body: string;
  }[];
  return rows.map((row) => ({
    sequence: row.sequence,
    cardId: row.card_id,
    kind: row.kind,
    alert: row.kind === "answer" ? "none" : note4Alert(JSON.parse(row.body)),
    data: JSON.parse(row.body),
  }));
}
export function showNote4(store: Store, actor: Actor, raw: unknown) {
  if (actor.agentId !== "nido-note4")
    throw new NidoError("FORBIDDEN", "Solo nido-note4 publica tarjetas.");
  if (!actor.sessionId || !actor.toolCallId)
    throw new NidoError("CONTEXT", "Falta la sesión o la llamada.");
  const card = normalizeCard(raw);
  if (
    card.affectedDates &&
    (card.status !== "done" ||
      card.affectedDates.some(
        (date) =>
          !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date,
      ))
  )
    throw new NidoError("INVALID_INPUT", "Fechas afectadas inválidas.");
  if (card.view.type === "event") {
    const view = card.view;
    const validDate = (date: string) => {
      const ms = Date.parse(date);
      return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date;
    };
    if (
      !validDate(view.date) ||
      !validDate(view.endDate) ||
      view.endDate < view.date ||
      (view.allDay
        ? view.startTime !== "" || view.endTime !== "" || view.durationEstimated
        : !view.startTime ||
          !view.endTime ||
          `${view.endDate}T${view.endTime}` <= `${view.date}T${view.startTime}`)
    )
      throw new NidoError("INVALID_INPUT", "Intervalo de evento inválido.");
  }
  if ((card.status === "question") !== (card.view.type === "binary")) {
    // Open questions use text, binary questions use options.
    if (!(card.status === "question" && card.view.type === "text"))
      throw new NidoError("INVALID_INPUT", "Opciones binarias solo para preguntas.");
  }
  if (card.view.type === "binary" && card.view.options[0].answer === card.view.options[1].answer)
    throw new NidoError("INVALID_INPUT", "Las opciones deben ser diferentes.");
  table(store);
  const previous = store.db
    .prepare("SELECT body FROM note4_events WHERE session=? AND call_id=?")
    .get(actor.sessionId, actor.toolCallId) as { body: string } | undefined;
  if (previous) {
    if (previous.body !== JSON.stringify(card))
      throw new NidoError("CONFLICT", "La llamada ya publicó otra tarjeta.");
    return { card, alert: note4Alert(card), replay: true };
  }
  const events = note4Events(store, actor.sessionId);
  const current = events.filter((event) => event.cardId === card.cardId).at(-1);
  if (current?.kind === "answer" && card.status === "question")
    throw new NidoError("CONFLICT", "Una nueva pregunta necesita un cardId nuevo.");
  if ((card.operation === "append" && current) || (card.operation === "update" && !current))
    throw new NidoError(
      "CONFLICT",
      "Añadir requiere una tarjeta nueva; actualizar requiere una existente.",
    );
  const pending = new Map<string, Note4Event>();
  for (const event of events) pending.set(event.cardId, event);
  if (
    card.status === "question" &&
    [...pending.values()].some(
      (event) =>
        event.cardId !== card.cardId &&
        event.kind !== "answer" &&
        "status" in event.data &&
        event.data.status === "question",
    )
  )
    throw new NidoError("CONFLICT", "Resuelve la pregunta pendiente antes de publicar otra.");
  store.db
    .prepare("INSERT INTO note4_events(session,call_id,card_id,kind,body) VALUES (?,?,?,?,?)")
    .run(actor.sessionId, actor.toolCallId, card.cardId, card.operation, JSON.stringify(card));
  return { card, alert: note4Alert(card), replay: false };
}

export function answerNote4(
  store: Store,
  session: string,
  cardId: string,
  button: "upper" | "lower",
) {
  if (!["upper", "lower"].includes(button)) throw new NidoError("INVALID_INPUT", "Botón inválido.");
  const latest = note4Events(store, session)
    .filter((event) => event.cardId === cardId)
    .at(-1);
  if (
    !latest ||
    latest.kind === "answer" ||
    !("view" in latest.data) ||
    latest.data.status !== "question" ||
    latest.data.view.type !== "binary"
  )
    throw new NidoError("CONFLICT", "La pregunta ya no admite respuesta con botones.");
  const answer = latest.data.view.options[button === "upper" ? 0 : 1].answer;
  const result = { button, answer };
  store.db
    .prepare("INSERT INTO note4_events(session,call_id,card_id,kind,body) VALUES (?,?,?,?,?)")
    .run(session, `answer:${latest.sequence}`, cardId, "answer", JSON.stringify(result));
  return result;
}
