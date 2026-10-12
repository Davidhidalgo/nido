import { afterEach, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  githubConfig,
  githubBytes,
  newerFirmware,
  Note4GitHub,
} from "../integrations/nido-family/src/note4-github.js";
import { Note4Maintenance, OTA_LIMIT } from "../integrations/nido-family/src/note4-maintenance.js";
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const managers: Note4Maintenance[] = [];
afterEach(() => {
  for (const m of managers.splice(0)) {
    m.close();
    rmSync(m.directory, { recursive: true, force: true });
  }
});
function manager() {
  const m = new Note4Maintenance(mkdtempSync(join(tmpdir(), "nido-github-test-")), publicKey);
  managers.push(m);
  return m;
}
function fixture(version = "nido-ota-0.5.0") {
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
  const signature = sign("sha256", Buffer.from(manifest), keys.privateKey).toString("hex");
  const head = Buffer.alloc(16);
  head.write("NIDOOTA1");
  head.writeUInt32LE(Buffer.byteLength(manifest), 8);
  head.writeUInt32LE(512, 12);
  const bytes = Buffer.concat([head, Buffer.from(manifest), Buffer.from(signature), binary]);
  const release = {
    id: 42,
    tag_name: version,
    draft: false,
    prerelease: false,
    assets: [
      {
        id: 73,
        name: version + ".nidoota",
        state: "uploaded",
        size: bytes.length,
        updated_at: "2026-10-12T10:00:00Z",
        browser_download_url: "http://127.0.0.1/never-follow",
      },
    ],
  };
  return { bytes, release };
}
function mock(release: unknown, bytes: Buffer) {
  return vi.fn(
    async (input: any) =>
      new Response(
        String(input).endsWith("/assets/73") ? new Uint8Array(bytes) : JSON.stringify(release),
      ),
  ) as unknown as typeof fetch;
}
it("is disabled until configured and rejects arbitrary hosts and paths", () => {
  expect(githubConfig(undefined)).toBeUndefined();
  expect(githubConfig({ repository: "example/nido" })).toEqual({ repository: "example/nido" });
  for (const repository of ["https://github.com/a/b", "a/b/../../x", "a/..", "a/b?x", "a/b#x"])
    expect(() => githubConfig({ repository })).toThrow();
  expect(() => githubConfig({ repository: "example/nido", tokenEnv: "bad-name" })).toThrow();
});
it("compares numeric stable versions, tolerates legacy two components and avoids guessing", () => {
  expect(newerFirmware("nido-ota-0.10.0", "nido-ota-0.9.0")).toBe(true);
  expect(newerFirmware("nido-ota-0.3.0", "nido-ota-0.3")).toBe(false);
  expect(newerFirmware("nido-ota-0.4.0", "nido-ota-0.5.0")).toBe(false);
  expect(newerFirmware("nido-ota-0.5.0", "old-build")).toBeNull();
  expect(newerFirmware("nido-ota-0.5.0-beta", "nido-ota-0.4.0")).toBeNull();
});
it("imports a signed asset idempotently without queuing installation or using supplied URLs", async () => {
  const { bytes, release } = fixture(),
    fetcher = mock(release, bytes),
    m = manager();
  const client = new Note4GitHub({ repository: "example/nido" }, fetcher);
  const selected = await client.latest("nido-ota-0.4.0");
  expect(selected.newer).toBe(true);
  expect((await client.download(m, selected)).version).toBe(release.tag_name);
  await client.download(m, selected);
  expect(m.status().releases).toHaveLength(1);
  expect(m.status().updates).toHaveLength(0);
  expect(
    vi
      .mocked(fetcher)
      .mock.calls.every(([url]) =>
        String(url).startsWith("https://api.github.com/repos/example/nido/releases/"),
      ),
  ).toBe(true);
});
it("rejects draft, prerelease, missing or ambiguous assets", async () => {
  const { bytes, release } = fixture();
  for (const raw of [
    { ...release, draft: true },
    { ...release, prerelease: true },
    { ...release, assets: [] },
    { ...release, assets: [...release.assets, ...release.assets] },
    { ...release, tag_name: "plugin-v1.0" },
  ])
    await expect(
      new Note4GitHub({ repository: "example/nido" }, mock(raw, bytes)).latest(""),
    ).rejects.toThrow();
});
it("pins repository and selected asset and refuses a replaced release", async () => {
  const { bytes, release } = fixture(),
    client = new Note4GitHub({ repository: "example/nido" }, mock(release, bytes));
  const selected = await client.latest("");
  const m = manager();
  await expect(client.download(m, { ...selected, repository: "other/nido" })).rejects.toThrow();
  release.assets[0].id++;
  await expect(client.download(m, selected)).rejects.toThrow(/cambiado/);
  expect(m.status().releases).toHaveLength(0);
});
it("rejects truncation, tampering, wrong signatures and a tag differing from the signed version", async () => {
  for (const kind of ["short", "binary", "signature", "tag"]) {
    const { bytes, release } = fixture();
    let body = Buffer.from(bytes);
    if (kind === "short") body = body.subarray(0, body.length - 1);
    if (kind === "binary") body[body.length - 1] ^= 1;
    if (kind === "signature")
      body[16 + body.readUInt32LE(8)] = body[16 + body.readUInt32LE(8)] === 48 ? 49 : 48;
    if (kind === "tag") release.tag_name = "nido-ota-0.6.0";
    const client = new Note4GitHub({ repository: "example/nido" }, mock(release, body)),
      m = manager();
    await expect(client.download(m, await client.latest(""))).rejects.toThrow();
    expect(m.status().releases).toHaveLength(0);
  }
});
it("limits streamed bodies even without Content-Length and rejects oversized metadata", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(9));
            c.enqueue(new Uint8Array(9));
            c.close();
          },
        }),
      ),
  ) as unknown as typeof fetch;
  await expect(
    githubBytes("https://api.github.com/test", 10, undefined, false, fetcher),
  ).rejects.toThrow(/tamaño/);
  const f = fixture();
  f.release.assets[0].size = OTA_LIMIT + 2000;
  await expect(
    new Note4GitHub({ repository: "example/nido" }, mock(f.release, f.bytes)).latest(""),
  ).rejects.toThrow();
});
it("handles API redirects without leaking a private repo token to asset storage", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: {
          location: "https://release-assets.githubusercontent.com/asset?temporary=fixture",
        },
      }),
    )
    .mockResolvedValueOnce(new Response("firmware"));
  expect(
    (
      await githubBytes(
        "https://api.github.com/repos/example/nido/releases/assets/73",
        100,
        "fixture-token",
        true,
        fetcher,
      )
    ).toString(),
  ).toBe("firmware");
  expect((fetcher.mock.calls[0][1].headers as any).Authorization).toBe("Bearer fixture-token");
  expect((fetcher.mock.calls[1][1].headers as any).Authorization).toBeUndefined();
});
it("rejects untrusted redirects, bounded redirect loops, rate limits and missing tokens", async () => {
  for (const location of [
    "http://release-assets.githubusercontent.com/x",
    "https://evil.example/x",
    "https://api.github.com:444/x",
    "https://" + ["user:pass", "api.github.com"].join("@") + "/x",
  ]) {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location } }));
    await expect(
      githubBytes("https://api.github.com/test", 100, "secret", true, fetcher),
    ).rejects.toThrow(/destino/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
  const loop = vi.fn(
    async () =>
      new Response(null, { status: 302, headers: { location: "https://api.github.com/test" } }),
  );
  await expect(
    githubBytes("https://api.github.com/test", 100, undefined, false, loop),
  ).rejects.toThrow(/redirecciones/);
  expect(loop).toHaveBeenCalledTimes(4);
  await expect(
    githubBytes(
      "https://api.github.com/test",
      100,
      undefined,
      false,
      async () => new Response(null, { status: 429 }),
    ),
  ).rejects.toThrow(/limitado/);
  const f = fixture();
  const fetcher = mock(f.release, f.bytes);
  await expect(
    new Note4GitHub(
      { repository: "example/nido", tokenEnv: "NIDO_RELEASE_TOKEN" },
      fetcher,
      {},
    ).latest(""),
  ).rejects.toThrow(/token/);
  expect(fetcher).not.toHaveBeenCalled();
});
