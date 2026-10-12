import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const local = join(root, ".local/note4");
await mkdir(join(local, "generated"), { recursive: true, mode: 0o700 });
let config;
try {
  config = JSON.parse(await readFile(join(local, "device.json"), "utf8"));
} catch {
  config = {};
}
const host = Object.values(networkInterfaces())
  .flat()
  .find(
    (a) =>
      a?.family === "IPv4" &&
      !a.internal &&
      /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address),
  )?.address;
if (!host && !config.endpoint) throw new Error("No hay una dirección IPv4 de red local.");
config.endpoint ??= `https://${host}:18791`;
const url = new URL(config.endpoint);
if (url.protocol !== "https:" || url.pathname !== "/" || !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname))
  throw new Error("Configura un endpoint HTTPS con la IPv4 privada del Mac.");
config.token ??= randomBytes(32).toString("hex");
const cert = join(local, "server-cert.pem");
const key = join(local, "server-key.pem");
try {
  await readFile(cert, "utf8");
} catch {
  const openssl = join(local, "openssl.cnf");
  await writeFile(
    openssl,
    `[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=${url.hostname}\n[ext]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nsubjectAltName=IP:${url.hostname},DNS:${url.hostname}\n`,
    { mode: 0o600 },
  );
  const result = spawnSync(
    "/usr/bin/openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-sha256",
      "-days",
      "365",
      "-config",
      openssl,
      "-keyout",
      key,
      "-out",
      cert,
    ],
    { stdio: "pipe" },
  );
  if (result.status !== 0) throw new Error("No se pudo crear el certificado local.");
  await chmod(key, 0o600);
  await readFile(cert, "utf8");
}
await writeFile(join(local, "device.json"), JSON.stringify(config, null, 2) + "\n", {
  mode: 0o600,
});
await chmod(join(local, "device.json"), 0o600);
// Wi-Fi and device credentials are provisioned in the NOTE4 maintenance web UI.
// Keep an existing legacy token until pairing replaces it, without exporting it into firmware.
console.log(
  `Puente NOTE4 preparado para ${config.endpoint}. Configura note4Maintenance.bridgeConfigFile con la ruta de device.json y vincula desde los ajustes del plugin usando el código de la pantalla.`,
);
