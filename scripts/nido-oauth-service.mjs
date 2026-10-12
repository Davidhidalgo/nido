import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { chmodSync, lstatSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const scopes = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];
const hash = (value) => createHash("sha256").update(value).digest("base64url");
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const idPattern = /^[a-f0-9]{64}$/;
const proofPattern = /^[A-Za-z0-9_-]{43}$/;
const lifetime = 10 * 60 * 1000;

export function createOAuthService({
  publicUrl,
  clientId,
  clientSecret,
  encryptionKey,
  dataDir,
  fetcher = fetch,
  now = () => Date.now(),
}) {
  const origin = new URL(publicUrl);
  if (
    origin.protocol !== "https:" ||
    origin.pathname !== "/" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  )
    throw new Error("NIDO_AUTH_PUBLIC_URL must be an HTTPS origin.");
  if (
    !/^[a-zA-Z0-9._-]{10,300}\.apps\.googleusercontent\.com$/.test(clientId) ||
    typeof clientSecret !== "string" ||
    !clientSecret ||
    clientSecret.length > 500
  )
    throw new Error("Configure the Google Web OAuth client on the service.");
  if (typeof encryptionKey !== "string" || !proofPattern.test(encryptionKey))
    throw new Error("NIDO_AUTH_ENCRYPTION_KEY must contain 32 random bytes in base64url.");
  const key = Buffer.from(encryptionKey, "base64url");
  if (key.length !== 32) throw new Error("Invalid encryption key.");
  if (!dataDir || resolve(dataDir) !== dataDir)
    throw new Error("Use an absolute private data directory.");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  for (let path = dataDir; ; path = resolve(path, "..")) {
    if (lstatSync(path).isSymbolicLink()) throw new Error("Private data must not use symlinks.");
    if (path === resolve(path, "..")) break;
  }
  chmodSync(dataDir, 0o700);
  const databasePath = join(dataDir, "oauth.sqlite");
  try {
    if (lstatSync(databasePath).isSymbolicLink()) throw new Error("Unsafe database path.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const db = new DatabaseSync(databasePath);
  chmodSync(databasePath, 0o600);
  db.exec(`CREATE TABLE IF NOT EXISTS flows (
    id TEXT PRIMARY KEY, challenge TEXT NOT NULL, origin TEXT NOT NULL, state TEXT UNIQUE NOT NULL,
    expires INTEGER NOT NULL, phase TEXT NOT NULL, verifier TEXT NOT NULL,
    browser TEXT, grant TEXT
  );`);
  // A process restart must not retry an authorization code whose exchange was uncertain.
  db.exec("UPDATE flows SET phase='failed', verifier='' WHERE phase='exchanging'");
  const redirectUri = `${origin.origin}/oauth/google/callback`;
  function seal(value) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(`nido-oauth-v1:${clientId}`));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return [
      "v1",
      iv.toString("base64url"),
      ciphertext.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
    ].join(".");
  }
  function unseal(value) {
    if (typeof value !== "string" || value.length > 16000) throw new Error("Invalid grant.");
    const [version, iv, ciphertext, tag, extra] = value.split(".");
    if (version !== "v1" || !iv || !ciphertext || !tag || extra) throw new Error("Invalid grant.");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(`nido-oauth-v1:${clientId}`));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8"),
    );
  }
  const prune = () => db.prepare("DELETE FROM flows WHERE expires < ?").run(now());
  prune();
  const cleanup = setInterval(prune, 60000);
  cleanup.unref();
  function json(res, status, value) {
    res
      .writeHead(status, { "Content-Type": "application/json; charset=utf-8" })
      .end(JSON.stringify(value));
  }
  async function body(req) {
    if (
      req.headers.origin ||
      req.headers["sec-fetch-site"] ||
      req.headers["content-type"]?.split(";")[0] !== "application/json"
    )
      throw new Error("Server API only.");
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += Buffer.byteLength(chunk);
      if (size > 8192) throw new Error("Request too large.");
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  async function googleToken(values) {
    const response = await fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...values }),
    });
    if (!response.ok) throw new Error("Google authorization failed.");
    return response.json();
  }
  const cookieName = (flow) => `__Host-nido-${flow.id.slice(0, 16)}`;
  // Bounded global limits supplement the reverse proxy's per-IP limits. No forwarded IP is trusted.
  let windowStart = now(),
    calls = 0,
    connections = 0;
  async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    if (now() - windowStart >= 60000) {
      windowStart = now();
      calls = 0;
      connections = 0;
    }
    if (++calls > 3000) return json(res, 429, { error: "rate_limited" });
    try {
      const url = new URL(req.url, origin);
      if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });
      if (req.method === "POST" && url.pathname === "/v1/connect") {
        const input = await body(req);
        if (!idPattern.test(input.requestId) || !proofPattern.test(input.challenge))
          throw new Error("Invalid request.");
        const ui = new URL(input.origin);
        if (
          (ui.protocol !== "https:" &&
            !(
              ui.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(ui.hostname)
            )) ||
          ui.origin !== input.origin ||
          ui.username ||
          ui.password ||
          ui.pathname !== "/" ||
          ui.search ||
          ui.hash
        )
          throw new Error("Invalid installation origin.");
        prune();
        let flow = db.prepare("SELECT * FROM flows WHERE id=?").get(input.requestId);
        if (flow && (!equal(flow.challenge, input.challenge) || flow.origin !== input.origin))
          return json(res, 409, { error: "conflict" });
        if (!flow) {
          if (
            ++connections > 60 ||
            db.prepare("SELECT count(*) AS count FROM flows").get().count >= 1000
          )
            return json(res, 429, { error: "rate_limited" });
          const verifier = randomBytes(32).toString("base64url");
          db.prepare(
            "INSERT INTO flows(id,challenge,origin,state,expires,phase,verifier) VALUES(?,?,?,?,?,?,?)",
          ).run(
            input.requestId,
            input.challenge,
            input.origin,
            randomBytes(32).toString("hex"),
            now() + lifetime,
            "pending",
            seal({ verifier }),
          );
          flow = db.prepare("SELECT * FROM flows WHERE id=?").get(input.requestId);
        }
        return json(res, 200, {
          url: `${origin.origin}/oauth/google/start/${flow.id}`,
          expiresAt: flow.expires,
        });
      }
      if (req.method === "POST" && url.pathname === "/v1/status") {
        const input = await body(req);
        if (!idPattern.test(input.requestId) || !proofPattern.test(input.verifier))
          throw new Error("Invalid request.");
        const flow = db.prepare("SELECT * FROM flows WHERE id=?").get(input.requestId);
        if (!flow || !equal(flow.challenge, hash(input.verifier)))
          return json(res, 404, { error: "not_found" });
        if (flow.expires < now()) return json(res, 410, { error: "expired" });
        return json(res, 200, {
          status: flow.phase === "exchanging" ? "pending" : flow.phase,
          ...(flow.phase === "ready" ? { grant: flow.grant } : {}),
        });
      }
      if (req.method === "POST" && url.pathname.startsWith("/oauth/google/start/")) {
        const id = url.pathname.slice("/oauth/google/start/".length);
        const flow = idPattern.test(id) && db.prepare("SELECT * FROM flows WHERE id=?").get(id);
        if (!flow || flow.expires < now() || flow.phase !== "pending")
          throw new Error("Expired connection.");
        // A forwarded link must never authorize the sender's installation. Only a browser
        // POST from the initiating OpenClaw origin can begin this flow; GET is not supported.
        if (
          req.headers.origin !== flow.origin ||
          req.headers["content-type"]?.split(";")[0] !== "application/x-www-form-urlencoded"
        )
          throw new Error("Start authorization from Nido.");
        let formSize = 0;
        for await (const chunk of req) {
          formSize += Buffer.byteLength(chunk);
          if (formSize > 128) throw new Error("Invalid form.");
        }
        const cookies = Object.fromEntries(
          (req.headers.cookie ?? "").split(";").map((c) => c.trim().split("=")),
        );
        let browser = cookies[cookieName(flow)];
        if (flow.browser) {
          if (!browser || !equal(flow.browser, hash(browser)))
            throw new Error("Connection belongs to another browser.");
        } else {
          browser = randomBytes(32).toString("hex");
          const claimed = db
            .prepare("UPDATE flows SET browser=? WHERE id=? AND browser IS NULL")
            .run(hash(browser), id);
          if (claimed.changes !== 1) throw new Error("Connection already opened.");
        }
        const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        auth.search = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: scopes.join(" "),
          access_type: "offline",
          prompt: "consent",
          state: flow.state,
          code_challenge: hash(unseal(flow.verifier).verifier),
          code_challenge_method: "S256",
        }).toString();
        res.setHeader(
          "Set-Cookie",
          `${cookieName(flow)}=${browser}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
        );
        return res.writeHead(303, { Location: auth.toString() }).end();
      }
      if (req.method === "GET" && url.pathname === "/oauth/google/callback") {
        const state = url.searchParams.get("state");
        const flow =
          state &&
          idPattern.test(state) &&
          db.prepare("SELECT * FROM flows WHERE state=?").get(state);
        const cookies = Object.fromEntries(
          (req.headers.cookie ?? "").split(";").map((c) => c.trim().split("=")),
        );
        const browser = flow && cookies[cookieName(flow)];
        if (!flow || flow.expires < now() || !browser || !equal(flow.browser, hash(browser)))
          throw new Error("Invalid state.");
        if (flow.phase === "ready") {
          res
            .writeHead(200, { "Content-Type": "text/plain; charset=utf-8" })
            .end("Google conectado. Puedes cerrar esta pestaña y volver a Nido.");
          return;
        }
        if (flow.phase !== "pending") throw new Error("Connection already consumed.");
        // Claim before external I/O. An uncertain exchange may never be sent again.
        db.prepare("UPDATE flows SET phase='exchanging', verifier='' WHERE id=?").run(flow.id);
        try {
          const code = url.searchParams.get("code");
          if (url.searchParams.has("error") || !code || code.length > 4096)
            throw new Error("Authorization denied.");
          const token = await googleToken({
            code,
            code_verifier: unseal(flow.verifier).verifier,
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
          });
          const granted = typeof token.scope === "string" ? token.scope.split(" ") : [];
          if (
            typeof token.refresh_token !== "string" ||
            !token.refresh_token ||
            token.refresh_token.length > 8192 ||
            !scopes.every((scope) => granted.includes(scope))
          )
            throw new Error("Missing permission.");
          const grant = seal({ kind: "google-refresh", refreshToken: token.refresh_token });
          db.prepare("UPDATE flows SET phase='ready', grant=? WHERE id=?").run(grant, flow.id);
        } catch {
          db.prepare("UPDATE flows SET phase='failed' WHERE id=?").run(flow.id);
          throw new Error("Authorization could not be confirmed.");
        }
        return res
          .writeHead(200, { "Content-Type": "text/plain; charset=utf-8" })
          .end("Google conectado. Puedes cerrar esta pestaña y volver a Nido.");
      }
      if (req.method === "POST" && url.pathname === "/v1/token") {
        await body(req);
        const authorization = req.headers.authorization ?? "";
        if (!authorization.startsWith("Bearer ")) return json(res, 401, { error: "unauthorized" });
        let grant;
        try {
          grant = unseal(authorization.slice(7));
        } catch {
          return json(res, 401, { error: "unauthorized" });
        }
        if (grant.kind !== "google-refresh" || typeof grant.refreshToken !== "string")
          return json(res, 401, { error: "unauthorized" });
        try {
          const token = await googleToken({
            grant_type: "refresh_token",
            refresh_token: grant.refreshToken,
          });
          if (
            typeof token.access_token !== "string" ||
            !token.access_token ||
            !Number.isFinite(token.expires_in)
          )
            throw new Error("Invalid token.");
          return json(res, 200, {
            access_token: token.access_token,
            expires_in: Math.min(3600, Math.max(0, token.expires_in)),
          });
        } catch {
          return json(res, 401, { error: "reconnect_required" });
        }
      }
      return json(res, 404, { error: "not_found" });
    } catch {
      // Never return Google responses, authorization codes, tokens, or environment values.
      return json(res, 400, {
        error: "connection_failed",
        message: "No se pudo completar la conexión. Vuelve a Nido para consultar su estado.",
      });
    }
  }
  return {
    handler,
    close() {
      clearInterval(cleanup);
      db.close();
    },
  };
}
