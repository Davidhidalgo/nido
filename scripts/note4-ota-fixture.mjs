// Regenerable synthetic inputs for the production C++ OTA writer. Never an installation key.
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const directory = process.argv[2];
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = publicKey.export({ format: "pem", type: "spki" });
writeFileSync(
  join(directory, "nido_ota_key.h"),
  `#pragma once\nnamespace nido { constexpr char kOtaPublicKey[]=R"NIDOKEY(${pem})NIDOKEY"; }\n`,
);
const binary = Buffer.alloc(1024);
binary[0] = 0xe9;
binary.writeUInt16LE(9, 12);
binary.writeUInt32LE(0xabcd5432, 32);
binary.write("native-test", 48);
binary.write("nido_note4", 80);
writeFileSync(join(directory, "ota-fixture.bin"), binary);
const manifest = JSON.stringify({
  board: "note4-mono-v1",
  version: "native-test",
  configVersion: 1,
  size: binary.length,
  sha256: createHash("sha256").update(binary).digest("hex"),
});
writeFileSync(join(directory, "ota-manifest.json"), manifest);
writeFileSync(
  join(directory, "ota-signature.txt"),
  sign("sha256", Buffer.from(manifest), privateKey).toString("hex"),
);
const bad = manifest.replace('"configVersion":1', '"configVersion":2');
writeFileSync(join(directory, "ota-incompatible.json"), bad);
writeFileSync(
  join(directory, "ota-incompatible-signature.txt"),
  sign("sha256", Buffer.from(bad), privateKey).toString("hex"),
);
