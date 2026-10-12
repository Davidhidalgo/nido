import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
// @ts-expect-error Local operator script.
import { preparePrivateState } from "../scripts/private-state.mjs";
const roots: string[] = [];
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "nido-private-"));
  roots.push(base);
  const root = join(base, "repo");
  await mkdir(root);
  return { root, target: join(base, "private") };
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
test("moves existing state without losing data and remains idempotent", async () => {
  const { root, target } = await fixture();
  await mkdir(join(root, ".local"));
  await writeFile(join(root, ".local", "preference"), "fixture");
  await preparePrivateState(root, target);
  expect(await readFile(join(target, "preference"), "utf8")).toBe("fixture");
  expect(await realpath(join(root, ".local"))).toBe(await realpath(target));
  await preparePrivateState(root, target);
});
test("refuses an existing destination and does not overwrite another family", async () => {
  const { root, target } = await fixture();
  await mkdir(target);
  await writeFile(join(target, "preference"), "other family");
  await expect(preparePrivateState(root, target)).rejects.toThrow("ya existe");
  expect(await readFile(join(target, "preference"), "utf8")).toBe("other family");
});
test("rejects in-repo destinations, including parent symlinks", async () => {
  const { root, target } = await fixture();
  await expect(preparePrivateState(root, join(root, "private"))).rejects.toThrow("fuera");
  await symlink(root, target);
  await expect(preparePrivateState(root, join(target, "private"))).rejects.toThrow("fuera");
});
