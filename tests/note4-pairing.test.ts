import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { Note4Srp, proto, unproto } from "../integrations/nido-family/src/note4-srp.js";
import { pairingAnswer, privateIpv4 } from "../integrations/nido-family/src/note4-discovery.js";
const server = ".cache/note4/crypto-native/test-srp-server";
function body(data: Buffer, id: number) {
  const a = unproto(data);
  const b = unproto(a.get(12) as Buffer);
  return unproto(b.get(id) as Buffer);
}
function packet(msg: number, id: number, fields: Record<number, Buffer | number>) {
  return proto({ 2: 2, 12: proto({ 1: msg, [id]: proto(fields) }) });
}
async function exchange(code: string, corrupt = false) {
  const child = spawn(server, [], { stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let errors = "";
  child.stderr.on("data", (b) => (errors += b));
  const finished = new Promise<number | null>((resolve) => child.once("exit", resolve));
  const line = async () => {
    const v = await lines.next();
    if (v.done) throw Error("SDK counterpart exited: " + errors);
    return v.value;
  };
  const send = (b: Buffer) => child.stdin.write(b.toString("hex") + "\n");
  try {
    const client = new Note4Srp(code);
    send(body(client.hello(), 20).get(2) as Buffer);
    const salt = Buffer.from(await line(), "hex"),
      B = Buffer.from(await line(), "hex");
    const proof = body(client.challenge(packet(1, 21, { 2: B, 3: salt })), 22).get(1) as Buffer;
    send(proof);
    const serverProof = await line();
    if (code !== "123456") {
      expect(serverProof).toBe("DENIED");
      expect(await finished).toBe(0);
      return;
    }
    const nonce = Buffer.from(await line(), "hex");
    const P = Buffer.from(serverProof, "hex");
    if (corrupt) {
      P[0] ^= 1;
      expect(() => client.verify(packet(3, 23, { 2: P, 3: nonce }))).toThrow();
      return;
    }
    client.verify(packet(3, 23, { 2: P, 3: nonce }));
    const plaintext = Buffer.from(
      JSON.stringify({ fixture: "certificate and one-time authorization" }),
    );
    send(client.encrypt(plaintext));
    expect(Buffer.from(await line(), "hex")).toEqual(plaintext);
    const response = Buffer.from(await line(), "hex");
    expect(client.decrypt(response).toString()).toBe('{"ok":true}');
    expect(await finished).toBe(0);
    expect(errors).toBe("");
  } finally {
    child.stdin.end();
    if (child.exitCode === null) child.kill();
  }
}
describe("Note4 code pairing", () => {
  it("rejects malformed codes, unauthenticated payloads and protobuf", () => {
    expect(() => new Note4Srp("12345")).toThrow();
    expect(() => new Note4Srp("abc123")).toThrow();
    expect(() => new Note4Srp("123456").encrypt(Buffer.from("secret"))).toThrow();
    expect(() => unproto(Buffer.from([18, 255]))).toThrow();
    expect(() => unproto(Buffer.from([8, 1, 8, 2]))).toThrow();
  });
  it("rejects invalid SRP server public values", () => {
    expect(() =>
      new Note4Srp("123456").challenge(
        packet(1, 21, { 2: Buffer.alloc(384), 3: Buffer.alloc(16) }),
      ),
    ).toThrow();
  });
  it.skipIf(!existsSync(server))(
    "interoperates with ESP-IDF SRP and Mbed TLS GCM",
    () => exchange("123456"),
    20000,
  );
  it.skipIf(!existsSync(server))("SDK rejects a wrong code", () => exchange("654321"), 20000);
  it.skipIf(!existsSync(server))(
    "rejects a forged device proof",
    () => exchange("123456", true),
    20000,
  );
  it("limits discovery to private IPv4 and matching SRV services", () => {
    expect(privateIpv4("127.0.0.1")).toBe(false);
    expect(privateIpv4("169.254.169.254")).toBe(false);
    expect(privateIpv4("192.168.1.42")).toBe(true);
    expect(privateIpv4("192.168.1.999")).toBe(false);
    const name = (s: string) =>
      Buffer.concat([
        ...s.split(".").flatMap((l) => [Buffer.from([l.length]), Buffer.from(l)]),
        Buffer.from([0]),
      ]);
    const owner = name("Nido-A1B2C3._nido-pair._tcp.local"),
      target = name("nido-a1b2c3.local");
    const head = Buffer.alloc(12);
    head[2] = 128;
    head.writeUInt16BE(1, 6);
    const record = Buffer.alloc(16);
    record.writeUInt16BE(33);
    record.writeUInt16BE(1, 2);
    record.writeUInt32BE(60, 4);
    record.writeUInt16BE(6 + target.length, 8);
    record.writeUInt16BE(80, 14);
    const data = Buffer.concat([head, owner, record, target]);
    expect(pairingAnswer(data, "192.168.1.42")).toEqual([
      { address: "192.168.1.42", name: "nido-a1b2c3" },
    ]);
    expect(pairingAnswer(data, "8.8.8.8")).toEqual([]);
    for (let n = 0; n < data.length; n++)
      expect(pairingAnswer(data.subarray(0, n), "192.168.1.42")).toEqual([]);
  });
});
