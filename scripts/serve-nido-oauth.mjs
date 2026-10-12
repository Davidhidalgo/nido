import { createServer } from "node:http";
import { createOAuthService } from "./nido-oauth-service.mjs";

process.umask(0o077);
const service = createOAuthService({
  publicUrl: process.env.NIDO_AUTH_PUBLIC_URL,
  clientId: process.env.NIDO_AUTH_CLIENT_ID,
  clientSecret: process.env.NIDO_AUTH_CLIENT_SECRET,
  encryptionKey: process.env.NIDO_AUTH_ENCRYPTION_KEY,
  dataDir: process.env.NIDO_AUTH_DATA_DIR,
});
const server = createServer(
  { requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 8192 },
  service.handler,
);
const port = Number(process.env.NIDO_AUTH_PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid service port.");
server.listen(port, "127.0.0.1", () =>
  console.log("Nido OAuth listening on loopback; expose it through the HTTPS reverse proxy."),
);
function stop() {
  server.close(() => {
    service.close();
  });
  server.closeIdleConnections();
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
