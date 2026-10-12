import { lstat, realpath, mkdir, rename, symlink, unlink, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";

const inside = (parent, child) => {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(".." + "/") && path !== ".." && !isAbsolute(path));
};
const stat = (path) =>
  lstat(path).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });

// Keep the legacy path for firmware, existing sessions and operator scripts.
// Only the link lives in the checkout; the entire state lives outside it.
export async function preparePrivateState(root, destination = process.env.NIDO_HOME) {
  root = await realpath(root);
  const local = join(root, ".local");
  const current = await stat(local);
  if (current?.isSymbolicLink()) {
    const target = await realpath(local);
    if (inside(root, target)) throw new Error(".local debe apuntar fuera del repositorio.");
    if (destination && (await realpath(resolve(destination))) !== target)
      throw new Error("NIDO_HOME no coincide con el estado existente. No se ha movido nada.");
    await chmod(target, 0o700);
    return target;
  }
  if (current && !current.isDirectory()) throw new Error(".local no es un directorio.");
  const requested = resolve(destination ?? join(homedir(), ".openclaw", "nido"));
  if (inside(root, requested)) throw new Error("NIDO_HOME debe quedar fuera del repositorio.");
  await mkdir(dirname(requested), { recursive: true, mode: 0o700 });
  const target = join(await realpath(dirname(requested)), requested.split("/").at(-1));
  if (inside(root, target))
    throw new Error("NIDO_HOME debe quedar fuera del repositorio (también al resolver enlaces).");
  if (await stat(target))
    throw new Error("NIDO_HOME ya existe. Elige un directorio nuevo para evitar mezclar familias.");
  const pending = join(root, ".local-link-pending");
  await symlink(target, pending, "dir");
  let moved = false;
  try {
    if (current) {
      // Atomic on a single filesystem. EXDEV aborts safely; never partially copy live SQLite.
      await rename(local, target);
      moved = true;
    } else await mkdir(target, { mode: 0o700 });
    await chmod(target, 0o700);
    await rename(pending, local);
    return target;
  } catch (error) {
    if (moved) await rename(target, local);
    await unlink(pending).catch(() => {});
    throw error;
  }
}
