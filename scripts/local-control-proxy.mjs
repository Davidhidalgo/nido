import { createServer, request } from "node:http";
import { pathToFileURL } from "node:url";

const loopback = (ip) => ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
const identityHeader = (key) =>
  key === "forwarded" ||
  key === "x-real-ip" ||
  key.startsWith("x-forwarded-") ||
  key.startsWith("tailscale-");

// Only for a loopback-only TLS frontend. Never use this adapter for LAN/public ingress.
export function createLocalControlProxy({ origin, upstreamPort }) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".localhost") || url.origin !== origin)
    throw new Error("An exact HTTPS .localhost origin is required");
  if (!Number.isInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535)
    throw new Error("Invalid upstream port");
  function allowed(req, upgrade = false) {
    const chain = req.headers["x-forwarded-for"];
    return (
      loopback(req.socket.remoteAddress) &&
      req.headers.host === url.host &&
      typeof chain === "string" &&
      chain.split(",").every((ip) => loopback(ip.trim())) &&
      req.headers["x-forwarded-proto"] === "https" &&
      req.headers["x-forwarded-host"] === url.host &&
      (!req.headers.origin ? !upgrade : req.headers.origin === origin) &&
      (!req.headers["sec-fetch-site"] ||
        ["same-origin", "none"].includes(req.headers["sec-fetch-site"])) &&
      req.url.startsWith("/") &&
      !req.url.startsWith("//")
    );
  }
  function upstream(req, upgrade = false) {
    const headers = { ...req.headers };
    const connectionHeaders = String(headers.connection ?? "")
      .toLowerCase()
      .split(",")
      .map((s) => s.trim());
    for (const key of Object.keys(headers)) {
      if (
        identityHeader(key) ||
        [
          "connection",
          "keep-alive",
          "proxy-authorization",
          "proxy-authenticate",
          "te",
          "trailer",
          "transfer-encoding",
          "upgrade",
        ].includes(key) ||
        connectionHeaders.includes(key)
      )
        delete headers[key];
    }
    // Keep Host and Origin: the Gateway still validates the browser origin and credentials.
    headers.host = url.host;
    if (upgrade) {
      headers.connection = "Upgrade";
      headers.upgrade = "websocket";
    }
    return request({
      hostname: "127.0.0.1",
      port: upstreamPort,
      path: req.url,
      method: req.method,
      headers,
    });
  }
  const server = createServer((req, res) => {
    if (!allowed(req)) {
      res.writeHead(403);
      res.end("Local origin required");
      return;
    }
    const remote = upstream(req);
    remote.on("response", (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    remote.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    remote.setTimeout(30_000, () => remote.destroy());
    req.on("aborted", () => remote.destroy());
    res.on("close", () => remote.destroy());
    req.pipe(remote);
  });
  server.on("upgrade", (req, socket, head) => {
    if (!allowed(req, true) || req.headers.upgrade?.toLowerCase() !== "websocket") {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const remote = upstream(req, true);
    remote.setTimeout(10_000, () => remote.destroy());
    remote.on("upgrade", (response, peer, peerHead) => {
      remote.setTimeout(0);
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers)
          .map(([k, v]) => `${k}: ${v}\r\n`)
          .join("")}\r\n`,
      );
      if (peerHead.length) socket.write(peerHead);
      if (head.length) peer.write(head);
      peer.on("error", () => socket.destroy());
      socket.on("error", () => peer.destroy());
      peer.on("close", () => socket.destroy());
      socket.on("close", () => peer.destroy());
      peer.pipe(socket);
      socket.pipe(peer);
    });
    remote.on("response", (response) => {
      socket.end(`HTTP/1.1 ${response.statusCode} Rejected\r\nConnection: close\r\n\r\n`);
      response.resume();
    });
    remote.on("error", () => socket.destroy());
    socket.on("error", () => remote.destroy());
    remote.end();
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [origin, port, upstreamPort] = process.argv.slice(2);
  const listenPort = Number(port);
  if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535)
    throw new Error("Invalid listen port");
  createLocalControlProxy({ origin, upstreamPort: Number(upstreamPort) }).listen(
    listenPort,
    "127.0.0.1",
  );
}
