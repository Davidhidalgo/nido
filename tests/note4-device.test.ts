import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { Store } from "../integrations/nido-family/src/core.js";
import { Note4Device, validateWav } from "../integrations/nido-family/src/note4-device.js";
import { deviceHandler } from "../integrations/nido-family/src/note4-http.js";
import { showNote4 } from "../integrations/nido-family/src/note4.js";
let directory: string;
let store: Store;
let device: Note4Device;
let server: Server | undefined;
let now = 1000000;
let calls: { session: string; message: string }[];
function wav() {
  const data = Buffer.alloc(3244);
  data.write("RIFF", 0);
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24);
  data.writeUInt32LE(32000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(data.length - 44, 40);
  return data;
}
function make({ empty = false, binary = false, fail = false } = {}) {
  return new Note4Device(
    store,
    {
      transcribe: async () => (empty ? "" : "Nos faltan pimientos"),
      agent: async (session, message) => {
        calls.push({ session, message });
        if (fail) throw new Error("Gateway disconnected after a possible write");
        const id = randomUUID();
        showNote4(
          store,
          { agentId: "nido-note4", sessionId: session, toolCallId: id },
          {
            operation: "append",
            cardId: id,
            status: binary && calls.length === 1 ? "question" : "done",
            title: "Respuesta",
            view:
              binary && calls.length === 1
                ? {
                    type: "binary",
                    body: "¿Tortilla o sopa?",
                    options: [
                      { label: "Tortilla", answer: "Prefiero tortilla" },
                      { label: "Sopa", answer: "Prefiero sopa" },
                    ],
                  }
                : { type: "text", body: "Resultado confirmado" },
          },
        );
      },
    },
    () => now,
  );
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "note4-transport-"));
  store = new Store(join(directory, "db.sqlite"));
  calls = [];
  now = 1000000;
});
afterEach(async () => {
  await device?.idle();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  store.close();
  rmSync(directory, { recursive: true, force: true });
});
it("rejects malformed, truncated or noncanonical audio before invoking an agent", () => {
  validateWav(wav());
  for (const audio of [
    Buffer.alloc(44),
    wav().subarray(0, 300),
    Buffer.concat([wav(), Buffer.from("extra")]),
  ])
    expect(() => validateWav(audio)).toThrow();
  device = make();
  const input = wav();
  input.writeUInt16LE(2, 22);
  expect(() => device.submit(randomUUID(), input)).toThrow();
  expect(calls).toHaveLength(0);
});
it("replays an accepted upload without repeating the action and rejects changed bytes", async () => {
  device = make();
  const id = randomUUID();
  device.submit(id, wav());
  expect(device.submit(id, wav()).active).toBe(true);
  expect(() => device.submit(randomUUID(), wav())).toThrow("turno en curso");
  await device.idle();
  expect(device.status(id).phase).toBe("done");
  device.submit(id, wav());
  expect(calls).toHaveLength(1);
  const changed = wav();
  changed[100] = 1;
  expect(() => device.submit(id, changed)).toThrow("otra petición");
});
it("keeps conversation context and expires it from completion, not polling", async () => {
  device = make();
  const first = randomUUID();
  device.submit(first, wav());
  await device.idle();
  const expiry = device.status(first).sessionExpiresAt;
  expect(expiry).toBe((now + 60000) / 1000);
  now += 59000;
  device.status(first);
  expect(device.status(first).sessionExpiresAt).toBe(expiry);
  device.submit(randomUUID(), wav());
  await device.idle();
  expect(calls[0].session).toBe(calls[1].session);
  expect(device.status(first).sessionExpiresAt).toBe((now + 60000) / 1000);
  now += 60000;
  device.status(first);
  device.submit(randomUUID(), wav());
  await device.idle();
  expect(calls[2].session).not.toBe(calls[1].session);
  expect(device.status(first).sessionExpiresAt).toBe(0);
});
it("does not run the agent for empty transcription and does not repeat an uncertain turn", async () => {
  device = make({ empty: true });
  const empty = randomUUID();
  device.submit(empty, wav());
  await device.idle();
  expect(device.status(empty).phase).toBe("error");
  expect(calls).toHaveLength(0);
  device = make({ fail: true });
  const unknown = randomUUID();
  device.submit(unknown, wav());
  await device.idle();
  expect(device.status(unknown).phase).toBe("uncertain");
  device.submit(unknown, wav());
  expect(calls).toHaveLength(1);
});
it("binds a binary answer to its question once and preserves the old card", async () => {
  device = make({ binary: true });
  const question = randomUUID();
  device.submit(question, wav());
  await device.idle();
  const card = device.status(question).card;
  expect(() =>
    device.submit(randomUUID(), { turnId: question, cardId: "wrong", button: "upper" }),
  ).toThrow();
  const answer = randomUUID();
  device.submit(answer, { turnId: question, cardId: card.cardId, button: "upper" });
  await device.idle();
  device.submit(answer, { turnId: question, cardId: card.cardId, button: "upper" });
  expect(calls).toHaveLength(2);
  expect(calls[1].session).toBe(calls[0].session);
  expect(calls[1].message).toContain("Prefiero tortilla");
  expect(device.status(question).card).toEqual(card);
  expect(() =>
    device.submit(randomUUID(), { turnId: question, cardId: card.cardId, button: "lower" }),
  ).toThrow();
});
it("refuses expired button answers and recovers interrupted turns without executing them", async () => {
  device = make({ binary: true });
  const question = randomUUID();
  device.submit(question, wav());
  await device.idle();
  expect(device.status(question).sessionExpiresAt).toBe((now + 180000) / 1000);
  now += 179000;
  expect(device.status(question).phase).toBe("question");
  now += 1000;
  expect(() =>
    device.submit(randomUUID(), {
      turnId: question,
      cardId: device.status(question).card.cardId,
      button: "upper",
    }),
  ).toThrow("caducó");
  store.db.prepare("UPDATE note4_device_turns SET phase='working' WHERE id=?").run(question);
  device = make();
  expect(device.status(question).phase).toBe("uncertain");
  expect(calls).toHaveLength(1);
});
it("authenticates HTTP before accepting audio and rejects oversized inputs", async () => {
  device = make();
  server = createServer(deviceHandler(device, "test-secret"));
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const endpoint = `http://127.0.0.1:${address.port}/v1/turns/${randomUUID()}`;
  expect(
    (
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: wav(),
      })
    ).status,
  ).toBe(401);
  expect(calls).toHaveLength(0);
  expect(
    (
      await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: "Bearer test-secret", "Content-Type": "application/json" },
        body: "x".repeat(1100),
      })
    ).status,
  ).toBe(413);
  expect(
    (
      await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: "Bearer test-secret", "Content-Type": "audio/wav" },
        body: wav(),
      })
    ).status,
  ).toBe(202);
  await device.idle();
  expect(calls).toHaveLength(1);
});

