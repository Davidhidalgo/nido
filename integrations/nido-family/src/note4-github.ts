import { createHash } from "node:crypto";
import { NidoError } from "./core.js";
import { Note4Maintenance, OTA_LIMIT, parseFirmware } from "./note4-maintenance.js";

export type GitHubFirmwareConfig = { repository: string; tokenEnv?: string };
const bundleLimit = OTA_LIMIT + 1552;
const fail = (message: string): never => {
  throw new NidoError("GITHUB", message);
};
export function githubConfig(raw: unknown): GitHubFirmwareConfig | undefined {
  if (raw === undefined) return undefined;
  const c = raw as GitHubFirmwareConfig;
  if (
    !c ||
    typeof c.repository !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_][a-zA-Z0-9._-]{0,99}$/.test(c.repository) ||
    (c.tokenEnv !== undefined && !/^[A-Z_][A-Z0-9_]{0,79}$/.test(c.tokenEnv))
  )
    fail(
      "Configura GitHub con propietario/repositorio y, si es privado, el nombre de una variable de entorno para el token.",
    );
  return c;
}
function parts(version: string) {
  if (
    !/^nido-ota-(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?$/.test(version) ||
    version.length > 31
  )
    return undefined;
  const p = version.slice(9).split(".").map(Number);
  if (!p.every(Number.isSafeInteger)) return undefined;
  return [...p, ...Array(3 - p.length).fill(0)];
}
export function newerFirmware(next: string, current: string): boolean | null {
  const a = parts(next),
    b = parts(current);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
/** Bounded transport: only GitHub's API and release storage; never forward tokens to storage. */
export async function githubBytes(
  url: string,
  limit: number,
  token: string | undefined,
  binary = false,
  fetcher: typeof fetch = fetch,
): Promise<Buffer> {
  const signal = AbortSignal.timeout(30000);
  try {
    for (let hop = 0; hop < 4; hop++) {
      const u = new URL(url);
      if (
        u.protocol !== "https:" ||
        u.port ||
        u.username ||
        u.password ||
        ![
          "api.github.com",
          "release-assets.githubusercontent.com",
          "objects.githubusercontent.com",
        ].includes(u.hostname)
      )
        fail("GitHub redirigió la descarga a un destino no permitido.");
      const response = await fetcher(u, {
        redirect: "manual",
        signal,
        headers: {
          Accept: binary ? "application/octet-stream" : "application/vnd.github+json",
          "User-Agent": "Nido-Note4-OTA",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(token && u.hostname === "api.github.com" ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) fail("Redirección de GitHub incompleta.");
        url = new URL(location!, u).href;
        continue;
      }
      if (response.status !== 200) {
        await response.body?.cancel();
        fail(
          response.status === 404
            ? "No hay release accesible. Comprueba el repositorio, sus releases y los permisos si es privado."
            : response.status === 403 || response.status === 429
              ? "GitHub ha limitado el acceso. Revisa los permisos o espera antes de consultar de nuevo."
              : "No se pudo descargar la release de GitHub.",
        );
      }
      const declared = response.headers.get("content-length");
      if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
        await response.body?.cancel();
        fail("La respuesta de GitHub supera el tamaño permitido.");
      }
      if (!response.body) fail("Respuesta de GitHub vacía.");
      const reader = response.body!.getReader(),
        chunks: Buffer[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > limit) fail("La respuesta de GitHub supera el tamaño permitido.");
          chunks.push(Buffer.from(value));
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      return Buffer.concat(chunks);
    }
    return fail("Demasiadas redirecciones de GitHub.");
  } catch (e) {
    if (e instanceof NidoError) throw e;
    return fail(
      "No se pudo completar la consulta a GitHub. Comprueba la conexión y vuelve a consultar.",
    );
  }
}
type Selection = {
  repository: string;
  releaseId: number;
  assetId: number;
  version: string;
  size: number;
  updatedAt: string;
};
function selection(repository: string, raw: any): Selection {
  if (
    !raw ||
    raw.draft !== false ||
    raw.prerelease !== false ||
    !Number.isSafeInteger(raw.id) ||
    raw.id <= 0 ||
    typeof raw.tag_name !== "string" ||
    !parts(raw.tag_name) ||
    !Array.isArray(raw.assets)
  )
    return fail("La última release no es un firmware estable de Nido (tag nido-ota-X.Y.Z).");
  const assets = raw.assets.filter(
    (a: any) => typeof a?.name === "string" && a.name.endsWith(".nidoota"),
  );
  if (assets.length !== 1)
    return fail("La release debe contener exactamente un archivo .nidoota firmado.");
  const a = assets[0];
  if (
    a.state !== "uploaded" ||
    !Number.isSafeInteger(a.id) ||
    a.id <= 0 ||
    !Number.isSafeInteger(a.size) ||
    a.size < 816 ||
    a.size > bundleLimit ||
    typeof a.updated_at !== "string" ||
    a.updated_at.length > 40
  )
    return fail("El archivo de firmware de la release no es válido.");
  return {
    repository,
    releaseId: raw.id,
    assetId: a.id,
    version: raw.tag_name,
    size: a.size,
    updatedAt: a.updated_at,
  };
}
function decodeBundle(bytes: Buffer) {
  if (
    bytes.length < 16 ||
    bytes.length > bundleLimit ||
    bytes.subarray(0, 8).toString() !== "NIDOOTA1"
  )
    fail("Paquete OTA inválido.");
  const m = bytes.readUInt32LE(8),
    s = bytes.readUInt32LE(12);
  if (!m || m > 1024 || s !== 512 || bytes.length <= 16 + m + s) fail("Cabecera OTA inválida.");
  return {
    envelope: {
      manifest: bytes.subarray(16, 16 + m).toString("utf8"),
      signature: bytes.subarray(16 + m, 16 + m + s).toString("utf8"),
    },
    binary: bytes.subarray(16 + m + s),
  };
}
/** Download only; installation still uses the existing explicit, deduplicated update RPC. */
export class Note4GitHub {
  constructor(
    readonly config: GitHubFirmwareConfig,
    readonly fetcher: typeof fetch = fetch,
    readonly env: NodeJS.ProcessEnv = process.env,
  ) {}
  private async read(path: string, limit: number, binary = false) {
    const c = githubConfig(this.config)!;
    const token = c.tokenEnv ? this.env[c.tokenEnv] : undefined;
    if (c.tokenEnv && (!token || !/^[\x21-\x7e]{1,512}$/.test(token)))
      fail("Falta el token de GitHub en la variable de entorno configurada.");
    return githubBytes(
      `https://api.github.com/repos/${c.repository}/${path}`,
      limit,
      token,
      binary,
      this.fetcher,
    );
  }
  private async release(id: "latest" | number) {
    const bytes = await this.read(`releases/${id}`, 262144);
    let raw;
    try {
      raw = JSON.parse(bytes.toString());
    } catch {
      return fail("Metadatos de release inválidos.");
    }
    return selection(this.config.repository, raw);
  }
  async latest(currentVersion: string) {
    const selected = await this.release("latest");
    return {
      ...selected,
      newer: newerFirmware(selected.version, currentVersion),
      url: `https://github.com/${selected.repository}/releases/tag/${selected.version}`,
    };
  }
  async download(manager: Note4Maintenance, requested: unknown) {
    if (!manager.publicKey)
      return fail("Configura la clave pública de firma antes de descargar firmware.");
    const p = requested as Selection;
    if (
      !p ||
      p.repository !== this.config.repository ||
      !Number.isSafeInteger(p.releaseId) ||
      p.releaseId <= 0
    )
      return fail("Vuelve a buscar la release antes de descargarla.");
    const selected = await this.release(p.releaseId);
    if (
      selected.releaseId !== p.releaseId ||
      selected.assetId !== p.assetId ||
      selected.version !== p.version ||
      selected.size !== p.size ||
      selected.updatedAt !== p.updatedAt
    )
      return fail("La release ha cambiado. Vuelve a buscarla antes de descargar.");
    const bytes = await this.read(`releases/assets/${selected.assetId}`, bundleLimit, true);
    if (bytes.length !== selected.size) fail("Descarga de firmware incompleta.");
    const { envelope, binary } = decodeBundle(bytes);
    const manifest = parseFirmware(envelope, manager.publicKey);
    if (manifest.version !== selected.version)
      fail("El tag de GitHub no coincide con la versión firmada.");
    if (createHash("sha256").update(binary).digest("hex") !== manifest.sha256)
      fail("El contenido descargado no coincide con su firma.");
    return manager.publish(envelope, binary);
  }
}
