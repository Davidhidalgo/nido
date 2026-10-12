import { note4DemoFamily } from "./note4-runtime.mjs";
import { disableDemoHoncho } from "./honcho-runtime.mjs";
import { readFile, writeFile, mkdir, open, unlink } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const local = join(root, ".local", "note4");
const args = process.argv.slice(2);
const option = (key) => args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
if (args.includes("--help") || !args.length) {
  console.log(
    'NOTE4 demo: --message="Cambia la cena de mañana por tortilla" | --cards | --answer=upper --card=ID | --new | --retry',
  );
  process.exit(0);
}
await mkdir(local, { recursive: true, mode: 0o700 });
const lockPath = join(local, "conversation.lock");
let lock;
try {
  lock = await open(lockPath, "wx", 0o600);
} catch (error) {
  if (error.code === "EEXIST")
    throw new Error("Hay un turno NOTE4 en curso. Espera a que termine.");
  throw error;
}
try {
  const config = JSON.parse(await readFile(join(root, ".local/openclaw/openclaw.json"), "utf8"));
  // Separate config, state, gateway and Calendar demo: never delegate into the real gateway.
  const runtimeState = join(local, "openclaw");
  await mkdir(runtimeState, { recursive: true, mode: 0o700 });
  const family = note4DemoFamily(
    config.plugins.entries["nido-family"].config,
    join(local, "family-data"),
  );
  const coordinator = config.agents.entries.nido;
  for (const id of ["nido-note4", "menu", "agenda"]) {
    if (!config.agents.entries[id].model && coordinator.model) {
      config.agents.entries[id].model = coordinator.model;
      config.agents.entries[id].models = coordinator.models;
      config.agents.entries[id].modelPolicy = coordinator.modelPolicy;
    }
  }
  config.plugins.entries["nido-family"].config = family;
  disableDemoHoncho(config);
  config.plugins.allow = config.plugins.allow.filter((id) => id !== "telegram");
  delete config.plugins.entries.telegram;
  config.channels = {};
  config.bindings = [];
  config.gateway = {
    mode: "local",
    bind: "loopback",
    port: 18790,
    auth: { mode: "token", token: randomBytes(32).toString("hex") },
  };
  const configPath = join(runtimeState, "openclaw.json");
  await writeFile(configPath, JSON.stringify(config) + "\n", { mode: 0o600 });
  const nodePath = process.execPath;
  const cliPath = join(root, ".runtime/openclaw/node_modules/openclaw/openclaw.mjs");
  const runtimeEnv = {
    ...process.env,
    OPENCLAW_STATE_DIR: runtimeState,
    OPENCLAW_CONFIG_PATH: configPath,
    OPENCLAW_GATEWAY_TOKEN: config.gateway.auth.token,
    PATH: process.env.PATH,
  };
  const { Store } = await import("../integrations/nido-family/dist/core.js");
  const { note4Events, answerNote4 } = await import("../integrations/nido-family/dist/note4.js");
  const store = new Store(join(family.dataDir, "nido.sqlite"));
  try {
    const statePath = join(local, "conversation.json");
    let state;
    try {
      state = JSON.parse(await readFile(statePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const expired = !state || Date.now() - state.lastActivity >= 5 * 60_000;
    if (args.includes("--cards")) {
      console.log(JSON.stringify(state ? note4Events(store, state.sessionId) : [], null, 2));
    } else {
      if (option("answer") && (expired || args.includes("--new")))
        throw new Error("La conversación caducó. Envía una nueva petición por voz/texto.");
      if (expired || args.includes("--new")) {
        state = { sessionId: randomUUID(), lastActivity: Date.now() };
        console.log("Nueva conversación NOTE4 (DEMO).");
      }
      let message = option("message");
      if (option("answer")) {
        const button = option("answer");
        const cardId = option("card");
        if (!cardId || !["upper", "lower"].includes(button))
          throw new Error("Usa --answer=upper|lower y --card=ID.");
        const answer = answerNote4(store, state.sessionId, cardId, button);
        message = `[Respuesta NOTE4 a tarjeta ${cardId}] ${answer.answer}`;
        state.pendingMessage = message;
      }
      message ??= state.pendingMessage;
      if (!message && !args.includes("--new")) throw new Error("Falta --message o --answer.");
      state.lastActivity = Date.now();
      await writeFile(statePath, JSON.stringify(state) + "\n", { mode: 0o600 });
      if (message) {
        const before = note4Events(store, state.sessionId).at(-1)?.sequence ?? 0;
        let seen = before;
        const printCards = () => {
          for (const event of note4Events(store, state.sessionId).filter(
            (item) => item.sequence > seen,
          )) {
            console.log(JSON.stringify(event, null, 2));
            seen = event.sequence;
          }
        };
        const timer = setInterval(printCards, 250);
        let exitCode;
        let gateway;
        let transcriptDb;
        let turnOutput = "";
        const log = await open(join(local, "gateway.log"), "w", 0o600);
        try {
          gateway = spawn(nodePath, [cliPath, "gateway", "run"], {
            cwd: root,
            env: runtimeEnv,
            stdio: ["ignore", log.fd, log.fd],
          });
          let startError;
          gateway.on("error", (error) => {
            startError = error;
          });
          let ready = false;
          for (let attempt = 0; attempt < 100; attempt++) {
            if (startError) throw startError;
            if (gateway.exitCode !== null) break;
            try {
              const response = await fetch("http://127.0.0.1:18790/health", {
                signal: AbortSignal.timeout(250),
              });
              if (response.ok) {
                ready = true;
                break;
              }
            } catch {
              /* wait for the isolated gateway */
            }
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
          if (!ready)
            throw new Error("No arranca el Gateway demo. Consulta .local/note4/gateway.log.");
          exitCode = await new Promise((resolve, reject) => {
            const child = spawn(
              nodePath,
              [
                cliPath,
                "agent",
                "--agent",
                "nido-note4",
                "--session-id",
                state.sessionId,
                "--session-key",
                `agent:nido-note4:note4-${state.sessionId}`,
                "--message",
                message,
                "--json",
                "--timeout",
                "180",
              ],
              { cwd: root, env: runtimeEnv, stdio: ["ignore", "pipe", "inherit"] },
            );
            child.stdout.on("data", (chunk) => {
              turnOutput += chunk.toString();
            });
            child.on("error", reject);
            child.on("close", (code) => resolve(code ?? 1));
          });
          await writeFile(join(local, "last-turn.json"), turnOutput, { mode: 0o600 });
          if (exitCode === 0) {
            try {
              const result = JSON.parse(turnOutput);
              for (const payload of result.result?.payloads ?? [])
                if (payload.text) console.log(payload.text);
              if (result.status !== "ok") exitCode = 1;
            } catch {
              console.error("Salida del runtime no válida. Consulta .local/note4/last-turn.json.");
              exitCode = 1;
            }
          }
          // Delegations may finish after the coordinator's initial turn.
          // Keep the demo gateway alive until its final card or question arrives.
          if (exitCode === 0) {
            const deadline = Date.now() + 180_000;
            while (Date.now() < deadline) {
              const events = note4Events(store, state.sessionId).filter(
                (event) => event.sequence > before && event.kind !== "answer",
              );
              const latest = events.at(-1)?.data;
              if (latest && "status" in latest && latest.status !== "progress") {
                transcriptDb ??= new DatabaseSync(
                  join(runtimeState, "agents/nido-note4/agent/openclaw-agent.sqlite"),
                  { readOnly: true },
                );
                const tail = transcriptDb
                  .prepare(
                    "SELECT json_extract(event_json,'$.message.role') role, json_extract(event_json,'$.message.stopReason') stop FROM transcript_events WHERE session_id=? AND json_extract(event_json,'$.type')='message' ORDER BY seq DESC LIMIT 1",
                  )
                  .get(state.sessionId);
                if (tail?.role === "assistant" && tail.stop === "stop") break;
              }
              if (gateway.exitCode !== null) {
                exitCode = 1;
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 250));
            }
            const latest = note4Events(store, state.sessionId)
              .filter((event) => event.sequence > before && event.kind !== "answer")
              .at(-1)?.data;
            if (!latest || !("status" in latest) || latest.status === "progress") {
              console.error(
                "No llegó una tarjeta final o pregunta. Consulta el registro del Gateway.",
              );
              exitCode = 1;
            }
          }
        } finally {
          clearInterval(timer);
          printCards();
          transcriptDb?.close();
          if (gateway && gateway.exitCode === null) {
            const stopped = new Promise((resolve) => gateway.once("exit", resolve));
            gateway.kill("SIGTERM");
            await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 3000))]);
            if (gateway.exitCode === null) gateway.kill("SIGKILL");
          }
          await log.close();
        }
        state.lastActivity = Date.now();
        if (exitCode === 0) delete state.pendingMessage;
        await writeFile(statePath, JSON.stringify(state) + "\n", { mode: 0o600 });
        if (exitCode !== 0) {
          console.error(
            "El turno falló. Las tarjetas y el contexto se conservan; no se afirma éxito.",
          );
          process.exitCode = exitCode;
        }
      }
    }
  } finally {
    store.close();
  }
} finally {
  await lock.close();
  await unlink(lockPath);
}
