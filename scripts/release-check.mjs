import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
if (process.argv.slice(2).some((arg) => arg !== "--all-refs"))
  throw new Error("Uso: node scripts/release-check.mjs [--all-refs]");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const split = (text) => text.split("\0").filter(Boolean);
const entries = split(git("ls-files", "--stage", "-z")).map(parseEntry);
const files = [
  ...new Set([
    ...entries.map(({ path }) => path),
    ...split(git("ls-files", "--others", "--exclude-standard", "-z")),
  ]),
];
const findings = new Set();
// Never consult .local, NIDO_HOME, the user's home or ignored files. The inputs
// are precisely the publishable working files and Git objects, not live state.
const privatePath =
  /(^|\/)(?:\.local[^/]*|\.runtime|\.cache|\.openclaw|\.codex|\.aws|\.ssh|node_modules|sessions|backups|family-data|workspaces|media|memory|release|__pycache__)(?:\/|$)|(?:^|\/)(?:family\.json|google-client\.json|google-credentials\.json|oauth-pending\.json|auth-profiles\.json|telegram-bot-token|device\.json|agent-context\.json|last-turn\.json|sdkconfig(?:\.old|\.defaults\.local)?|\.DS_Store)$|\.(?:sqlite(?:3)?(?:-[\w-]+)?|db(?:-(?:wal|shm|journal))?|pem|key|p12|pfx|log|bin|elf|nidoota|tgz|zip|tar(?:\.gz)?|bak)$/i;
