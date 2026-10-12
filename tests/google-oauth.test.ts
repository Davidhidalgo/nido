import { afterEach, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createOAuthService } from "../scripts/nido-oauth-service.mjs";
import { GoogleSetup } from "../integrations/nido-family/src/setup-admin.js";
import { GoogleCalendar } from "../integrations/nido-family/src/google.js";
import { oauthOrigin } from "../integrations/nido-family/src/google-oauth-config.js";

const origin = "https://auth.example.test";
const uiOrigin = "https://openclaw.example.test";
const scopes =
  "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly";
const hash = (value: string) => createHash("sha256").update(value).digest("base64url");
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "nido-oauth-test-")));
  let now = Date.now();
  let calendars = ["meals", "family"];
  const google = vi.fn<typeof fetch>(async (url, options) => {
    if (url === "https://oauth2.googleapis.com/token") {
      const body = options!.body as URLSearchParams;
      expect(body.get("client_secret")).toBe("fixture-web-secret");
      if (body.get("grant_type") === "authorization_code")
        return Response.json({ refresh_token: "fixture-google-refresh", scope: scopes });
      expect(body.get("refresh_token")).toBe("fixture-google-refresh");
      return Response.json({ access_token: "fixture-access", expires_in: 3600 });
    }
    if (String(url).startsWith("https://www.googleapis.com/calendar/v3/")) {
      expect(options!.headers).toEqual({ Authorization: "Bearer fixture-access" });
      return Response.json({
        items: calendars.map((id) => ({ id, summary: id, accessRole: "writer" })),
      });
    }
    throw new Error("Unexpected destination.");
  });
  const options = {
    publicUrl: origin,
    clientId: "fixture-web-client.apps.googleusercontent.com",
    clientSecret: "fixture-web-secret",
    encryptionKey: randomBytes(32).toString("base64url"),
    dataDir: join(base, "service"),
    fetcher: google,
    now: () => now,
  };
  let service = createOAuthService(options);
  cleanups.push(async () => {
    service.close();
    await rm(base, { recursive: true, force: true });
  });
  async function request(path: string, input?: unknown, headers: Record<string, string> = {}) {
    const req = Readable.from(
      input === undefined ? [] : [typeof input === "string" ? input : JSON.stringify(input)],
    ) as Readable & {
      method: string;
      url: string;
      headers: Record<string, string>;
    };
    req.method = input === undefined ? "GET" : "POST";
    req.url = path;
    req.headers = {
      ...(input === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    };
    let status = 200,
      body = "";
    const out: Record<string, string> = {};
    const res = {
      setHeader(name: string, value: string) {
        out[name.toLowerCase()] = value;
      },
      writeHead(code: number, values: Record<string, string> = {}) {
        status = code;
        for (const [k, v] of Object.entries(values)) this.setHeader(k, v);
        return this;
      },
      end(value = "") {
        body = value;
      },
    };
    await service.handler(req, res);
    return new Response(body, { status, headers: out });
  }
  const network = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).startsWith(origin + "/"))
      return request(
        new URL(String(url)).pathname,
        JSON.parse(String(init?.body)),
        Object.fromEntries(new Headers(init?.headers)),
      );
    return google(url, init);
  });
  const root = join(base, "nido-family");
  const setup = () => new GoogleSetup(root, network, () => now, undefined, origin);
  async function browser(url: string) {
    const response = await request(new URL(url).pathname, "", {
      origin: uiOrigin,
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(response.status).toBe(303);
    const auth = new URL(response.headers.get("location")!);
    expect(auth.origin).toBe("https://accounts.google.com");
    expect(auth.searchParams.get("redirect_uri")).toBe(origin + "/oauth/google/callback");
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly; Secure; SameSite=Lax");
    const callback = `/oauth/google/callback?${new URLSearchParams({ state: auth.searchParams.get("state")!, code: "fixture-code" })}`;
    return { auth, callback, cookie: cookie.split(";")[0] };
  }
  return {
    base,
    root,
    google,
    network,
    request,
    browser,
    setup,
    advance(ms: number) {
      now += ms;
    },
    setCalendars(value: string[]) {
      calendars = value;
    },
    restart() {
      service.close();
      service = createOAuthService(options);
    },
  };
}

it("connects a remote installation through the shared app, resumes after restart and keeps Calendar calls local", async () => {
  const f = await fixture(),
    setup = f.setup();
  const first = await setup.start({ origin: uiOrigin });
  expect(await setup.start({ origin: uiOrigin })).toEqual(first);
  const browser = await f.browser(first.url);
  expect((await setup.status()).status).toBe("pending");
  expect((await f.request(browser.callback)).status).toBe(400);
  expect(f.google).not.toHaveBeenCalled();
  const callback = await f.request(browser.callback, undefined, { cookie: browser.cookie });
  expect(callback.status).toBe(200);
  expect(await callback.text()).not.toMatch(/fixture-google-refresh|fixture-web-secret/);
  const exchange = f.google.mock.calls[0][1]!.body as URLSearchParams;
  expect(hash(exchange.get("code_verifier")!)).toBe(
    browser.auth.searchParams.get("code_challenge"),
  );
  f.restart();
  const restarted = f.setup();
  const network = f.network.getMockImplementation()!;
  f.network.mockImplementationOnce(async (url, init) => {
    await network(url, init);
    throw new Error("lost result response");
  });
  await expect(restarted.status()).rejects.toThrow("lost result response");
  expect(await restarted.status()).toEqual({ status: "connected" });
  expect(await restarted.status()).toEqual({ status: "connected" });
  const path = join(f.root, "google/google-credentials.json"),
    saved = await readFile(path, "utf8");
  expect(JSON.parse(saved)).toMatchObject({ type: "nido-oauth-v1", serviceUrl: origin });
  expect(saved).not.toMatch(
    /fixture-google-refresh|fixture-web-secret|refresh_token|client_secret/,
  );
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(
    (await readFile(join(f.base, "service/oauth.sqlite"))).includes(
      Buffer.from("fixture-google-refresh"),
    ),
  ).toBe(false);
  expect((await stat(join(f.base, "service/oauth.sqlite"))).mode & 0o777).toBe(0o600);
  const calendar = new GoogleCalendar(path, f.network);
  expect(await calendar.calendars()).toHaveLength(2);
  await calendar.calendars(); // Cached access token: only one refresh.
  expect(f.network.mock.calls.filter(([url]) => String(url).endsWith("/v1/token"))).toHaveLength(1);
  expect(
    f.google.mock.calls.filter(
      ([, init]) => (init?.body as URLSearchParams)?.get?.("grant_type") === "authorization_code",
    ),
  ).toHaveLength(1);
  expect((await f.request(browser.callback, undefined, { cookie: browser.cookie })).status).toBe(
    200,
  );
  expect(
    f.google.mock.calls.filter(
      ([, init]) => (init?.body as URLSearchParams)?.get?.("grant_type") === "authorization_code",
    ),
  ).toHaveLength(1);
});

it("claims a callback before external I/O so simultaneous callbacks exchange the code only once", async () => {
  const f = await fixture(),
    setup = f.setup();
  const browser = await f.browser((await setup.start({ origin: uiOrigin })).url);
  let release!: (response: Response) => void;
  f.google.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  const first = f.request(browser.callback, undefined, { cookie: browser.cookie });
  await vi.waitFor(() => expect(f.google).toHaveBeenCalledTimes(1));
  expect((await f.request(browser.callback, undefined, { cookie: browser.cookie })).status).toBe(
    400,
  );
  expect(await setup.status()).toEqual({ status: "pending" });
  release(Response.json({ refresh_token: "fixture-google-refresh", scope: scopes }));
  expect((await first).status).toBe(200);
  expect(await setup.status()).toEqual({ status: "connected" });
  expect(f.google).toHaveBeenCalledTimes(1);
});

it("binds results to the installation proof, rejects browser API calls and never redirects to a caller URL", async () => {
  const f = await fixture(),
    requestId = randomBytes(32).toString("hex"),
    verifier = randomBytes(32).toString("base64url");
  expect(
    (
      await f.request(
        "/v1/connect",
        { requestId, challenge: hash(verifier), origin: uiOrigin },
        { origin: "https://attacker.example" },
      )
    ).status,
  ).toBe(400);
  const response = await f.request("/v1/connect", {
    requestId,
    challenge: hash(verifier),
    returnUrl: "https://attacker.example",
    origin: uiOrigin,
  });
  const { url } = await response.json();
  const browser = await f.browser(url);
  expect(browser.auth.searchParams.get("redirect_uri")).toBe(origin + "/oauth/google/callback");
  expect(
    (await f.request("/v1/connect", { requestId, challenge: hash("wrong"), origin: uiOrigin }))
      .status,
  ).toBe(409);
  expect(
    (await f.request("/v1/status", { requestId, verifier: randomBytes(32).toString("base64url") }))
      .status,
  ).toBe(404);
  expect((await f.request("/v1/status", { requestId, verifier })).status).toBe(200);
  expect((await f.request(new URL(url).pathname)).status).toBe(404);
  expect(
    (
      await f.request(new URL(url).pathname, "", {
        origin: "https://attacker.example",
        "content-type": "application/x-www-form-urlencoded",
      })
    ).status,
  ).toBe(400); // Another browser cannot take over.
  expect(
    (await f.request("/v1/token", {}, { authorization: "Bearer v1.invalid.grant.tag" })).status,
  ).toBe(401);
  expect(f.google).not.toHaveBeenCalled();
  for (const invalid of [
    "http://auth.example.test",
    "https://auth.example.test/path",
    "https://user@auth.example.test",
    "https://auth.example.test?next=bad",
  ])
    expect(() => oauthOrigin(invalid)).toThrow();
});

it.each(["denied", "missing_scope", "uncertain"])(
  "preserves failure after %s without replaying the Google code",
  async (kind) => {
    const f = await fixture(),
      setup = f.setup();
    const browser = await f.browser((await setup.start({ origin: uiOrigin })).url);
    if (kind === "missing_scope")
      f.google.mockResolvedValueOnce(
        Response.json({ refresh_token: "fixture-google-refresh", scope: "openid" }),
      );
    if (kind === "uncertain") f.google.mockRejectedValueOnce(new Error("lost token response"));
    const url = kind === "denied" ? browser.callback + "&error=access_denied" : browser.callback;
    expect((await f.request(url, undefined, { cookie: browser.cookie })).status).toBe(400);
    f.restart();
    expect((await f.request(url, undefined, { cookie: browser.cookie })).status).toBe(400);
    expect(f.google).toHaveBeenCalledTimes(kind === "denied" ? 0 : 1);
    expect(await setup.status()).toMatchObject({ status: "failed" });
    expect(await setup.connected()).toBe(false);
  },
);

it("expires pending authorization and reconciles a lost service response without new consent", async () => {
  const f = await fixture(),
    setup = f.setup();
  const original = f.network.getMockImplementation()!;
  f.network.mockImplementationOnce(async (url, init) => {
    await original(url, init);
    throw new Error("lost response");
  });
  await expect(setup.start({ origin: uiOrigin })).rejects.toThrow("lost response");
  const pending = JSON.parse(await readFile(join(f.root, "google/oauth-pending.json"), "utf8"));
  const result = await f.setup().start({ origin: uiOrigin });
  expect(result.url).toContain(pending.requestId);
  const browser = await f.browser(result.url);
  f.advance(601000);
  expect((await f.request(browser.callback, undefined, { cookie: browser.cookie })).status).toBe(
    400,
  );
  expect(await setup.status()).toEqual({ status: "expired" });
  expect(f.google).not.toHaveBeenCalled();
});

it("preserves existing credentials when a new account lacks calendars or the configuration changes", async () => {
  const f = await fixture(),
    setup = f.setup();
  async function connect(target: GoogleSetup, replace = false) {
    const browser = await f.browser((await target.start({ replace, origin: uiOrigin })).url);
    expect((await f.request(browser.callback, undefined, { cookie: browser.cookie })).status).toBe(
      200,
    );
  }
  await connect(setup);
  await setup.status();
  const path = join(f.root, "google/google-credentials.json"),
    saved = await readFile(path, "utf8");
  const config = { mode: "google", menuCalendarId: "meals", familyCalendarId: "family" };
  const reconnect = new GoogleSetup(f.root, f.network, undefined, () => config as never, origin);
  await expect(reconnect.start({ origin: uiOrigin })).rejects.toThrow(/Ya hay/);
  await connect(reconnect, true);
  f.setCalendars(["meals"]);
  expect(await reconnect.status()).toMatchObject({
    status: "failed",
    message: expect.stringMatching(/conserva la conexión anterior/),
  });
  expect(await reconnect.status()).toMatchObject({ status: "failed" });
  expect(await readFile(path, "utf8")).toBe(saved);
  f.setCalendars(["meals", "family"]);
  await connect(reconnect, true);
  await writeFile(path, JSON.stringify({ ...JSON.parse(saved), changed: true }));
  expect(await reconnect.status()).toMatchObject({
    status: "failed",
    message: expect.stringMatching(/conserva la conexión actual/),
  });
  expect(JSON.parse(await readFile(path, "utf8"))).toHaveProperty("changed", true);
  await connect(reconnect, true);
  expect(await reconnect.status()).toEqual({ status: "connected" });
  expect(await readFile(path, "utf8")).not.toBe(saved);
});
