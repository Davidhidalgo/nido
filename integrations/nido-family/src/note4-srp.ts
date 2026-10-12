/** Client for ESP-IDF protocomm security2 (SRP-6a SHA-512/3072, patch 1).
 * Wire format and transcript follow the SDK's tools/esp_prov/security/security2.py.
 */
import {
  createHash,
  getDiffieHellman,
  randomBytes,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
const prime = getDiffieHellman("modp15").getPrime();
const integer = (b: Buffer) => BigInt("0x" + (b.toString("hex") || "0"));
const N = integer(prime),
  g = 5n;
function bytes(n: bigint, width = 0) {
  let s = n.toString(16);
  if (s.length % 2) s = "0" + s;
  return Buffer.from(s.padStart(width * 2, "0"), "hex");
}
const H = (...parts: Buffer[]) => createHash("sha512").update(Buffer.concat(parts)).digest();
function pow(base: bigint, exponent: bigint) {
  let out = 1n;
  base = ((base % N) + N) % N;
  while (exponent) {
    if (exponent & 1n) out = (out * base) % N;
    base = (base * base) % N;
    exponent >>= 1n;
  }
  return out;
}
function varint(n: number) {
  const b = [];
  do {
    b.push((n & 127) | (n > 127 ? 128 : 0));
    n = Math.floor(n / 128);
  } while (n);
  return Buffer.from(b);
}
export function proto(fields: Record<number, Buffer | number>) {
  return Buffer.concat(
    Object.entries(fields).flatMap(([key, v]) =>
      typeof v === "number"
        ? [varint(Number(key) * 8), varint(v)]
        : [varint(Number(key) * 8 + 2), varint(v.length), v],
    ),
  );
}
export function unproto(data: Buffer) {
  const fields = new Map<number, Buffer | number>();
  let p = 0;
  const read = () => {
    let n = 0,
      m = 1;
    for (let i = 0; i < 5 && p < data.length; i++) {
      const b = data[p++];
      n += (b & 127) * m;
      if (!(b & 128)) return n;
      m *= 128;
    }
    throw Error("Protocolo de vinculación inválido");
  };
  while (p < data.length) {
    const tag = read(),
      id = Math.floor(tag / 8),
      wire = tag & 7;
    if (!id || fields.has(id)) throw Error("Campo de vinculación inválido");
    if (wire === 0) fields.set(id, read());
    else if (wire === 2) {
      const len = read();
      if (p + len > data.length) throw Error("Respuesta incompleta");
      fields.set(id, data.subarray(p, p + len));
      p += len;
    } else throw Error("Formato de vinculación inválido");
  }
  return fields;
}
function field(m: Map<number, Buffer | number>, id: number) {
  const b = m.get(id);
  if (!Buffer.isBuffer(b)) throw Error("Respuesta de vinculación inválida");
  return b;
}
function response(data: Buffer, msg: number, id: number) {
  const outer = unproto(data);
  if (outer.get(2) !== 2) throw Error("Seguridad incompatible");
  const inner = unproto(field(outer, 12));
  if (inner.get(1) !== msg) throw Error("Fase incompatible");
  const body = unproto(field(inner, id));
  if ((body.get(1) || 0) !== 0) throw Error("Código no válido");
  return body;
}
export class Note4Srp {
  private a = integer(randomBytes(32)) | (1n << 255n);
  private A = bytes(pow(g, this.a), 384);
  private key?: Buffer;
  private proof?: Buffer;
  private nonce?: Buffer;
  constructor(private code: string) {
    if (!/^\d{6}$/.test(code)) throw Error("Introduce los seis dígitos del Note4");
  }
  hello() {
    return proto({ 2: 2, 12: proto({ 20: proto({ 1: Buffer.from("nido"), 2: this.A }) }) });
  }
  challenge(data: Buffer) {
    const r = response(data, 1, 21),
      B = field(r, 2),
      salt = field(r, 3),
      bn = integer(B);
    if (!B.length || B.length > 384 || bn <= 0n || bn >= N || salt.length !== 16)
      throw Error("Desafío de vinculación inválido");
    const u = integer(H(this.A, bytes(bn, 384)));
    if (!u) throw Error("Desafío nulo");
    const x = integer(H(salt, H(Buffer.from("nido:" + this.code))));
    const k = integer(H(prime, bytes(g, 384)));
    this.key = H(bytes(pow(bn - k * pow(g, x), this.a + u * x)));
    const hg = H(bytes(g, 384));
    const xor = Buffer.from(H(prime).map((b, i) => b ^ hg[i]));
    const M = H(xor, H(Buffer.from("nido")), salt, this.A, B, this.key);
    this.proof = H(this.A, M, this.key);
    this.code = "";
    return proto({ 2: 2, 12: proto({ 1: 2, 22: proto({ 1: M }) }) });
  }
  verify(data: Buffer) {
    const r = response(data, 3, 23),
      proof = field(r, 2),
      nonce = field(r, 3);
    if (
      !this.proof ||
      proof.length !== 64 ||
      !timingSafeEqual(proof, this.proof) ||
      nonce.length !== 12 ||
      nonce.readUInt32BE(8) !== 1
    )
      throw Error("El código no coincide con este Note4");
    this.nonce = Buffer.from(nonce);
  }
  private cipher(decrypt: boolean, data: Buffer) {
    if (!this.nonce || !this.key) throw Error("Sesión no autenticada");
    if (decrypt && data.length < 16) throw Error("Respuesta cifrada incompleta");
    const nonce = Buffer.from(this.nonce),
      counter = nonce.readUInt32BE(8);
    if (counter === 0xffffffff) throw Error("Sesión agotada");
    this.nonce.writeUInt32BE(counter + 1, 8);
    if (decrypt) {
      const c = createDecipheriv("aes-256-gcm", this.key.subarray(0, 32), nonce);
      c.setAuthTag(data.subarray(-16));
      return Buffer.concat([c.update(data.subarray(0, -16)), c.final()]);
    }
    const c = createCipheriv("aes-256-gcm", this.key.subarray(0, 32), nonce);
    return Buffer.concat([c.update(data), c.final(), c.getAuthTag()]);
  }
  encrypt(data: Buffer) {
    return this.cipher(false, data);
  }
  decrypt(data: Buffer) {
    return this.cipher(true, data);
  }
}