const patterns = [
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/,
  /\bAIza[A-Za-z0-9_-]{30,}/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/,
  /\b\d{8,12}:[A-Za-z0-9_-]{30,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\b1\/\/[A-Za-z0-9_-]{25,}/,
  /\bya29\.[A-Za-z0-9_-]{20,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}/,
  /https?:\/\/[^\s/"'<>]+:[^\s/"'<>]+@/,
];
const personalHome = /(?:\/(?:Users|home)\/[^\s/<>"'`]+|[A-Za-z]:[\\/]Users[\\/][^\s\\/<>"'`]+)/;
const email = /[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
const exampleDomain =
  /(?:^|\.)(?:example\.(?:com|net|org)|test|invalid|example)$|^users\.noreply\.github\.com$/i;
function parseEntry(entry) {
  const tab = entry.indexOf("\t");
  const [mode, id, stage] = entry.slice(0, tab).split(" ");
  return { mode, id, stage, path: entry.slice(tab + 1) };
}
function checkPath(label, path, historical = false) {
  const blocked =
    privatePath.test(path) ||
    /(?:^|\/)(?:USER|MEMORY)\.md$/.test(path) ||
    (/\.(?:wav|ogg|mp3|m4a|mp4|mov)$/i.test(path) &&
      !(historical ? reviewedMediaNames.has(path.split("/").at(-1)) : assets[path])) ||
    /(?:^|\/)\.env(?:\..*)?$/i.test(path.replace(/(?:^|\/)\.env\.example$/, "")) ||
    /^firmware\/[^/]+\/(?:build|managed_components)(?:\/|$)/.test(path);
  if (blocked) findings.add(`${label}: ruta privada publicable`);
  return blocked;
}
function scanText(label, data) {
  const text = data.toString("utf8");
  if (patterns.some((pattern) => pattern.test(text))) findings.add(`${label}: posible secreto`);
  if (personalHome.test(text)) findings.add(`${label}: ruta de usuario personal`);
  if ([...text.matchAll(email)].some((match) => !exampleDomain.test(match[1])))
    findings.add(`${label}: correo o identificador personal; usa dominios de ejemplo o noreply`);
}
// lstat every component, including missing/dangling links. Never follow a
// tracked path through a directory symlink into private state.
function workingFile(path) {
  let full = root;
  const parts = path.split("/");
  for (const [index, part] of parts.entries()) {
    full = join(full, part);
    let stat;
    try {
      stat = lstatSync(full);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      findings.add(`${path}: enlace simbólico publicable; revisar destino`);
      return null;
    }
    if (index === parts.length - 1) {
      if (!stat.isFile()) {
        findings.add(`${path}: entrada no regular publicable`);
        return null;
      }
      return readFileSync(full);
    }
    if (!stat.isDirectory()) return null;
  }
}
const policyPath = "config/public-assets.json";
const policyData = workingFile(policyPath);
const assets = policyData ? JSON.parse(policyData.toString("utf8")) : {};
for (const [path, asset] of Object.entries(assets)) {
  if (
    !/^[a-f0-9]{64}$/.test(asset.sha256) ||
    !asset.description ||
    (asset.previousSha256 !== undefined &&
      (!Array.isArray(asset.previousSha256) ||
        asset.previousSha256.some((hash) => !/^[a-f0-9]{64}$/.test(hash))))
  )
    throw new Error(`Entrada inválida en ${policyPath}: ${path}`);
}
const reviewedHashes = new Set(
  Object.values(assets).flatMap(({ sha256, previousSha256 = [] }) => [sha256, ...previousSha256]),
);
const reviewedMediaNames = new Set(Object.keys(assets).map((path) => path.split("/").at(-1)));
function scan(label, data, path) {
  scanText(label, data);
  const sha256 = createHash("sha256").update(data).digest("hex");
  let binary = data.includes(0);
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    binary = true;
  }
  if (path && assets[path] && assets[path].sha256 !== sha256)
    findings.add(
      `${label}: recurso modificado; revisar contenido y metadatos antes de aprobar su hash`,
    );
  else if (binary && !(path ? assets[path]?.sha256 === sha256 : reviewedHashes.has(sha256)))
    findings.add(`${label}: binario sin revisión en ${policyPath}`);
}
for (const path of files) {
  scanText(`nombre:${path}`, path);
  if (checkPath(path, path)) continue;
  const data = workingFile(path);
  if (data) scan(path, data, path);
}
function checkEntry(label, entry, historical = false) {
  scanText(`nombre:${label}`, entry.path);
  if (checkPath(label, entry.path, historical)) return false;
  if (entry.mode === "120000" || entry.mode === "160000") {
    findings.add(`${label}: enlace simbólico o submódulo publicable; revisar destino`);
    return false;
  }
  return true;
}
const blob = (id) =>
  execFileSync("git", ["cat-file", "blob", id], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
for (const entry of entries) {
  const label = `índice:${entry.path}`;
  if (entry.stage !== "0") findings.add(`${label}: conflicto sin resolver`);
  if (checkEntry(label, entry)) scan(label, blob(entry.id), entry.path);
}
// Scan each object once. Inspect every tree entry too: rev-list reports only
// one name per object and would miss an identical blob renamed to .env.
// Codex keeps local working-tree snapshots under its own refs. Ordinary pushes
// do not send them. --all-refs can audit those separately; never push --mirror.
const refs = process.argv.includes("--all-refs") ? [] : ["--exclude=refs/codex/*"];
const ids = git("rev-list", "--objects", ...refs, "--all", "--no-object-names").trim();
const objects = ids
  ? execFileSync("git", ["cat-file", "--batch-check=%(objectname) %(objecttype)"], {
      cwd: root,
      input: ids + "\n",
      encoding: "utf8",
    })
      .trim()
      .split("\n")
  : [];
for (const object of objects) {
  const [id, type] = object.split(" ");
  const label = `historial:${id.slice(0, 12)}`;
  if (type === "blob") scan(label, blob(id));
  else if (type === "tree") {
    for (const raw of split(git("ls-tree", "-r", "-t", "-z", id))) {
      // ls-tree uses mode/type/id, whereas ls-files uses mode/id/stage.
      const entry = parseEntry(raw);
      checkEntry(`${label}:${entry.path}`, entry, true);
    }
  } else if (type === "commit" || type === "tag") {
    // Messages and author/committer/tagger emails also travel with a push.
    scanText(label, git("cat-file", type, id));
  }
}
if (findings.size) {
  // File names themselves can contain private values; do not leak those in CI.
  const redact = (text) => {
    for (const pattern of [...patterns, personalHome])
      text = text.replace(new RegExp(pattern.source, "g"), "[dato oculto]");
    return text.replace(email, (value, domain) =>
      exampleDomain.test(domain) ? value : "[correo oculto]",
    );
  };
  console.error([...findings].map(redact).join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Revisión superada: ${files.length} archivos publicables, índice e historial de publicación.`,
  );
  if (refs.length)
    console.log(
      "Se excluyen los snapshots locales refs/codex/*; usa --all-refs para auditarlos por separado.",
    );
  console.log(
    "Sin leer estado privado ni imprimir valores detectados. Los recursos binarios coinciden con los hashes revisados.",
  );
  console.log(
    "Revisa también nombres, texto libre e identidad de los commits: ningún escáner detecta todos los datos personales.",
  );
}
