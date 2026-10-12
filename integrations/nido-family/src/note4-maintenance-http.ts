import type { IncomingMessage, ServerResponse } from "node:http";
import { NidoError } from "./core.js";
import { Note4Maintenance } from "./note4-maintenance.js";
export async function maintenanceBody(req: IncomingMessage, limit = 8192): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new NidoError("INVALID_INPUT", "Petición demasiado grande.");
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new NidoError("INVALID_INPUT", "JSON inválido.");
  }
}
export function maintenanceHandler(manager: Note4Maintenance) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "https://note4.local");
    if (!url.pathname.startsWith("/v1/maintenance/") && url.pathname !== "/v1/pair") return false;
    res.setHeader("Cache-Control", "no-store");
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    try {
      if (url.pathname === "/v1/pair" && req.method === "POST") {
        send(200, manager.redeem(await maintenanceBody(req)));
        return true;
      }
      const device = manager.authenticate(req.headers.authorization);
      if (!device) {
        send(401, { error: "UNAUTHORIZED" });
        return true;
      }
      if (req.method === "GET" && url.pathname === "/v1/maintenance/check") {
        send(
          200,
          manager.check(
            device,
            url.searchParams.get("version"),
            url.searchParams.get("boot"),
            url.searchParams.get("job"),
          ),
        );
      } else if (req.method === "POST" && url.pathname === "/v1/maintenance/report") {
        send(200, manager.report(device, await maintenanceBody(req)));
      } else if (req.method === "GET" && url.pathname === "/v1/maintenance/binary") {
        const binary = manager.binary(device, url.searchParams.get("id"));
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": binary.length,
        });
        res.end(binary);
      } else send(404, { error: "NOT_FOUND" });
    } catch (error) {
      const code = error instanceof NidoError ? error.code : "INTERNAL_ERROR";
      send(
        code === "INVALID_INPUT"
          ? 400
          : code === "EXPIRED" || code === "CONFLICT"
            ? 409
            : code === "NOT_FOUND"
              ? 404
              : 500,
        { error: code },
      );
    }
    return true;
  };
}
