import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  Note4Maintenance,
  localEndpoint,
  parseFirmware,
} from "../integrations/nido-family/src/note4-maintenance.js";
import { maintenanceHandler } from "../integrations/nido-family/src/note4-maintenance-http.js";
import { registerNote4Admin } from "../integrations/nido-family/src/note4-admin.js";
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKey = keys.publicKey.export({ format: "pem", type: "spki" }).toString();
const dirs: string[] = [],
  managers: Note4Maintenance[] = [];
let certificate: string;
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "nido-cert-fixture-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=192.168.1.2",
        "-addext",
        "subjectAltName=IP:192.168.1.2",
        "-keyout",
        join(dir, "key.pem"),
        "-out",
        join(dir, "cert.pem"),
      ],
      { stdio: "ignore" },
    );
    certificate = readFileSync(join(dir, "cert.pem"), "utf8");
  } finally {
    rmSync(dir, { recursive: true });
  }
});
afterEach(() => {
  for (const m of managers.splice(0)) m.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "nido-maintenance-"));
  dirs.push(directory);
  let clock = 1791547200000;
  const m = new Note4Maintenance(directory, publicKey, () => clock);
  managers.push(m);
  return { m, advance: (ms: number) => (clock += ms), directory };
}
function paired(m: Note4Maintenance) {
  const pair = m.pair("https://192.168.1.2:18791", certificate);
  const input = { grant: pair.grant, token: "a".repeat(64), deviceId: "note4-demo" };
  m.redeem(input);
  return { pair, input };
}
function release(version = "nido-ota-0.3") {
  const binary = Buffer.alloc(1024);
  binary[0] = 0xe9;
  binary.writeUInt16LE(9, 12);
  binary.writeUInt32LE(0xabcd5432, 32);
  binary.write(version, 48);
  binary.write("nido_note4", 80);
  const manifest = JSON.stringify({
    board: "note4-mono-v1",
    version,
    configVersion: 1,
    size: binary.length,
    sha256: createHash("sha256").update(binary).digest("hex"),
  });
  const envelope = {
    manifest,
    signature: sign("sha256", Buffer.from(manifest), keys.privateKey).toString("hex"),
  };
  return { binary, envelope };
}
async function http(
  m: Note4Maintenance,
  path: string,
  method = "GET",
  input?: unknown,
  token?: string,
) {
  const req: any = Readable.from(input === undefined ? [] : [Buffer.from(JSON.stringify(input))]);
  Object.assign(req, {
    url: path,
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  let status = 0,
    body: any;
  const res: any = {
    setHeader() {},
    writeHead(n: number) {
      status = n;
    },
    end(data: any) {
      body = data;
    },
  };
  const handled = await maintenanceHandler(m)(req, res);
  return {
    handled,
    status,
    body: Buffer.isBuffer(body) ? body : body ? JSON.parse(body) : undefined,
  };
}
describe("NOTE4 maintenance", () => {
  it("validates local addresses and trust before issuing pairing packages", () => {
    const { m } = setup();
    expect(localEndpoint("https://192.168.1.2:18791/")).toBe("https://192.168.1.2:18791");
    for (const url of [
      "http://192.168.1.2",
      "https://8.8.8.8",
      "https://user@192.168.1.2",
      "https://192.168.1.2/path",
    ])
      expect(() => localEndpoint(url)).toThrow();
    expect(() => m.pair("https://192.168.1.3", certificate)).toThrow();
    expect(m.pair("https://192.168.1.2", certificate)).toMatchObject({
      schema: 1,
      issuedAt: 1791547200,
      expiresAt: 1791548100,
    });
  });
  it("reconciles a lost pairing reply and rejects stolen, expired and superseded grants", () => {
    const { m, advance } = setup();
    const { input } = paired(m);
    expect(m.redeem(input)).toMatchObject({ ready: true });
    expect(() => m.redeem({ ...input, token: "b".repeat(64) })).toThrow();
    expect(m.authenticate(`Bearer ${input.token}`)).toBe(input.deviceId);
    expect(m.authenticate("Bearer bad")).toBeUndefined();
    const next = m.pair("https://192.168.1.2", certificate);
    m.redeem({ ...input, grant: next.grant, token: "c".repeat(64) });
    expect(() => m.redeem(input)).toThrow();
    expect(m.authenticate(`Bearer ${input.token}`)).toBeUndefined();
    advance(901000);
    expect(() => m.redeem({ ...input, grant: next.grant, token: "c".repeat(64) })).toThrow();
  });
  it("prevents multiple devices from sharing the single voice/session bridge", () => {
    const { m } = setup();
    paired(m);
    const p = m.pair("https://192.168.1.2", certificate);
    expect(() => m.redeem({ grant: p.grant, token: "b".repeat(64), deviceId: "other" })).toThrow();
  });
  it("rejects invalid signatures, wrong chips and tampered binaries", () => {
    const { m } = setup();
    const { binary, envelope } = release();
    expect(() =>
      parseFirmware({ ...envelope, manifest: envelope.manifest.replace("0.3", "0.4") }, publicKey),
    ).toThrow();
    binary[0] = 0;
    expect(() => m.publish(envelope, binary)).toThrow();
    binary[0] = 0xe9;
    m.publish(envelope, binary);
    writeFileSync(
      join(m.directory, createHash("sha256").update(binary).digest("hex") + ".bin"),
      Buffer.alloc(1),
    );
    expect(() => m.publish(envelope, binary)).toThrow();
  });
  it("deduplicates orders and reconciles reboot without silently retrying uncertain installs", () => {
    const { m, advance } = setup();
    paired(m);
    const { binary, envelope } = release();
    m.publish(envelope, binary);
    const a = m.request("job-1", "note4-demo", "nido-ota-0.3");
    expect(m.request("job-1", "note4-demo", "nido-ota-0.3")).toEqual(a);
    expect(() => m.request("job-1", "note4-demo", "other")).toThrow();
    expect(() => m.request("job-2", "note4-demo", "nido-ota-0.3")).toThrow();
    expect(m.check("note4-demo", "old", "valid").update).toMatchObject({ id: "job-1" });
    m.report("note4-demo", { id: "job-1", phase: "deferred", detail: "battery" });
    expect(() => m.binary("note4-demo", "job-1")).toThrow();
    m.report("note4-demo", { id: "job-1", phase: "installing" });
    expect(m.binary("note4-demo", "job-1")).toEqual(binary);
    advance(601000);
    expect(m.check("note4-demo", "old", "valid")).toEqual({ update: null });
    expect(m.status().updates[0].phase).toBe("uncertain");
    expect(() => m.request("job-2", "note4-demo", "nido-ota-0.3")).toThrow();
    m.check("note4-demo", "nido-ota-0.3", "valid");
    expect(m.status().updates[0].phase).toBe("complete");
  });
  it("expires queued updates and records rollback separately", () => {
    const { m, advance } = setup();
    paired(m);
    const r = release();
    m.publish(r.envelope, r.binary);
    m.request("expired", "note4-demo", "nido-ota-0.3");
    advance(86401000);
    expect(m.check("note4-demo", "old", "valid").update).toBeNull();
    expect(m.status().updates[0].phase).toBe("expired");
    m.request("job", "note4-demo", "nido-ota-0.3");
    m.report("note4-demo", { id: "job", phase: "installing" });
    m.check("note4-demo", "old", "rollback", "job");
    expect(m.status().updates.find((j) => j.id === "job")?.phase).toBe("rollback");
  });
  it("requires device authentication on OTA routes and limits unauthenticated pairing bodies", async () => {
    const { m } = setup();
    const { input } = paired(m);
    expect((await http(m, "/v1/maintenance/check?version=old&boot=valid")).status).toBe(401);
    expect(
      (await http(m, "/v1/maintenance/check?version=old&boot=valid", "GET", undefined, input.token))
        .status,
    ).toBe(200);
    expect((await http(m, "/v1/pair", "POST", { huge: "x".repeat(9000) })).status).toBe(400);
    expect((await http(m, "/v1/home")).handled).toBe(false);
  });
  it("registers administrative RPCs rather than family model tools", async () => {
    const { directory } = setup();
    const calls = new Map<string, any>();
    const api: any = {
      runtime: {
        config: {
          current: () => ({
            plugins: {
              entries: { "nido-family": { config: { dataDir: directory, note4Maintenance: {} } } },
            },
          }),
        },
      },
      registerGatewayMethod: (name: string, fn: any, options: any) =>
        calls.set(name, { fn, options }),
    };
    registerNote4Admin(api);
    expect(calls.get("nido.note4.status").options.scope).toBe("operator.read");
    for (const name of [
      "pair",
      "pairCode",
      "discover",
      "publish",
      "update",
      "resolve",
      "githubCheck",
      "githubDownload",
    ])
      expect(calls.get(`nido.note4.${name}`).options.scope).toBe("operator.admin");
    let response: any;
    await calls.get("nido.note4.update").fn({
      params: { id: "a", deviceId: "missing", version: "missing" },
      respond: (...args: any[]) => (response = args),
    });
    expect(response[0]).toBe(false);
    await calls
      .get("nido.note4.githubCheck")
      .fn({ params: {}, respond: (...args: any[]) => (response = args) });
    expect(response).toEqual([true, { configured: false }]);
    await calls
      .get("nido.note4.githubDownload")
      .fn({ params: {}, respond: (...args: any[]) => (response = args) });
    expect(response[0]).toBe(false);
    expect(response[2].message).toContain("github.repository");
  });
  it("requires a fresh matching observation before resolving an uncertain install", () => {
    const { m, advance } = setup();
    paired(m);
    const r = release();
    m.publish(r.envelope, r.binary);
    m.request("job", "note4-demo", "nido-ota-0.3");
    m.report("note4-demo", { id: "job", phase: "installing" });
    advance(601000);
    expect(() => m.resolve({ id: "job", deviceVersion: "old", lastSeen: 0 })).toThrow();
    m.check("note4-demo", "old", "valid");
    const device = m.status().devices[0];
    expect(() =>
      m.resolve({ id: "job", deviceVersion: "old", lastSeen: Number(device.last_seen) - 1 }),
    ).toThrow();
    expect(m.resolve({ id: "job", deviceVersion: "old", lastSeen: device.last_seen })).toEqual({
      resolved: true,
    });
    expect(m.request("new-job", "note4-demo", "nido-ota-0.3")?.phase).toBe("queued");
  });
});
