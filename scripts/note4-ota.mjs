import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseFirmware,
  NOTE4_BOARD,
  firmwareDescriptor,
} from "../integrations/nido-family/dist/note4-maintenance.js";
export function firmwareBundle(binary, version, privateKey) {
  firmwareDescriptor(binary, version);
  const manifest = JSON.stringify({
    board: NOTE4_BOARD,
    version,
    configVersion: 1,
    size: binary.length,
    sha256: createHash("sha256").update(binary).digest("hex"),
  });
  const signature = sign("sha256", Buffer.from(manifest), privateKey).toString("hex");
  const envelope = { manifest, signature };
  parseFirmware(
    envelope,
    createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString(),
  );
  const header = Buffer.alloc(16);
  header.write("NIDOOTA1");
  header.writeUInt32LE(Buffer.byteLength(manifest), 8);
  header.writeUInt32LE(signature.length, 12);
  return {
    envelope,
    bundle: Buffer.concat([header, Buffer.from(manifest), Buffer.from(signature), binary]),
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [action, ...args] = process.argv.slice(2).filter((a) => a !== "--");
  if (action === "keygen" && args.length === 2) {
    const pair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    writeFileSync(args[0], pair.privateKey, { mode: 0o600, flag: "wx" });
    writeFileSync(args[1], pair.publicKey, { mode: 0o600, flag: "wx" });
    console.log("Claves creadas. Conserva la clave privada fuera del repositorio.");
  } else if (action === "pack" && args.length === 4) {
    const [binaryPath, version, keyPath, output] = args;
    const { envelope, bundle } = firmwareBundle(
      readFileSync(binaryPath),
      version,
      readFileSync(keyPath),
    );
    writeFileSync(output, bundle, { mode: 0o600, flag: "wx" });
    writeFileSync(output + ".json", JSON.stringify(envelope) + "\n", { mode: 0o600, flag: "wx" });
    console.log("Paquete OTA y manifiesto creados; no se ha publicado ni instalado.");
  } else
    throw new Error(
      "Uso: note4:ota keygen PRIVADA.pem PUBLICA.pem | pack APP.bin VERSION PRIVADA.pem SALIDA.nidoota",
    );
}
