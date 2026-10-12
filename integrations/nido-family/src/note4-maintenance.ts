import {
  createHash,
  randomBytes,
  timingSafeEqual,
  createPublicKey,
  verify,
  X509Certificate,
} from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NidoError } from "./core.js";

export const NOTE4_BOARD = "note4-mono-v1";
export const OTA_LIMIT = 4 * 1024 * 1024;
export type FirmwareManifest = {
  board: string;
  version: string;
  configVersion: number;
  size: number;
  sha256: string;
};
export type FirmwareEnvelope = { manifest: string; signature: string };
const hash = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const invalid = (): never => {
  throw new NidoError("INVALID_INPUT", "Datos de mantenimiento inválidos.");
};
export function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value)) invalid();
  return value as string;
}
export function localEndpoint(value: unknown): string {
  if (typeof value !== "string" || value.length > 160) invalid();
  let url: URL;
  try {
    url = new URL(value as string);
  } catch {
    return invalid();
  }
  const ip = url.hostname.split(".").map(Number);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) ||
    ip.some((n) => !Number.isInteger(n) || n > 255) ||
    !(
      ip[0] === 10 ||
      (ip[0] === 192 && ip[1] === 168) ||
      (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31)
    )
  )
    invalid();
  return url.origin;
}
export function parseFirmware(envelope: FirmwareEnvelope, publicKey: string): FirmwareManifest {
  if (
    !envelope ||
    typeof envelope.manifest !== "string" ||
    Buffer.byteLength(envelope.manifest) > 1024 ||
    typeof envelope.signature !== "string" ||
    !/^[0-9a-f]{512}$/.test(envelope.signature)
  )
    invalid();
  const key = createPublicKey(publicKey);
  if (
    key.asymmetricKeyType !== "rsa" ||
    key.asymmetricKeyDetails?.modulusLength !== 2048 ||
    !verify("sha256", Buffer.from(envelope.manifest), key, Buffer.from(envelope.signature, "hex"))
  )
    throw new NidoError("SIGNATURE", "Firma de firmware inválida.");
  let m: FirmwareManifest;
  try {
    m = JSON.parse(envelope.manifest);
  } catch {
    return invalid();
  }
  if (
    !m ||
    Object.keys(m).sort().join(",") !== "board,configVersion,sha256,size,version" ||
    m.board !== NOTE4_BOARD ||
    m.configVersion !== 1 ||
    !Number.isInteger(m.size) ||
    m.size < 256 ||
    m.size > OTA_LIMIT ||
    typeof m.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(m.sha256)
  )
    invalid();
  identifier(m.version);
  if (m.version.length > 31) invalid();
  return m;
}
export function firmwareDescriptor(binary: Buffer, version: string) {
  if (
    binary.length < 288 ||
    binary[0] !== 0xe9 ||
    binary.readUInt16LE(12) !== 9 ||
    binary.readUInt32LE(32) !== 0xabcd5432
  )
    invalid();
  const text = (start: number) => {
    const field = binary.subarray(start, start + 32);
    const end = field.indexOf(0);
    if (end < 0) invalid();
    return field.subarray(0, end).toString("utf8");
  };
  if (text(48) !== version || text(80) !== "nido_note4")
    throw new NidoError(
      "INCOMPATIBLE",
      "Versión o proyecto distintos del descriptor del firmware.",
    );
}
export class Note4Maintenance {
  readonly db: DatabaseSync;
  constructor(
    readonly directory: string,
    readonly publicKey = "",
    readonly now = () => Date.now(),
  ) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, "maintenance.sqlite");
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS pairing (grant_hash TEXT PRIMARY KEY, endpoint TEXT NOT NULL, certificate TEXT NOT NULL, expires INTEGER NOT NULL, device TEXT, token_hash TEXT);
      CREATE TABLE IF NOT EXISTS device (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, version TEXT, last_seen INTEGER, boot TEXT);
      CREATE TABLE IF NOT EXISTS release (version TEXT PRIMARY KEY, envelope TEXT NOT NULL, sha256 TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS update_job (id TEXT PRIMARY KEY, device TEXT NOT NULL, version TEXT NOT NULL, phase TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, detail TEXT NOT NULL DEFAULT '');`);
  }
  close() {
    this.db.close();
  }
  pair(endpoint: unknown, certificate: unknown) {
    const address = localEndpoint(endpoint);
    if (typeof certificate !== "string" || certificate.length > 4096) invalid();
    try {
      const cert = new X509Certificate(certificate as string);
      if (!cert.checkIP(new URL(address).hostname)) invalid();
    } catch {
      invalid();
    }
    const grant = randomBytes(32).toString("hex"),
      expiresAt = Math.floor(this.now() / 1000) + 900;
    this.db
      .prepare("INSERT INTO pairing(grant_hash,endpoint,certificate,expires) VALUES(?,?,?,?)")
      .run(hash(grant), address, certificate as string, expiresAt);
    return {
      schema: 1,
      endpoint: address,
      certificate,
      grant,
      issuedAt: Math.floor(this.now() / 1000),
      expiresAt,
    };
  }
  redeem(raw: any) {
    if (
      !raw ||
      Object.keys(raw).sort().join(",") !== "deviceId,grant,token" ||
      !/^[a-f0-9]{64}$/.test(raw.grant) ||
      !/^[a-f0-9]{64}$/.test(raw.token)
    )
      invalid();
    const deviceId = identifier(raw.deviceId),
      digest = hash(raw.token);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const grant = this.db
        .prepare("SELECT * FROM pairing WHERE grant_hash=?")
        .get(hash(raw.grant));
      if (!grant || Number(grant.expires) < this.now() / 1000)
        throw new NidoError("EXPIRED", "Vinculación caducada.");
      if (grant.device && (grant.device !== deviceId || grant.token_hash !== digest))
        throw new NidoError("CONFLICT", "Vinculación ya utilizada.");
      if (this.db.prepare("SELECT id FROM device WHERE id<>?").get(deviceId))
        throw new NidoError("CONFLICT", "Este puente admite un solo NOTE4.");
      // Replaying an old grant must never replace a subsequently rotated token.
      if (grant.device) {
        const device = this.db.prepare("SELECT token_hash FROM device WHERE id=?").get(deviceId);
        if (device?.token_hash !== digest)
          throw new NidoError("CONFLICT", "Vinculación sustituida.");
      } else {
        this.db
          .prepare(
            "INSERT INTO device(id,token_hash) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET token_hash=excluded.token_hash",
          )
          .run(deviceId, digest);
        this.db
          .prepare("UPDATE pairing SET device=?,token_hash=? WHERE grant_hash=?")
          .run(deviceId, digest, hash(raw.grant));
      }
      this.db.exec("COMMIT");
      return { ready: true, deviceId };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  authenticate(header: unknown): string | undefined {
    if (typeof header !== "string" || !/^Bearer [a-f0-9]{64}$/.test(header)) return;
    const digest = Buffer.from(hash(header.slice(7)));
    for (const row of this.db.prepare("SELECT id,token_hash FROM device").all()) {
      const expected = Buffer.from(String(row.token_hash));
      if (expected.length === digest.length && timingSafeEqual(expected, digest))
        return String(row.id);
    }
  }
  publish(envelope: FirmwareEnvelope, binary: Buffer) {
    const manifest = parseFirmware(envelope, this.publicKey);
    if (
      binary.length !== manifest.size ||
      hash(binary) !== manifest.sha256 ||
      binary[0] !== 0xe9 ||
      binary.readUInt16LE(12) !== 9
    )
      invalid();
    firmwareDescriptor(binary, manifest.version);
    const old = this.db
      .prepare("SELECT sha256,envelope FROM release WHERE version=?")
      .get(manifest.version);
    if (old && (old.sha256 !== manifest.sha256 || old.envelope !== JSON.stringify(envelope)))
      throw new NidoError("CONFLICT", "La versión ya existe con otro contenido.");
    const path = join(this.directory, `${manifest.sha256}.bin`);
    if (!existsSync(path)) {
      try {
        writeFileSync(path, binary, { mode: 0o600, flag: "wx" });
      } catch (error: any) {
        if (error.code !== "EEXIST") throw error;
      }
    }
    if (hash(readFileSync(path)) !== manifest.sha256)
      throw new NidoError("INTEGRITY", "Artefacto almacenado corrupto.");
    this.db
      .prepare("INSERT OR IGNORE INTO release VALUES(?,?,?)")
      .run(manifest.version, JSON.stringify(envelope), manifest.sha256);
    return manifest;
  }
  request(id: unknown, device: unknown, version: unknown) {
    const jobId = identifier(id),
      deviceId = identifier(device),
      release = identifier(version);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const old = this.db.prepare("SELECT * FROM update_job WHERE id=?").get(jobId);
      if (old) {
        if (old.device !== deviceId || old.version !== release)
          throw new NidoError("CONFLICT", "Identificador usado para otra actualización.");
        this.db.exec("COMMIT");
        return old;
      }
      if (
        !this.db.prepare("SELECT id FROM device WHERE id=?").get(deviceId) ||
        !this.db.prepare("SELECT version FROM release WHERE version=?").get(release)
      )
        throw new NidoError("NOT_FOUND", "Dispositivo o versión desconocidos.");
      this.expire();
      if (
        this.db
          .prepare(
            "SELECT id FROM update_job WHERE device=? AND phase IN ('queued','installing','uncertain')",
          )
          .get(deviceId)
      )
        throw new NidoError("BUSY", "Hay una actualización pendiente; consulta su estado.");
      const created = Math.floor(this.now() / 1000);
      this.db
        .prepare(
          "INSERT INTO update_job(id,device,version,phase,created,expires) VALUES(?,?,?,'queued',?,?)",
        )
        .run(jobId, deviceId, release, created, created + 86400);
      const result = this.db.prepare("SELECT * FROM update_job WHERE id=?").get(jobId);
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  private expire() {
    const now = Math.floor(this.now() / 1000);
    this.db
      .prepare("UPDATE update_job SET phase='expired' WHERE phase='queued' AND expires<?")
      .run(now);
    // Installation timeout is uncertain, never reissued automatically.
    this.db
      .prepare("UPDATE update_job SET phase='uncertain' WHERE phase='installing' AND expires<?")
      .run(now);
  }
  check(device: string, version: unknown, boot: unknown, jobId?: unknown) {
    identifier(version);
    if (jobId) identifier(jobId);
    if (!["valid", "rollback"].includes(String(boot))) invalid();
    this.expire();
    this.db
      .prepare("UPDATE device SET version=?,boot=?,last_seen=? WHERE id=?")
      .run(String(version), String(boot), Math.floor(this.now() / 1000), device);
    const active = this.db
      .prepare(
        "SELECT * FROM update_job WHERE device=? AND phase IN ('queued','installing','uncertain') ORDER BY created DESC LIMIT 1",
      )
      .get(device);
    if (active && active.phase !== "queued") {
      // A normal boot on another version cannot prove rollback (e.g. download interrupted).
      if (active.version === version || (boot === "rollback" && jobId === active.id))
        this.db
          .prepare("UPDATE update_job SET phase=? WHERE id=?")
          .run(active.version === version ? "complete" : "rollback", String(active.id));
      return { update: null };
    }
    if (!active) return { update: null };
    if (active.version === version) {
      this.db.prepare("UPDATE update_job SET phase='complete' WHERE id=?").run(String(active.id));
      return { update: null };
    }
    const row = this.db
      .prepare("SELECT envelope FROM release WHERE version=?")
      .get(String(active.version))!;
    return { update: { id: active.id, ...JSON.parse(String(row.envelope)) } };
  }
  report(device: string, raw: any) {
    if (
      !raw ||
      !["installing", "failed", "deferred"].includes(raw.phase) ||
      (raw.detail &&
        !["battery", "download", "signature", "storage", "incompatible"].includes(raw.detail))
    )
      invalid();
    const id = identifier(raw.id);
    const job = this.db.prepare("SELECT * FROM update_job WHERE id=? AND device=?").get(id, device);
    if (!job) throw new NidoError("NOT_FOUND", "Actualización desconocida.");
    if (
      job.phase !== "queued" &&
      job.phase !== raw.phase &&
      !(raw.phase === "failed" && job.phase === "installing")
    )
      throw new NidoError("CONFLICT", "Transición de actualización inválida.");
    if (raw.phase === "deferred")
      this.db.prepare("UPDATE update_job SET detail=? WHERE id=?").run(raw.detail ?? "battery", id);
    else
      this.db
        .prepare("UPDATE update_job SET phase=?,detail=?,expires=? WHERE id=?")
        .run(raw.phase, raw.detail ?? "", Math.floor(this.now() / 1000) + 600, id);
    return { accepted: true };
  }
  binary(device: string, id: unknown) {
    const job = this.db
      .prepare(
        "SELECT r.sha256 FROM update_job j JOIN release r ON r.version=j.version WHERE j.id=? AND j.device=? AND j.phase='installing'",
      )
      .get(identifier(id), device);
    if (!job) throw new NidoError("NOT_FOUND", "Descarga no autorizada.");
    const data = readFileSync(join(this.directory, `${job.sha256}.bin`));
    if (hash(data) !== job.sha256)
      throw new NidoError("INTEGRITY", "Artefacto almacenado corrupto.");
    return data;
  }
  resolve(raw: any) {
    const id = identifier(raw?.id);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.expire();
      const job = this.db.prepare("SELECT * FROM update_job WHERE id=?").get(id);
      if (!job || job.phase !== "uncertain")
        throw new NidoError("CONFLICT", "La actualización no está pendiente de reconciliación.");
      const device = this.db.prepare("SELECT * FROM device WHERE id=?").get(String(job.device));
      if (
        !device ||
        device.version !== raw.deviceVersion ||
        device.last_seen !== raw.lastSeen ||
        device.version === job.version ||
        Number(device.last_seen) < Number(job.expires) - 600 ||
        this.now() / 1000 - Number(device.last_seen) > 330
      )
        throw new NidoError(
          "CONFLICT",
          "Consulta de nuevo un dispositivo conectado antes de resolver la incertidumbre.",
        );
      this.db
        .prepare("UPDATE update_job SET phase='failed',detail='reconciled' WHERE id=?")
        .run(id);
      this.db.exec("COMMIT");
      return { resolved: true };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  status() {
    this.expire();
    return {
      devices: this.db.prepare("SELECT id,version,last_seen,boot FROM device").all(),
      releases: this.db.prepare("SELECT version,sha256 FROM release ORDER BY rowid DESC").all(),
      updates: this.db.prepare("SELECT * FROM update_job ORDER BY created DESC LIMIT 50").all(),
    };
  }
}
