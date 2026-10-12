import { createServer } from "node:http";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Interactive operator setup only. This script is never exposed as an agent tool.
const root = fileURLToPath(new URL("../", import.meta.url));
const clientPath = process.argv[2] ?? join(root, ".local/google-client.json");
let client;
try {
  client = JSON.parse(await readFile(clientPath, "utf8")).installed;
} catch {
  throw new Error(
    "Guarda las credenciales OAuth Desktop de Google en .local/google-client.json o pasa su ruta como argumento.",
  );
}
if (!client?.client_id)
  throw new Error("Se necesita un cliente OAuth de tipo Desktop (campo installed).");
const state = randomBytes(32).toString("hex");
const verifier = randomBytes(48).toString("base64url");
let finish;
const callback = new Promise((resolve, reject) => {
  finish = { resolve, reject };
});
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/callback") {
    response.writeHead(404).end();
    return;
  }
  const supplied = Buffer.from(url.searchParams.get("state") ?? "");
  if (supplied.length !== state.length || !timingSafeEqual(supplied, Buffer.from(state))) {
    response.writeHead(400).end("Estado OAuth invalido.");
    return;
  }
  if (url.searchParams.has("error")) {
    response.writeHead(400).end("Autorizacion cancelada.");
    finish.reject(new Error("Google no autorizó la conexión."));
    return;
  }
  const code = url.searchParams.get("code");
  if (!code) {
    response.writeHead(400).end("Falta el codigo.");
    return;
  }
  response
    .writeHead(200, { "Content-Type": "text/plain; charset=utf-8" })
    .end("Consentimiento recibido. Puedes cerrar esta pestaña y volver al terminal.");
  finish.resolve(code);
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
url.search = new URLSearchParams({
  client_id: client.client_id,
  redirect_uri: redirectUri,
  response_type: "code",
  scope:
    "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  access_type: "offline",
  prompt: "consent",
  state,
  code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  code_challenge_method: "S256",
});
console.log("Abre este enlace en el navegador de ESTE equipo y autoriza la cuenta familiar:");
console.log(url.toString());
const timeout = setTimeout(
  () => finish.reject(new Error("La autorización ha caducado; vuelve a ejecutar el comando.")),
  5 * 60 * 1000,
);
try {
  const code = await callback;
  const body = new URLSearchParams({
    client_id: client.client_id,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  if (client.client_secret) body.set("client_secret", client.client_secret);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body,
    signal: AbortSignal.timeout(20000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`El intercambio OAuth falló (HTTP ${response.status}).`);
  const tokens = await response.json();
  if (!tokens.refresh_token)
    throw new Error(
      "Google no devolvió refresh_token. Revisa el consentimiento y vuelve a conectar.",
    );
  const dir = join(root, ".local/family-data/google");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "google-credentials.json");
  await writeFile(
    path,
    JSON.stringify({
      client_id: client.client_id,
      client_secret: client.client_secret,
      refresh_token: tokens.refresh_token,
    }),
    { mode: 0o600 },
  );
  await chmod(path, 0o600);
  console.log("Conexión guardada localmente. No se ha leído ni modificado ningún evento.");
} finally {
  clearTimeout(timeout);
  server.close();
}