it("entrega las nuevas vistas al firmware v2 y texto compatible al antiguo sin cambiar el historial", async () => {
  const { default: fixtures } = await import("./fixtures/note4-cards.json");
  let current: { name: string; card: unknown } = fixtures[0];
  device = new Note4Device(
    store,
    {
      transcribe: async () => "Prueba visual sintética",
      agent: async (session) => {
        showNote4(
          store,
          { agentId: "nido-note4", sessionId: session, toolCallId: current.name },
          current.card,
        );
      },
    },
    () => now,
  );
  server = createServer(deviceHandler(device, "test-secret"));
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  for (const fixture of fixtures) {
    current = fixture;
    const id = randomUUID();
    const endpoint = `http://127.0.0.1:${address.port}/v1/turns/${id}`;
    await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-secret",
        "Content-Type": "audio/wav",
        "X-Nido-Card-Version": "2",
      },
      body: wav(),
    });
    await device.idle();
    const modern = await (
      await fetch(endpoint, {
        headers: { Authorization: "Bearer test-secret", "X-Nido-Card-Version": "2" },
      })
    ).json();
    const legacy = await (
      await fetch(endpoint, { headers: { Authorization: "Bearer test-secret" } })
    ).json();
    expect(modern.card).toEqual(fixture.card);
    expect(legacy.card.view.type).toBe("text");
    expect(legacy.card.view.body.length).toBeLessThanOrEqual(240);
    expect(legacy.card.status).toBe(fixture.card.status);
    expect(legacy.card.cardId).toBe(fixture.card.cardId);
    expect(device.status(id).card).toEqual(fixture.card);
  }
  current = {
    name: "unicode-limit",
    card: {
      operation: "append",
      cardId: "unicode-limit",
      status: "done",
      title: "Comparación",
      view: {
        type: "compare",
        beforeLabel: "Anterior",
        afterLabel: "Alternativa",
        before: "🙂".repeat(60),
        after: "🙂".repeat(60),
      },
    },
  };
  const id = randomUUID();
  device.submit(id, wav());
  await device.idle();
  const response = await (
    await fetch(`http://127.0.0.1:${address.port}/v1/turns/${id}`, {
      headers: { Authorization: "Bearer test-secret" },
    })
  ).json();
  expect(response.card.view.body.length).toBeLessThanOrEqual(240);
  expect(response.card.view.body.endsWith("…")).toBe(true);
  expect(response.card.view.body).not.toMatch(
    /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u,
  );
});

it("dismisses a pending question without allowing a stale button answer to revive it", async () => {
  device = make({ binary: true });
  const id = randomUUID();
  device.submit(id, wav());
  await device.idle();
  const question = device.status(id);
  expect(question.phase).toBe("question");
  device.dismiss();
  expect(() =>
    device.submit(randomUUID(), { turnId: id, cardId: question.card.cardId, button: "upper" }),
  ).toThrow();
  device.submit(randomUUID(), wav());
  await device.idle();
  expect(calls[1].session).not.toBe(calls[0].session);
});

