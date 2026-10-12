import { createHash, randomUUID } from "node:crypto";
import { Store, NidoError } from "./core.js";
import { answerNote4, note4Events, type Note4Card } from "./note4.js";

export type DevicePhase =
  | "transcribing"
  | "working"
  | "done"
  | "question"
  | "error"
  | "uncertain"
  | "cancelled";
type Turn = {
  id: string;
  session: string;
  digest: string;
  phase: DevicePhase;
  created: number;
  message: string | null;
  baseline: number;
  card_json: string | null;
};
export type DeviceReply = {
  turnId: string;
  phase: DevicePhase;
  sequence: number;
  card: Note4Card;
  active: boolean;
  serverTime: number;
  sessionExpiresAt: number;
  affectedDate?: string;
};
export type DeviceWorkers = {
  transcribe: (audio: Buffer, turnId: string) => Promise<string>;
  agent: (session: string, message: string, baseline: number) => Promise<void>;
  cancel?: (session: string) => Promise<void>;
  onError?: (error: unknown, agentStarted: boolean) => void;
  onTiming?: (timing: {
    turnId: string;
    phase: "transcription" | "agent" | "total";
    milliseconds: number;
  }) => void;
};
const textCard = (status: Note4Card["status"], title: string, body: string): Note4Card => ({
  operation: "append",
  cardId: "device-status",
  status,
  title,
  view: { type: "text", body },
});
export function validateWav(audio: Buffer): void {
  // Device protocol deliberately accepts one canonical PCM format only.
  if (
    audio.length < 44 ||
    audio.toString("ascii", 0, 4) !== "RIFF" ||
    audio.toString("ascii", 8, 12) !== "WAVE" ||
    audio.toString("ascii", 12, 16) !== "fmt " ||
    audio.readUInt32LE(16) !== 16 ||
    audio.readUInt16LE(20) !== 1 ||
    audio.readUInt16LE(22) !== 1 ||
    audio.readUInt32LE(24) !== 16000 ||
    audio.readUInt32LE(28) !== 32000 ||
    audio.readUInt16LE(32) !== 2 ||
    audio.readUInt16LE(34) !== 16 ||
    audio.toString("ascii", 36, 40) !== "data" ||
    audio.readUInt32LE(40) !== audio.length - 44 ||
    audio.readUInt32LE(4) !== audio.length - 8 ||
    (audio.length - 44) % 2 !== 0 ||
    audio.length < 3244 ||
    audio.length > 960044
  ) {
    throw new NidoError(
      "INVALID_INPUT",
      "Se necesita WAV PCM16 mono, 16 kHz, entre 0,1 y 30 segundos.",
    );
  }
}
export class Note4Device {
  private busy = false;
  private tasks = new Set<Promise<void>>();
  constructor(
    readonly store: Store,
    private workers: DeviceWorkers,
    private now = Date.now,
  ) {
    store.db
      .exec(`CREATE TABLE IF NOT EXISTS note4_device_session (id INTEGER PRIMARY KEY CHECK(id=1), session TEXT NOT NULL, last_activity INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS note4_device_turns (id TEXT PRIMARY KEY, session TEXT NOT NULL, digest TEXT NOT NULL, phase TEXT NOT NULL, created INTEGER NOT NULL, message TEXT, baseline INTEGER NOT NULL, card_json TEXT);`);
    const sessionColumns = store.db.prepare("PRAGMA table_info(note4_device_session)").all() as {
      name: string;
    }[];
    if (!sessionColumns.some((column) => column.name === "timeout_ms"))
      store.db.exec(
        "ALTER TABLE note4_device_session ADD COLUMN timeout_ms INTEGER NOT NULL DEFAULT 60000",
      );
    if (!sessionColumns.some((column) => column.name === "resume_after_stop"))
      store.db.exec(
        "ALTER TABLE note4_device_session ADD COLUMN resume_after_stop INTEGER NOT NULL DEFAULT 0",
      );
    const columns = store.db.prepare("PRAGMA table_info(note4_device_turns)").all() as {
      name: string;
    }[];
    if (!columns.some((column) => column.name === "card_json"))
      store.db.exec("ALTER TABLE note4_device_turns ADD COLUMN card_json TEXT");
    // A crash may happen after a tool wrote successfully. Never replay it automatically.
    store.db
      .prepare(
        "UPDATE note4_device_turns SET phase='uncertain',message=? WHERE phase IN ('working','transcribing')",
      )
      .run(
        "Se interrumpió la conexión. Puede haberse aplicado un cambio; pide a Nido que lo compruebe.",
      );
  }
  private get(id: string): Turn {
    const row = this.store.db.prepare("SELECT * FROM note4_device_turns WHERE id=?").get(id) as
      | Turn
      | undefined;
    if (!row) throw new NidoError("NOT_FOUND", "Turno desconocido.");
    return row;
  }
  private session(answer: boolean): string {
    const current = this.store.db
      .prepare("SELECT session,last_activity,timeout_ms FROM note4_device_session WHERE id=1")
      .get() as { session: string; last_activity: number; timeout_ms: number } | undefined;
    if (current && this.now() - current.last_activity < current.timeout_ms) return current.session;
    if (answer)
      throw new NidoError(
        "EXPIRED",
        "La pregunta caducó. Responde por voz para abrir otra conversación.",
      );
    const session = randomUUID();
    this.store.db
      .prepare(
        "INSERT INTO note4_device_session(id,session,last_activity,timeout_ms) VALUES(1,?,?,60000) ON CONFLICT(id) DO UPDATE SET session=excluded.session,last_activity=excluded.last_activity,timeout_ms=excluded.timeout_ms,resume_after_stop=0",
      )
      .run(session, this.now());
    return session;
  }
  private set(id: string, phase: DevicePhase, message: string | null = null) {
    this.store.db
      .prepare("UPDATE note4_device_turns SET phase=?,message=? WHERE id=?")
      .run(phase, message, id);
    this.store.db
      .prepare("UPDATE note4_device_session SET last_activity=?,timeout_ms=? WHERE id=1")
      .run(this.now(), phase === "question" ? 180000 : 60000);
  }
  submit(
    id: string,
    input: Buffer | { turnId: string; cardId: string; button: "upper" | "lower" },
  ): DeviceReply {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id))
      throw new NidoError("INVALID_INPUT", "Identificador de turno inválido.");
    if (Buffer.isBuffer(input)) validateWav(input);
    const digest = createHash("sha256")
      .update(Buffer.isBuffer(input) ? input : JSON.stringify(input))
      .digest("hex");
    const prior = this.store.db
      .prepare("SELECT id,digest FROM note4_device_turns WHERE id=?")
      .get(id) as { id: string; digest: string } | undefined;
    if (prior) {
      if (prior.digest !== digest)
        throw new NidoError("CONFLICT", "Este turno ya contiene otra petición.");
      return this.status(id);
    }
    if (this.busy) throw new NidoError("BUSY", "Hay un turno en curso. Espera a que Nido termine.");
    const audio = Buffer.isBuffer(input);
    const session = this.session(!audio);
    const baseline = note4Events(this.store, session).at(-1)?.sequence ?? 0;
    let message: string | undefined;
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      if (!audio) {
        const source = this.get(input.turnId);
        if (
          source.session !== session ||
          source.phase !== "question" ||
          !source.card_json ||
          JSON.parse(source.card_json).cardId !== input.cardId
        )
          throw new NidoError("CONFLICT", "La pregunta ya no está activa.");
        const answer = answerNote4(this.store, session, input.cardId, input.button);
        message = `[Respuesta NOTE4 a tarjeta ${input.cardId}] ${answer.answer}`;
        this.store.db
          .prepare("UPDATE note4_device_turns SET phase='done' WHERE id=?")
          .run(input.turnId);
      }
      this.store.db
        .prepare(
          "INSERT INTO note4_device_turns(id,session,digest,phase,created,message,baseline) VALUES(?,?,?,?,?,?,?)",
        )
        .run(id, session, digest, audio ? "transcribing" : "working", this.now(), null, baseline);
      this.store.db.exec("COMMIT");
    } catch (error) {
      this.store.db.exec("ROLLBACK");
      throw error;
    }
    this.busy = true;
    const task = this.process(id, session, baseline, audio ? input : undefined, message);
    this.tasks.add(task);
    void task.finally(() => this.tasks.delete(task));
    return this.status(id);
  }
  private async process(
    id: string,
    session: string,
    baseline: number,
    audio?: Buffer,
    message?: string,
  ) {
    const began = performance.now();
    const timing = (phase: "transcription" | "agent" | "total", start: number) => {
      try {
        this.workers.onTiming?.({
          turnId: id,
          phase,
          milliseconds: Math.round(performance.now() - start),
        });
      } catch {
        /* Diagnostics must never change a turn's outcome. */
      }
    };
    let agentStarted = false;
    const continuation = this.store.db
      .prepare("SELECT resume_after_stop FROM note4_device_session WHERE id=1 AND session=?")
      .get(session) as { resume_after_stop: number } | undefined;
    if (continuation?.resume_after_stop)
      this.store.db
        .prepare("UPDATE note4_device_session SET resume_after_stop=0 WHERE id=1 AND session=?")
        .run(session);
    try {
      if (audio) {
        const started = performance.now();
        let transcript: string;
        try {
          transcript = (await this.workers.transcribe(audio, id)).trim();
        } finally {
          timing("transcription", started);
        }
        if (!transcript) throw new Error("EMPTY_AUDIO");
        if (this.get(id).phase === "cancelled") return;
        message = continuation?.resume_after_stop
          ? `[Aclaración NOTE4 tras interrumpir el turno]\n${transcript}\nContinúa la petición original con esta aclaración en la misma conversación. Conserva resultados ya confirmados; comprueba operaciones interrumpidas antes de repetir escrituras. Si cambia claramente de tarea, respeta la nueva petición.`
          : `[Audio NOTE4]\n${transcript}`;
        this.set(id, "working");
      }
      agentStarted = true;
      const started = performance.now();
      try {
        await this.workers.agent(session, message!, baseline);
      } finally {
        timing("agent", started);
      }
      if (this.get(id).phase === "cancelled") return;
      const latest = note4Events(this.store, session)
        .filter((e) => e.sequence > baseline && e.kind !== "answer")
        .at(-1);
      if (!latest || !("status" in latest.data) || latest.data.status === "progress")
        throw new Error("NO_FINAL_CARD");
      this.store.db
        .prepare("UPDATE note4_device_turns SET card_json=? WHERE id=?")
        .run(JSON.stringify(latest.data), id);
      this.set(
        id,
        latest.data.status === "question"
          ? "question"
          : latest.data.status === "error"
            ? "error"
            : "done",
      );
    } catch (error) {
      if (this.get(id).phase === "cancelled") return;
      this.workers.onError?.(error, agentStarted);
      this.set(
        id,
        agentStarted ? "uncertain" : "error",
        agentStarted
          ? "No he recibido el resultado completo. Puede haberse aplicado un cambio; pide a Nido que lo compruebe."
          : "No he podido transcribir el audio.",
      );
    } finally {
      timing("total", began);
      this.busy = false;
    }
  }
  status(id: string): DeviceReply {
    const turn = this.get(id);
    const session = this.store.db
      .prepare("SELECT session,last_activity,timeout_ms FROM note4_device_session WHERE id=1")
      .get() as { session: string; last_activity: number; timeout_ms: number } | undefined;
    const latest = note4Events(this.store, turn.session)
      .filter((e) => e.sequence > turn.baseline && e.kind !== "answer")
      .at(-1);
    let card =
      turn.phase === "transcribing"
        ? textCard("progress", "Te he recibido", "Estoy interpretando tu audio…")
        : textCard("progress", "Nido está trabajando", "Estoy preparando la respuesta…");
    if (latest && "status" in latest.data) card = latest.data;
    if (turn.card_json) card = JSON.parse(turn.card_json);
    if (turn.message)
      card = textCard(
        "error",
        turn.phase === "uncertain" ? "Revisar resultado" : "No he podido escuchar",
        turn.message,
      );
    return {
      turnId: id,
      phase: turn.phase,
      sequence: latest?.sequence ?? turn.baseline,
      card,
      active: ["transcribing", "working"].includes(turn.phase),
      serverTime: Math.floor(this.now() / 1000),
      ...(turn.phase === "done" && card.status === "done" && card.affectedDates?.length === 1
        ? { affectedDate: card.affectedDates[0] }
        : {}),
      sessionExpiresAt:
        session?.session === turn.session
          ? Math.ceil((session.last_activity + session.timeout_ms) / 1000)
          : 0,
    };
  }
  async cancel(id: string, continueSession = false) {
    const turn = this.get(id);
    if (!["transcribing", "working"].includes(turn.phase)) return this.status(id);
    if (turn.phase === "working" && !this.workers.cancel)
      throw new NidoError("UNAVAILABLE", "No se puede detener el agente.");
    this.set(id, "cancelled");
    try {
      if (turn.phase === "working") await this.workers.cancel!(turn.session);
    } catch (error) {
      this.set(
        id,
        "uncertain",
        "No he podido confirmar la parada. Puede haberse aplicado un cambio.",
      );
      throw error;
    }
    await this.idle();
    this.store.db
      .prepare(
        "UPDATE note4_device_session SET last_activity=?,resume_after_stop=? WHERE id=1 AND session=?",
      )
      .run(continueSession ? this.now() : 0, continueSession ? 1 : 0, turn.session);
    return this.status(id);
  }
  dismiss() {
    if (this.busy) throw new NidoError("BUSY", "Hay un turno en curso.");
    // Closing a pending question also ends its agent context, so voice cannot revive it.
    const session = this.store.db
      .prepare("SELECT session FROM note4_device_session WHERE id=1")
      .get() as { session: string } | undefined;
    if (
      session &&
      this.store.db
        .prepare("SELECT id FROM note4_device_turns WHERE session=? AND phase='question'")
        .get(session.session)
    ) {
      this.store.db
        .prepare("UPDATE note4_device_turns SET phase='done' WHERE session=? AND phase='question'")
        .run(session.session);
      this.store.db.prepare("UPDATE note4_device_session SET last_activity=0 WHERE id=1").run();
    }
  }
  async idle() {
    await Promise.all(this.tasks);
  }
}
