import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { NidoError } from "./core.js";
import type { Note4Card } from "./note4.js";
import { Note4Device } from "./note4-device.js";

// An older device can keep working while its richer renderer is awaiting USB load.
function legacyCard(card: Note4Card): Note4Card {
  const view = card.view;
  let body: string;
  switch (view.type) {
    case "list":
      body = view.items
        .map((item) => `- ${item.label}${item.detail ? `: ${item.detail}` : ""}`)
        .join("\n");
      break;
    case "facts":
      body = view.items.map((item) => `${item.label}: ${item.value}`).join("\n");
      break;
    case "compare":
      body = `${view.beforeLabel}: ${view.before}\n${view.afterLabel}: ${view.after}`;
      break;
    case "highlight":
      body = `${view.value}\n${view.caption}${view.body ? `\n${view.body}` : ""}`;
      break;
    default:
      return card;
  }
  if (body.length > 240) {
    let shortened = "";
    for (const glyph of body) {
      if (shortened.length + glyph.length > 239) break;
      shortened += glyph;
    }
    body = shortened.trimEnd() + "…";
  }
  return { ...card, view: { type: "text", body } };
}

export function deviceHandler(
  device: Note4Device,
  token: string | ((authorization: unknown) => boolean),
  home?: (date?: string) => Promise<unknown>,
) {
  const expected = Buffer.from(typeof token === "string" ? `Bearer ${token}` : "");
  return async (request: IncomingMessage, response: ServerResponse) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    const send = (status: number, body: unknown) => {
      if (
        (status === 200 || status === 202) &&
        body &&
        typeof body === "object" &&
        "card" in body &&
        request.headers["x-nido-card-version"] !== "2"
      ) {
        body = { ...body, card: legacyCard(body.card as Note4Card) };
      }
      response.writeHead(status);
      response.end(JSON.stringify(body));
    };
    const supplied = Buffer.from(request.headers.authorization ?? "");
    if (
      typeof token === "function"
        ? !token(request.headers.authorization)
        : supplied.length !== expected.length || !timingSafeEqual(supplied, expected)
    ) {
      send(401, { error: "UNAUTHORIZED" });
      return;
    }
    try {
      const url = new URL(request.url ?? "/", "https://note4.local");
      if (request.method === "GET" && url.pathname === "/health") {
        send(200, { ready: true });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/home" && home) {
        if (
          [...url.searchParams.keys()].some((key) => key !== "date") ||
          url.searchParams.getAll("date").length > 1
        )
          throw new NidoError("INVALID_INPUT", "Consulta inválida.");
        send(200, await home(url.searchParams.get("date") ?? undefined));
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/session/dismiss") {
        device.dismiss();
        send(200, { dismissed: true });
        return;
      }
      const cancelMatch = /^\/v1\/turns\/([0-9a-f-]{36})\/cancel$/i.exec(url.pathname);
      if (request.method === "POST" && cancelMatch) {
        if (
          [...url.searchParams.keys()].some((key) => key !== "continue") ||
          url.searchParams.getAll("continue").length > 1 ||
          (url.searchParams.has("continue") && url.searchParams.get("continue") !== "1")
        )
          throw new NidoError("INVALID_INPUT", "Parada inválida.");
        send(200, await device.cancel(cancelMatch[1], url.searchParams.get("continue") === "1"));
        return;
      }
      const match =
        /^\/v1\/turns\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
          url.pathname,
        );
      if (!match) {
        send(404, { error: "NOT_FOUND" });
        return;
      }
      if (request.method === "GET") {
        send(200, device.status(match[1]));
        return;
      }
      if (request.method !== "POST") {
        send(405, { error: "METHOD" });
        return;
      }
      const kind = request.headers["content-type"]?.split(";")[0];
      if (!["audio/wav", "application/json"].includes(kind ?? ""))
        throw new NidoError("INVALID_INPUT", "Formato no admitido.");
      const limit = kind === "audio/wav" ? 960044 : 1024;
      if (Number(request.headers["content-length"] ?? 0) > limit) {
        send(413, { error: "TOO_LARGE" });
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > limit) {
          send(413, { error: "TOO_LARGE" });
          return;
        }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      let input;
      if (kind === "audio/wav") input = body;
      else {
        try {
          input = JSON.parse(body.toString("utf8"));
        } catch {
          throw new NidoError("INVALID_INPUT", "JSON inválido.");
        }
        if (
          !input ||
          Object.keys(input).sort().join(",") !== "button,cardId,turnId" ||
          typeof input.turnId !== "string" ||
          typeof input.cardId !== "string" ||
          !["upper", "lower"].includes(input.button)
        ) {
          throw new NidoError("INVALID_INPUT", "Respuesta inválida.");
        }
      }
      send(202, device.submit(match[1], input));
    } catch (error) {
      const code = error instanceof NidoError ? error.code : "INTERNAL_ERROR";
      send(
        code === "INVALID_INPUT"
          ? 400
          : code === "NOT_FOUND"
            ? 404
            : ["CONFLICT", "BUSY", "EXPIRED"].includes(code)
              ? 409
              : 500,
        { error: code },
      );
    }
  };
}
