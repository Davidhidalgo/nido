import { afterEach, expect, it } from "vitest";
import { createServer, request, type Server } from "node:http";
import { once } from "node:events";
import type { Socket } from "node:net";
import { createLocalControlProxy } from "../scripts/local-control-proxy.mjs";

const origin = "https://fixture.localhost";
const headers = {
  host: "fixture.localhost",
  "x-forwarded-for": "::1, 127.0.0.1",
  "x-forwarded-host": "fixture.localhost",
  "x-forwarded-proto": "https",
  origin,
};
const servers: Server[] = [];
const sockets = new Set<Socket>();
afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  for (const server of servers.splice(0).reverse()) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
async function listen(server: Server) {
  servers.push(server);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as { port: number }).port;
}
async function fixture() {
  const upstream = createServer((req, res) => {
    if (req.headers.authorization !== "Bearer fixture-secret") {
      res.writeHead(401);
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (data) => chunks.push(data));
    req.on("end", () =>
      res.end(
        JSON.stringify({
          path: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString(),
        }),
      ),
    );
  });
  const upstreamPort = await listen(upstream);
  const proxy = createLocalControlProxy({ origin, upstreamPort });
  return { upstream, port: await listen(proxy) };
}
function call(port: number, overrides = {}, body?: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/asset?q=1",
        method: body ? "POST" : "GET",
        headers: { ...headers, ...overrides },
      },
      (res) => {
        let text = "";
        res.on("data", (data) => (text += data));
        res.on("end", () => resolve({ status: res.statusCode!, body: text }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
it("preserves credentials, cookies, paths and bodies, but removes forwarded identity", async () => {
  const { port } = await fixture();
  expect((await call(port)).status).toBe(401);
  const res = await call(
    port,
    {
      authorization: "Bearer fixture-secret",
      cookie: "fixture=session",
      "tailscale-user-login": "spoof",
      "x-real-ip": "203.0.113.1",
    },
    "fixture body",
  );
  expect(res.status).toBe(200);
  const data = JSON.parse(res.body);
  expect(data.path).toBe("/asset?q=1");
  expect(data.body).toBe("fixture body");
  expect(data.headers.authorization).toBe("Bearer fixture-secret");
  expect(data.headers.cookie).toBe("fixture=session");
  expect(data.headers.host).toBe("fixture.localhost");
  expect(data.headers.origin).toBe(origin);
  expect(
    Object.keys(data.headers).filter((key) => /forwarded|tailscale|real-ip/.test(key)),
  ).toEqual([]);
});
it("rejects foreign origins, hosts, remote forwarding and cross-site requests", async () => {
  const { port } = await fixture();
  for (const override of [
    { origin: "https://evil.example" },
    { host: "evil.example" },
    { "x-forwarded-for": "203.0.113.1, 127.0.0.1" },
    { "x-forwarded-for": "" },
    { "x-forwarded-proto": "http" },
    { "x-forwarded-host": "evil.example" },
    { "sec-fetch-site": "cross-site" },
  ])
    expect((await call(port, override)).status).toBe(403);
});
it("passes the WebSocket upgrade and bidirectional bytes without redirects", async () => {
  const { upstream, port } = await fixture();
  upstream.on("upgrade", (req, socket) => {
    expect(req.headers.origin).toBe(origin);
    expect(req.headers["x-forwarded-for"]).toBeUndefined();
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    );
    socket.on("data", (data) => socket.write(data));
  });
  await new Promise<void>((resolve, reject) => {
    const req = request({
      hostname: "127.0.0.1",
      port,
      headers: { ...headers, connection: "Upgrade", upgrade: "websocket" },
    });
    req.on("error", reject);
    req.on("upgrade", (res, socket) => {
      expect(res.statusCode).toBe(101);
      socket.once("data", (data) => {
        expect(data.toString()).toBe("fixture payload");
        socket.destroy();
        resolve();
      });
      socket.write("fixture payload");
    });
    req.end();
  });
});
