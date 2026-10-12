import { createHash, randomBytes } from "node:crypto";
import { lstat, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { NidoError } from "./core.js";
import { GoogleCalendar } from "./google.js";
import { configuredOAuthService, oauthOrigin, oauthUiOrigin } from "./google-oauth-config.js";
import {
  applySetup,
  managedAgents,
  pluginConfig,
  privateDirectory,
  setupPlan,
  setupRoot,
  setupVersion,
  writeOnce,
  type SetupRequest,
  type ManagedConfig,
} from "./setup.js";

type Pending = {
  requestId: string;
  verifier: string;
  serviceUrl: string;
  uiOrigin: string;
  expires: number;
  previousCredentials?: string;
  failure?: string;
};
export class GoogleSetup {
  private work: Promise<unknown> = Promise.resolve();
  constructor(
    private root: string,
    private fetcher: typeof fetch = fetch,
    private now = () => Date.now(),
    private current: () => ManagedConfig | undefined = () => undefined,
    private serviceUrl = configuredOAuthService(),
  ) {
    if (this.serviceUrl) this.serviceUrl = oauthOrigin(this.serviceUrl);
  }
  available() {
    return Boolean(this.serviceUrl);
  }
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const next = this.work.then(task, task);
    this.work = next.catch(() => {});
    return next;
  }
  private async credentialVersion() {
    if (!(await this.connected())) return undefined;
    return createHash("sha256")
      .update(await readFile(join(this.root, "google", "google-credentials.json")))
      .digest("hex");
  }
  async connected() {
    try {
      const stat = await lstat(join(this.root, "google", "google-credentials.json"));
      return stat.isFile() && !stat.isSymbolicLink();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  private async pending(): Promise<Pending | undefined> {
    const path = join(this.root, "google", "oauth-pending.json");
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe pending file.");
      const value = JSON.parse(await readFile(path, "utf8")) as Pending;
      if (
        !/^[a-f0-9]{64}$/.test(value.requestId) ||
        !/^[\w-]{43}$/.test(value.verifier) ||
        typeof value.serviceUrl !== "string" ||
        !Number.isFinite(value.expires)
      )
        throw new Error("Invalid pending connection.");
      oauthOrigin(value.serviceUrl);
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  private async forgetPending() {
    await unlink(join(this.root, "google", "oauth-pending.json")).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  private async markFailed(pending: Pending, message: string) {
    const directory = await privateDirectory(this.root, ["google"]);
    const temporary = join(directory, `oauth-${randomBytes(16).toString("hex")}.pending`);
    await writeOnce(temporary, JSON.stringify({ ...pending, failure: message }) + "\n");
    try {
      await rename(temporary, join(directory, "oauth-pending.json"));
    } finally {
      await unlink(temporary).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
  async isPending() {
    return Boolean(await this.pending());
  }
  private async remote(path: string, input: Record<string, unknown>) {
    if (!this.serviceUrl)
      throw new NidoError(
        "AUTH_REQUIRED",
        "La conexión con Google de Nido todavía no está disponible. Puedes empezar con la demo.",
      );
    const response = await this.fetcher(`${oauthOrigin(this.serviceUrl)}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      if ([404, 410].includes(response.status))
        throw new NidoError(
          "AUTH_EXPIRED",
          "La autorización caducó. Vuelve a conectar con Google.",
        );
      throw new NidoError(
        "UNAVAILABLE",
        "No se pudo consultar la conexión de Google. Actualiza su estado.",
      );
    }
    return response.json() as Promise<Record<string, unknown>>;
  }
  async start(raw: Record<string, unknown>) {
    return this.exclusive(async () => {
      if (
        Object.keys(raw).some((key) => !["replace", "origin"].includes(key)) ||
        (raw.replace !== undefined && typeof raw.replace !== "boolean")
      )
        throw new NidoError(
          "INVALID_INPUT",
          "La conexión utiliza la aplicación de Google de Nido.",
        );
      if (!this.serviceUrl)
        throw new NidoError(
          "AUTH_REQUIRED",
          "La conexión con Google de Nido todavía no está disponible. Puedes empezar con la demo.",
        );
      let uiOrigin: string;
      try {
        uiOrigin = oauthUiOrigin(String(raw.origin));
      } catch {
        throw new NidoError(
          "INVALID_INPUT",
          "Abre OpenClaw mediante HTTPS o localhost para conectar con Google.",
        );
      }
      const previousCredentials = await this.credentialVersion();
      if (previousCredentials && raw.replace !== true)
        throw new NidoError(
          "CONFLICT",
          "Ya hay una cuenta conectada. Usa Reconectar Google para sustituirla.",
        );
      let pending = await this.pending();
      if (
        pending &&
        (pending.failure ||
          pending.expires < this.now() ||
          pending.serviceUrl !== this.serviceUrl ||
          pending.uiOrigin !== uiOrigin ||
          pending.previousCredentials !== previousCredentials)
      ) {
        await this.forgetPending();
        pending = undefined;
      }
      if (!pending) {
        pending = {
          requestId: randomBytes(32).toString("hex"),
          verifier: randomBytes(32).toString("base64url"),
          serviceUrl: oauthOrigin(this.serviceUrl),
          uiOrigin,
          expires: this.now() + 10 * 60 * 1000,
          previousCredentials,
        };
        const directory = await privateDirectory(this.root, ["google"]);
        await writeOnce(join(directory, "oauth-pending.json"), JSON.stringify(pending) + "\n");
      }
      // The service deduplicates this exact request. A lost response does not start another consent.
      const result = await this.remote("/v1/connect", {
        requestId: pending.requestId,
        origin: pending.uiOrigin,
        challenge: createHash("sha256").update(pending.verifier).digest("base64url"),
      });
      const expected = `${this.serviceUrl}/oauth/google/start/${pending.requestId}`;
      if (result.url !== expected)
        throw new NidoError(
          "AUTH_REQUIRED",
          "El servicio devolvió una dirección de autorización inesperada.",
        );
      return { url: expected };
    });
  }
  async status() {
    return this.exclusive(async () => {
      const pending = await this.pending();
      if (!pending) return { status: (await this.connected()) ? "connected" : "idle" };
      const path = join(this.root, "google", "google-credentials.json");
      if (await this.connected()) {
        const saved = JSON.parse(await readFile(path, "utf8")) as { operationId?: string };
        if (saved.operationId === pending.requestId) {
          await this.forgetPending();
          return { status: "connected" };
        }
      }
      if (pending.failure) return { status: "failed", message: pending.failure };
      if (pending.expires < this.now() || pending.serviceUrl !== this.serviceUrl) {
        return { status: "expired" };
      }
      let result: Record<string, unknown>;
      try {
        result = await this.remote("/v1/status", {
          requestId: pending.requestId,
          verifier: pending.verifier,
        });
      } catch (error) {
        if (error instanceof NidoError && error.code === "AUTH_EXPIRED") {
          return { status: "expired" };
        }
        throw error;
      }
      if (result.status === "pending") return { status: "pending" };
      if (result.status === "failed") {
        const message = "La autorización no se completó. Puedes volver a conectar con Google.";
        await this.markFailed(pending, message);
        return { status: "failed", message };
      }
      if (
        result.status !== "ready" ||
        typeof result.grant !== "string" ||
        result.grant.length > 16000 ||
        !/^v1\.[A-Za-z0-9_.-]+$/.test(result.grant)
      )
        throw new NidoError("AUTH_REQUIRED", "No se pudo confirmar la autorización de Google.");
      const directory = await privateDirectory(this.root, ["google"]);
      const content =
        JSON.stringify({
          type: "nido-oauth-v1",
          serviceUrl: pending.serviceUrl,
          grant: result.grant,
          operationId: pending.requestId,
        }) + "\n";
      const temporary = join(directory, `oauth-${randomBytes(16).toString("hex")}.pending`);
      await writeOnce(temporary, content);
      try {
        const config = this.current(),
          version = JSON.stringify(config);
        if (config?.mode === "google") {
          const catalog = await new GoogleCalendar(temporary, this.fetcher).calendars();
          for (const id of [
            config.menuCalendarId,
            config.familyCalendarId,
            ...(config.agendaCalendarIds ?? []),
          ]) {
            if (
              !catalog.some(
                (c) => c.id === id && ["reader", "writer", "owner"].includes(c.accessRole),
              )
            )
              throw new NidoError(
                "FORBIDDEN",
                "La cuenta autorizada no puede leer todos los calendarios actuales. Se conserva la conexión anterior.",
              );
          }
        }
        if (
          (await this.credentialVersion()) !== pending.previousCredentials ||
          JSON.stringify(this.current()) !== version
        )
          throw new NidoError(
            "CONFLICT",
            "La conexión o la configuración cambió. Se conserva la conexión actual.",
          );
        if (pending.previousCredentials) await rename(temporary, path);
        else await writeOnce(path, content);
        await this.forgetPending();
      } catch (error) {
        if (error instanceof NidoError && ["FORBIDDEN", "CONFLICT"].includes(error.code)) {
          await this.markFailed(pending, error.message);
          return { status: "failed", message: error.message };
        }
        throw error;
      } finally {
        await unlink(temporary).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
      return { status: "connected" };
    });
  }
  async calendars() {
    if (!(await this.connected()))
      throw new NidoError("AUTH_REQUIRED", "Conecta Google antes de elegir los calendarios.");
    return new GoogleCalendar(
      join(this.root, "google", "google-credentials.json"),
      this.fetcher,
    ).calendars();
  }
}

export function registerSetupAdmin(api: OpenClawPluginApi) {
  // Registration/manifest inspection does not create folders or read credentials.
  let google: GoogleSetup | undefined;
  const connection = () =>
    (google ??= new GoogleSetup(setupRoot(api), fetch, undefined, () =>
      pluginConfig(api.runtime.config.current()),
    ));
  const rpc = (method: string, action: (params: Record<string, unknown>) => Promise<unknown>) =>
    api.registerGatewayMethod(
      method,
      async ({ params, respond }) => {
        try {
          respond(true, await action(params));
        } catch (error) {
          respond(false, undefined, {
            code: "INVALID_REQUEST",
            message:
              error instanceof NidoError
                ? error.message
                : "No se pudo confirmar la operación. Actualiza el estado antes de repetir.",
          });
        }
      },
      { scope: "operator.admin" },
    );
  rpc("nido.setup.status", async () => {
    const host = api.runtime.config.current(),
      config = pluginConfig(host);
    return {
      version: setupVersion(host),
      configured: Boolean(config?.mode),
      managed: Boolean(config?.setup),
      requestId: config?.setup?.requestId,
      mode: config?.mode,
      googleConnected: await connection().connected(),
      googleAuthAvailable: connection().available(),
      googleAuthPending: await connection().isPending(),
      profile: {
        timeZone: config?.timeZone ?? "",
        members: config?.setup?.members ?? [],
        mealTimes: config?.mealTimes ?? { lunch: "13:00", dinner: "19:00", durationMinutes: 60 },
      },
      modelAgents: Object.entries(host.agents?.entries ?? {})
        .filter(([id]) => !managedAgents.includes(id as (typeof managedAgents)[number]))
        .map(([id, entry]) => ({ id, name: entry?.name || id })),
      occupiedAgents: managedAgents.filter((id) => host.agents?.entries?.[id] && !config?.setup),
      // A host deny policy still wins; the wizard never broadens it.
      hostToolPolicy: Boolean(
        host.tools?.allow?.length ||
        host.tools?.deny?.length ||
        host.tools?.subagents?.tools?.deny?.length ||
        (host.tools?.profile && host.tools.profile !== "full"),
      ),
    };
  });
  rpc("nido.setup.preview", async (raw) => {
    const calendars = raw.mode === "google" ? await connection().calendars() : [];
    const plan = setupPlan(api.runtime.config.current(), setupRoot(api), raw, calendars);
    return {
      alreadyApplied: plan.alreadyApplied,
      mode: plan.config.mode,
      agents: managedAgents,
      writesEnabled: plan.config.writesEnabled,
      calendars: [
        plan.config.calendarNames?.[plan.config.menuCalendarId],
        plan.config.calendarNames?.[plan.config.familyCalendarId],
      ],
    };
  });
  rpc("nido.setup.apply", async (raw) => {
    const current = pluginConfig(api.runtime.config.current());
    const replay = current?.setup?.requestId === (raw as SetupRequest).requestId;
    return applySetup(
      api,
      raw,
      raw.mode === "google" && !replay ? await connection().calendars() : [],
    );
  });
  rpc("nido.google.start", async (raw) => connection().start(raw));
  rpc("nido.google.status", async () => connection().status());
  rpc("nido.google.calendars", async () => ({ calendars: await connection().calendars() }));
}