it("returns an affected date only for a final confirmed change", async () => {
  device = new Note4Device(
    store,
    {
      transcribe: async () => "Cambio",
      agent: async (session) => {
        showNote4(
          store,
          { agentId: "nido-note4", sessionId: session, toolCallId: randomUUID() },
          {
            operation: "append",
            cardId: "changed",
            status: "done",
            title: "Cena actualizada",
            affectedDates: ["2026-10-02"],
            view: { type: "text", body: "Cambio guardado" },
          },
        );
      },
    },
    () => now,
  );
  const id = randomUUID();
  device.submit(id, wav());
  await device.idle();
  expect(device.status(id).affectedDate).toBe("2026-10-02");
});

it("authenticates the read-only home endpoint and validates its query before reading calendars", async () => {
  device = make();
  let reads = 0;
  server = createServer(
    deviceHandler(device, "test-secret", async (date, installedVersion) => {
      reads++;
      return { date, installedVersion };
    }),
  );
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/v1/home`;
  expect((await fetch(url)).status).toBe(401);
  expect(reads).toBe(0);
  expect(
    (
      await fetch(url + "?date=2026-10-02&date=2026-10-03", {
        headers: { Authorization: "Bearer test-secret" },
      })
    ).status,
  ).toBe(400);
  expect(reads).toBe(0);
  const result = await fetch(url + "?date=2026-10-02", {
    headers: { Authorization: "Bearer test-secret" },
  });
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ date: "2026-10-02" });
  expect(reads).toBe(1);
  const versioned = await fetch(url, {
    headers: { Authorization: "Bearer test-secret", "X-Nido-Firmware-Version": "nido-ota-0.4.8" },
  });
  expect(await versioned.json()).toEqual({ installedVersion: "nido-ota-0.4.8" });
  const invalid = await fetch(url, {
    headers: { Authorization: "Bearer test-secret", "X-Nido-Firmware-Version": "untrusted" },
  });
  expect(await invalid.json()).toEqual({});
});

it("stops a working turn once and keeps it cancelled when the worker exits", async () => {
  let finish!: () => void;
  let started!: () => void;
  const running = new Promise<void>((resolve) => (started = resolve));
  const stopped: string[] = [];
  device = new Note4Device(
    store,
    {
      transcribe: async () => "Consulta",
      agent: async () => {
        started();
        await new Promise<void>((resolve) => (finish = resolve));
        throw Error("aborted");
      },
      cancel: async (session) => {
        stopped.push(session);
        finish();
      },
    },
    () => now,
  );
  const id = randomUUID();
  device.submit(id, wav());
  await running;
  expect((await device.cancel(id)).phase).toBe("cancelled");
  await device.idle();
  expect(device.status(id).phase).toBe("cancelled");
  expect(device.status(id).active).toBe(false);
  await device.cancel(id);
  expect(stopped).toHaveLength(1);
});

it("interrupts for clarification in the same conversation without replaying the old turn", async () => {
  let started!: () => void, finish!: () => void;
  const running = new Promise<void>((resolve) => (started = resolve));
  device = new Note4Device(
    store,
    {
      transcribe: async () => "Mejor a las ocho",
      agent: async (session, message) => {
        calls.push({ session, message });
        if (calls.length === 1) {
          started();
          await new Promise<void>((resolve) => (finish = resolve));
          return;
        }
        const id = randomUUID();
        showNote4(
          store,
          { agentId: "nido-note4", sessionId: session, toolCallId: id },
          {
            operation: "append",
            cardId: id,
            status: "done",
            title: "Hecho",
            view: { type: "text", body: "Aclaración aplicada" },
          },
        );
      },
      cancel: async () => finish(),
    },
    () => now,
  );
  const first = randomUUID();
  device.submit(first, wav());
  await running;
  await device.cancel(first, true);
  device.submit(randomUUID(), wav());
  await device.idle();
  expect(calls).toHaveLength(2);
  expect(calls[1].session).toBe(calls[0].session);
  expect(calls[1].message).toContain("[Aclaración NOTE4 tras interrumpir el turno]");
  device.submit(randomUUID(), wav());
  await device.idle();
  expect(calls[2].message).toBe("[Audio NOTE4]\nMejor a las ocho");
  expect(device.status(first).phase).toBe("cancelled");
});

it("records phase durations even on failure without allowing diagnostics to alter the outcome", async () => {
  const timings: { turnId: string; phase: string; milliseconds: number }[] = [];
  device = new Note4Device(store, {
    transcribe: async () => {
      throw new Error("synthetic transcription failure");
    },
    agent: async () => {
      throw new Error("agent must not start");
    },
    onTiming: (value) => {
      timings.push(value);
      throw new Error("diagnostics unavailable");
    },
  });
  const id = randomUUID();
  device.submit(id, wav());
  await device.idle();
  expect(device.status(id).phase).toBe("error");
  expect(timings.map((value) => value.phase)).toEqual(["transcription", "total"]);
  expect(timings.every((value) => value.turnId === id && value.milliseconds >= 0)).toBe(true);
});
