import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  rmSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { afterEach, expect, test } from "vitest";

test("release check catches staged and historical secrets without printing their values", () => {
  const root = mkdtempSync(join(tmpdir(), "nido-release-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  const check = () =>
    spawnSync(process.execPath, ["scripts/release-check.mjs"], { cwd: root, encoding: "utf8" });
  const secret = "sk-" + "x".repeat(48);
  try {
    mkdirSync(join(root, "scripts"));
    copyFileSync("scripts/release-check.mjs", join(root, "scripts/release-check.mjs"));
    git("init");
    expect(check().status).toBe(0);
    writeFileSync(join(root, "sample.txt"), secret);
    git("add", "sample.txt");
    writeFileSync(join(root, "sample.txt"), "clean working tree");
    const staged = check();
    expect(staged.status).toBe(1);
    expect(staged.stderr).toContain("índice:sample.txt");
    expect(staged.stderr + staged.stdout).not.toContain(secret);
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "fixture",
    );
    git("add", "sample.txt");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "clean fixture",
    );
    const historical = check();
    expect(historical.status).toBe(1);
    expect(historical.stderr).toContain("historial:");
    expect(historical.stderr + historical.stdout).not.toContain(secret);
    mkdirSync(join(root, ".local"));
    writeFileSync(join(root, ".local", "profile.txt"), "private fixture");
    git("add", "-f", ".local/profile.txt");
    expect(check().stderr).toContain("ruta privada publicable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "nido-release-fixture-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  const write = (path: string, content: string | Buffer) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  const commit = (message = "fixture", email = "fixture@example.invalid") => {
    git("add", "-A");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      `user.email=${email}`,
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      message,
    );
  };
  write("scripts/release-check.mjs", readFileSync("scripts/release-check.mjs"));
  write(".gitignore", ".local\n");
  git("init");
  const check = (extra: string[] = []) =>
    spawnSync(process.execPath, [...extra, "scripts/release-check.mjs"], {
      cwd: root,
      encoding: "utf8",
      timeout: 10000,
    });
  temporary.push(root);
  return { root, git, write, commit, check };
}
const temporary: string[] = [];
afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("release review never opens ignored private state", () => {
  const f = fixture();
  f.write(".local/family.json", JSON.stringify({ token: "private-fixture-token" }));
  f.write(
    "guard.cjs",
    `
    const fs = require('node:fs');
    for (const name of ['readFileSync', 'readdirSync', 'openSync']) {
      const original = fs[name];
      fs[name] = function(path, ...args) {
        if (String(path).includes('.local')) throw new Error('Private state accessed');
        return original.call(this, path, ...args);
      };
    }
    require('node:module').syncBuiltinESMExports();
  `,
  );
  expect(f.check(["--require", "./guard.cjs"]).status).toBe(0);
});

test("rejects private paths in history even when the same blob had a public name", () => {
  const f = fixture();
  f.write("public.txt", "fictitious content");
  f.commit();
  f.git("mv", "public.txt", ".env.production");
  f.commit();
  f.git("rm", ".env.production");
  f.commit();
  expect(f.check().stderr).toMatch(/historial:.*\.env\.production: ruta privada/);
});

test("checks dangling symlinks, staged links and symlinked parent directories without following them", () => {
  const f = fixture();
  symlinkSync("missing-fixture-target", join(f.root, "dangling"));
  expect(f.check().stderr).toContain("dangling: enlace simbólico");
  f.git("add", "dangling");
  rmSync(join(f.root, "dangling"));
  f.write("dangling", "safe working file");
  expect(f.check().stderr).toContain("índice:dangling: enlace simbólico");
  f.git("add", "dangling");
  f.write("docs/example.md", "safe staged file");
  f.git("add", "docs");
  rmSync(join(f.root, "docs"), { recursive: true });
  symlinkSync(join(f.root, ".local"), join(f.root, "docs"));
  const result = f.check();
  expect(result.stderr).toContain("docs/example.md: enlace simbólico");
  expect(result.status).toBe(1);
});

test("checks every historical tree for symlinks and rejects submodules", () => {
  const f = fixture();
  symlinkSync("missing-fixture-target", join(f.root, "link"));
  f.commit();
  f.git("rm", "link");
  f.commit();
  expect(f.check().stderr).toMatch(/historial:.*:link: enlace simbólico/);
  const head = f.git("rev-parse", "HEAD").toString().trim();
  f.git("update-index", "--add", "--cacheinfo", `160000,${head},nested`);
  expect(f.check().stderr).toContain("índice:nested: enlace simbólico o submódulo");
});

test("checks author emails, commit messages and annotated tag messages without leaking values", () => {
  const f = fixture();
  const email = ["fixture", "mail.fixture.org"].join("@");
  const secret = "ghp_" + "x".repeat(40);
  f.commit(secret, email);
  f.git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "tag.gpgsign=false",
    "tag",
    "-a",
    "fixture",
    "-m",
    secret,
  );
  const result = f.check();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("correo o identificador personal");
  expect(result.stderr.match(/posible secreto/g)).toHaveLength(2);
  expect(result.stderr + result.stdout).not.toContain(secret);
  expect(result.stderr + result.stdout).not.toContain(email);
});

test("catches personal paths and emails while accepting examples and API routes", () => {
  const f = fixture();
  f.write(
    "sample.txt",
    "fixture@example.test fixture@example.com https://api.example/users/me/calendarList",
  );
  f.write("docs/memory.md", "Public memory documentation");
  expect(f.check().status).toBe(0);
  const personal = "/" + ["Users", "fixture", "Documents"].join("/");
  const email = ["fixture", "mail.fixture.org"].join("@");
  f.write("sample.txt", personal + " " + email);
  const result = f.check();
  expect(result.stderr).toContain("ruta de usuario personal");
  expect(result.stderr).toContain("correo o identificador personal");
  expect(result.stderr + result.stdout).not.toContain(personal);
  expect(result.stderr + result.stdout).not.toContain(email);
});

test("requires exact reviewed bytes for public binaries in the working tree and index", () => {
  const f = fixture();
  const asset = Buffer.from([0, 1, 2, 3]);
  f.write("docs/fixture.png", asset);
  expect(f.check().stderr).toContain("binario sin revisión");
  f.write(
    "config/public-assets.json",
    JSON.stringify({
      "docs/fixture.png": {
        sha256: createHash("sha256").update(asset).digest("hex"),
        description: "Synthetic fixture",
      },
    }),
  );
  f.commit();
  expect(f.check().status).toBe(0);
  f.write("docs/fixture.png", Buffer.from([0, 4, 5, 6]));
  expect(f.check().stderr).toContain("recurso modificado");
  f.git("add", "docs/fixture.png");
  f.write("docs/fixture.png", asset);
  expect(f.check().stderr).toContain("índice:docs/fixture.png: recurso modificado");
});

test("private files stay ignored and forced additions are still rejected", () => {
  const f = fixture();
  f.write(".gitignore", readFileSync(".gitignore"));
  const paths = [
    ".local/family.json",
    ".local-backup/notes.txt",
    ".env.production",
    ".codex/session.json",
    "family.json",
    "google-client.json",
    "google-credentials.json",
    "oauth-pending.json",
    "telegram-bot-token",
    "data.sqlite-wal",
    "data.sqlite3-shm",
    "data.db-wal",
    "key.p12",
    "backup.zip",
    "firmware.bin",
    "firmware.nidoota",
    "recording.wav",
    "agents/nido/USER.md",
    "agents/menu/media/photo.png",
  ];
  for (const path of paths) {
    expect(f.git("check-ignore", path).toString().trim()).toBe(path);
    f.write(path, "private fixture");
    f.git("add", "-f", path);
  }
  const result = f.check();
  expect(result.status).toBe(1);
  for (const path of paths) expect(result.stderr).toContain(`índice:${path}: ruta privada`);
});

test("separates local Codex snapshots from publication history without hiding branch secrets", () => {
  const f = fixture();
  const secret = "sk-" + "z".repeat(48);
  const id = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: f.root, input: secret })
    .toString()
    .trim();
  f.git("update-ref", "refs/codex/fixture", id);
  expect(f.check().status).toBe(0);
  const all = spawnSync(process.execPath, ["scripts/release-check.mjs", "--all-refs"], {
    cwd: f.root,
    encoding: "utf8",
  });
  expect(all.status).toBe(1);
  expect(all.stderr).toContain("historial:");
  expect(all.stderr + all.stdout).not.toContain(secret);
  f.write("sample.txt", secret);
  f.commit();
  f.git("rm", "sample.txt");
  f.commit();
  expect(f.check().status).toBe(1);
});

test("keeps reviewed historical asset versions without accepting them as the current asset", () => {
  const f = fixture();
  const old = Buffer.from([0, 1, 2]);
  const current = Buffer.from([0, 3, 4]);
  const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
  f.write("docs/fixture.png", old);
  f.commit();
  f.write("docs/fixture.png", current);
  f.write(
    "config/public-assets.json",
    JSON.stringify({
      "docs/fixture.png": {
        sha256: hash(current),
        previousSha256: [hash(old)],
        description: "Synthetic fixture",
      },
    }),
  );
  f.commit();
  expect(f.check().status).toBe(0);
  f.write("docs/fixture.png", old);
  expect(f.check().stderr).toContain("recurso modificado");
});

test("redacts private values when they occur in a file name", () => {
  const f = fixture();
  const secret = "sk-" + "q".repeat(48);
  const email = ["fixture", "mail.fixture.org"].join("@");
  f.write(secret + ".txt", "fixture");
  f.write(email + ".txt", "fixture");
  const result = f.check();
  expect(result.status).toBe(1);
  expect(result.stderr + result.stdout).not.toContain(secret);
  expect(result.stderr + result.stdout).not.toContain(email);
});
