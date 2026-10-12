import { request } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { Note4Srp } from "./note4-srp.js";
import { privateIpv4 } from "./note4-discovery.js";
import { Note4Maintenance } from "./note4-maintenance.js";
import { NidoError } from "./core.js";
export function pairingRequest(
  address: string,
  path: string,
  body?: Buffer,
  window?: string,
): Promise<Buffer> {
  if (!privateIpv4(address) || !["/pair/info", "/pair/session", "/pair/config"].includes(path))
    throw Error("Dirección de Note4 inválida");
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: address,
        port: 80,
        path,
        method: body ? "POST" : "GET",
        headers: {
          ...(body
            ? { "Content-Type": "application/octet-stream", "Content-Length": body.length }
            : {}),
          ...(window ? { "X-Nido-Pairing": window } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 8192) req.destroy(Error("Respuesta demasiado grande"));
          else chunks.push(chunk);
        });
        res.on("end", () =>
          res.statusCode === 200
            ? resolve(Buffer.concat(chunks))
            : reject(Error("Vinculación rechazada. Comprueba el código y su caducidad.")),
        );
        res.on("error", reject);
      },
    );
    const timer = setTimeout(() => req.destroy(Error("Note4 no responde")), 15000);
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    req.end(body);
  });
}
/** One operation per installation; retain the same grant after an uncertain response. */
export function codePairer() {
  let busy = false;
  let pending:
    | { key: string; expires: number; packet: ReturnType<Note4Maintenance["pair"]> }
    | undefined;
  return async (manager: Note4Maintenance, params: any, bridgeConfigFile: unknown) => {
    if (busy) throw new NidoError("CONFLICT", "Ya hay una vinculación en curso.");
    if (
      !params ||
      typeof params.address !== "string" ||
      !privateIpv4(params.address) ||
      typeof params.code !== "string" ||
      !/^\d{6}$/.test(params.code)
    )
      throw new NidoError("INVALID_INPUT", "Selecciona el Note4 e introduce los seis dígitos.");
    if (typeof bridgeConfigFile !== "string")
      throw new NidoError(
        "CONFIG",
        "Configura note4Maintenance.bridgeConfigFile para usar la vinculación por código.",
      );
    busy = true;
    try {
      const info = JSON.parse((await pairingRequest(params.address, "/pair/info")).toString());
      if (
        info.protocol !== "nido-srp2-1" ||
        !/^nido-[0-9a-f]{6}$/i.test(info.name) ||
        !/^[0-9a-f]{32}$/.test(info.window)
      )
        throw Error("Dispositivo incompatible");
      const session = new Note4Srp(params.code);
      const first = await pairingRequest(
        params.address,
        "/pair/session",
        session.hello(),
        info.window,
      );
      const second = await pairingRequest(
        params.address,
        "/pair/session",
        session.challenge(first),
        info.window,
      );
      session.verify(second);
      const key = createHash("sha256")
        .update(params.address + "\0" + info.window + "\0" + params.code)
        .digest("hex");
      if (!pending || pending.key !== key || pending.expires < Date.now()) {
        const bridge = JSON.parse(readFileSync(bridgeConfigFile, "utf8"));
        const packet = manager.pair(
          bridge.endpoint,
          readFileSync(join(dirname(bridgeConfigFile), "server-cert.pem"), "utf8"),
        );
        pending = { key, packet, expires: Date.now() + 600000 };
      }
      const encrypted = session.encrypt(Buffer.from(JSON.stringify(pending.packet)));
      const reply = await pairingRequest(params.address, "/pair/config", encrypted, info.window);
      const result = JSON.parse(session.decrypt(reply).toString());
      if (result.ok !== true) throw Error("El Note4 no pudo confirmar la conexión con Nido.");
      pending = undefined;
      return { ok: true, name: info.name };
    } catch (error) {
      if (error instanceof NidoError) throw error;
      throw new NidoError(
        "PAIRING",
        "No se pudo confirmar la vinculación. Comprueba la pantalla y el estado antes de repetir. " +
          (error instanceof Error ? error.message : ""),
      );
    } finally {
      busy = false;
    }
  };
}
