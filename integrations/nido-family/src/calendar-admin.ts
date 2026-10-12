import { createHash, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, rename, copyFile } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { Value } from "typebox/value";
import { Type } from "typebox";
import {
  calendarAccessFor,
  calendarReference,
  validateCalendarAccess,
  NidoError,
  type FamilyConfig,
  type CalendarAlias,
} from "./core.js";
import { GoogleCalendar } from "./google.js";
import { calendarPanel } from "./calendar-panel.js";
import { calendarSettingsModule } from "./calendar-settings.js";

export const calendarFields = [
  "agendaCalendarIds",
  "calendarAccess",
  "calendarNames",
  "calendarShortNames",
  "writesEnabled",
] as const;
export type AvailableCalendar = {
  id: string;
  summary: string;
  summaryOverride?: string;
  accessRole: string;
};
export function calendarVersion(config: FamilyConfig) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        config.menuCalendarId,
        config.familyCalendarId,
        ...calendarFields.map((key) => config[key]),
      ]),
    )
    .digest("hex");
}
const Permissions = Type.Union([Type.Literal("none"), Type.Literal("read"), Type.Literal("write")]);
const Selection = Type.Object(
  {
    version: Type.String({ minLength: 64, maxLength: 64 }),
    writesEnabled: Type.Boolean(),
    defaults: Type.Object(
      { menu: Type.String(), agenda: Type.String() },
      { additionalProperties: false },
    ),
    calendars: Type.Array(
      Type.Object(
        {
          id: Type.String({ minLength: 1, maxLength: 2048 }),
          enabled: Type.Boolean(),
          shortName: Type.String({ maxLength: 16 }),
          menu: Permissions,
          agenda: Permissions,
        },
        { additionalProperties: false },
      ),
      { maxItems: 5000 },
    ),
  },
  { additionalProperties: false },
);
export function calendarProposal(
  config: FamilyConfig,
  available: AvailableCalendar[],
  raw: unknown,
): FamilyConfig {
  if (!Value.Check(Selection, raw))
    throw new NidoError("INVALID_INPUT", "Selección de calendarios inválida.");
  const selection = raw as {
    version: string;
    writesEnabled: boolean;
    defaults: { menu: string; agenda: string };
    calendars: {
      id: string;
      enabled: boolean;
      shortName: string;
      menu: "none" | "read" | "write";
      agenda: "none" | "read" | "write";
    }[];
  };
  if (selection.version !== calendarVersion(config))
    throw new NidoError(
      "CONFLICT",
      "La configuración cambió. Actualiza la página antes de guardar.",
    );
  const known = new Map(available.map((item) => [item.id, item]));
  const ids = selection.calendars.map((item) => item.id);
  if (new Set(ids).size !== ids.length)
    throw new NidoError("INVALID_INPUT", "Hay calendarios repetidos.");
  const next: FamilyConfig = {
    ...config,
    agendaCalendarIds: [],
    calendarNames: {},
    calendarShortNames: {},
    writesEnabled: selection.writesEnabled,
    calendarAccess: {
      menu: { defaultCalendar: selection.defaults.menu as CalendarAlias, read: [], write: [] },
      agenda: { defaultCalendar: selection.defaults.agenda as CalendarAlias, read: [], write: [] },
    },
  };
  for (const item of selection.calendars) {
    const entry = known.get(item.id);
    if (!entry)
      throw new NidoError(
        "FORBIDDEN",
        "Un calendario seleccionado ya no está disponible en la cuenta.",
      );
    const base = [config.menuCalendarId, config.familyCalendarId].includes(item.id);
    if (base && !item.enabled)
      throw new NidoError(
        "INVALID_INPUT",
        "Los calendarios de menú y familiar deben permanecer conectados.",
      );
    if (!item.enabled) {
      if (item.menu !== "none" || item.agenda !== "none")
        throw new NidoError("INVALID_INPUT", "Un calendario desconectado no puede tener permisos.");
      continue;
    }
    if (!["owner", "writer", "reader"].includes(entry.accessRole))
      throw new NidoError(
        "FORBIDDEN",
        "Google no permite leer los eventos de uno de los calendarios seleccionados.",
      );
    if (!base) next.agendaCalendarIds!.push(item.id);
    next.calendarNames![item.id] = safeCalendarName(entry);
    if (item.shortName.trim()) next.calendarShortNames![item.id] = item.shortName.trim();
    const ref = calendarReference(config, item.id);
    for (const agent of ["menu", "agenda"] as const) {
      if (item[agent] !== "none") next.calendarAccess![agent]!.read.push(ref);
      if (item[agent] === "write") {
        const pending = calendarAccessFor(config, agent).write.includes(ref);
        if (!["owner", "writer"].includes(entry.accessRole) && !pending)
          throw new NidoError(
            "FORBIDDEN",
            "Google solo concede lectura; amplía su permiso antes de habilitar escritura.",
          );
        next.calendarAccess![agent]!.write.push(ref);
      }
    }
  }
  if (!ids.includes(config.menuCalendarId) || !ids.includes(config.familyCalendarId))
    throw new NidoError("INVALID_INPUT", "Faltan los calendarios de menú o familiar.");
  if (next.agendaCalendarIds!.length > 10)
    throw new NidoError("INVALID_INPUT", "Puedes conectar hasta diez calendarios adicionales.");
  validateCalendarAccess(next);
  return next;
}
export function safeCalendarName(item: AvailableCalendar) {
  const name = item.summaryOverride ?? item.summary;
  return /^https?:\/\//i.test(name) ? "Calendario externo" : name.slice(0, 200);
}
export function adminBearerMatches(req: IncomingMessage, token: unknown) {
  if (typeof token !== "string" || !token) return false;
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7)),
    expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}
async function body(req: IncomingMessage) {
  let input = "";
  for await (const chunk of req) {
    input += chunk;
    if (Buffer.byteLength(input) > 1024 * 1024)
      throw new NidoError("INVALID_INPUT", "Petición demasiado grande.");
  }
  try {
    return JSON.parse(input);
  } catch {
    throw new NidoError("INVALID_INPUT", "Petición inválida.");
  }
}
export function registerCalendarAdmin(api: OpenClawPluginApi) {
  const current = () =>
    api.runtime.config.current().plugins?.entries?.["nido-family"]
      ?.config as unknown as FamilyConfig;
  const available = async (config: FamilyConfig): Promise<AvailableCalendar[]> =>
    config.mode === "google"
      ? new GoogleCalendar(join(config.dataDir, "google-credentials.json")).calendars()
      : [
          ...new Set([
            config.menuCalendarId,
            config.familyCalendarId,
            ...(config.agendaCalendarIds ?? []),
          ]),
        ].map((id) => ({
          id,
          summary:
            config.calendarNames?.[id] ??
            (id === config.menuCalendarId
              ? "Menú"
              : id === config.familyCalendarId
                ? "Familia"
                : id),
          accessRole: "owner",
        }));
  const catalog = async () => {
    const config = current();
    const entries = await available(config);
    return {
      version: calendarVersion(config),
      mode: config.mode,
      writesEnabled: config.writesEnabled,
      menuId: config.menuCalendarId,
      familyId: config.familyCalendarId,
      access: {
        menu: calendarAccessFor(config, "menu"),
        agenda: calendarAccessFor(config, "agenda"),
      },
      calendars: entries.map((item) => ({
        ...item,
        summary: safeCalendarName(item),
        summaryOverride: undefined,
        reference: calendarReference(config, item.id),
        enabled: [
          config.menuCalendarId,
          config.familyCalendarId,
          ...(config.agendaCalendarIds ?? []),
        ].includes(item.id),
        shortName: config.calendarShortNames?.[item.id] ?? "",
      })),
    };
  };
  const saveSelection = async (raw: unknown) => {
    const config = current();
    const next = calendarProposal(config, await available(config), raw);
    const writeOptions: { unsetPaths: string[][] } = { unsetPaths: [] };
    await api.runtime.config.mutateConfigFile({
      writeOptions,
      afterWrite: { mode: "auto" },
      mutate: (draft, context) => {
        // Preserve authored agent preferences rather than persisting SDK compatibility migrations.
        const authored =
          context.snapshot.sourceConfigBeforeMigrations ?? context.snapshot.sourceConfig;
        if (authored?.agents) draft.agents = structuredClone(authored.agents);
        if (!authored?.agents?.defaults?.modelPolicy) {
          writeOptions.unsetPaths.push(["agents", "defaults", "modelPolicy"]);
          if (!authored?.meta?.migrations?.modelPolicyAllowlist)
            writeOptions.unsetPaths.push(["meta", "migrations", "modelPolicyAllowlist"]);
        }
        const target = draft.plugins?.entries?.["nido-family"]?.config as unknown as FamilyConfig;
        if (calendarVersion(target) !== calendarVersion(config))
          throw new NidoError("CONFLICT", "La configuración cambió. Actualiza la página.");
        for (const key of calendarFields) (target as any)[key] = next[key];
      },
    });
    let warning = "";
    if (config.familyConfigFile) {
      try {
        const original = await readFile(config.familyConfigFile, "utf8"),
          family = JSON.parse(original);
        for (const key of calendarFields) family[key] = next[key];
        const stamp = Date.now();
        await copyFile(
          config.familyConfigFile,
          `${config.familyConfigFile}.before-calendar-ui-${stamp}`,
        );
        const temporary = `${config.familyConfigFile}.calendar-ui-${stamp}`;
        await writeFile(temporary, JSON.stringify(family, null, 2) + "\n", { mode: 0o600 });
        if ((await readFile(config.familyConfigFile, "utf8")) !== original)
          throw new Error("Family config changed during synchronization.");
        await rename(temporary, config.familyConfigFile);
      } catch {
        warning =
          "El plugin se guardó, pero no se pudo sincronizar family.json. Revisa la instalación antes de volver a prepararla.";
      }
    }
    return {
      version: calendarVersion(next),
      message: "Permisos guardados en Nido.",
      warning,
    };
  };
  api.registerGatewayMethod(
    "nido.calendars.catalog",
    async ({ respond }) => {
      try {
        respond(true, await catalog());
      } catch {
        respond(false, undefined, {
          code: "UNAVAILABLE",
          message: "No se pudo consultar la cuenta. Actualiza la lista.",
        });
      }
    },
    { scope: "operator.read" },
  );
  api.registerGatewayMethod(
    "nido.calendars.configure",
    async ({ params, respond }) => {
      try {
        respond(true, await saveSelection(params));
      } catch (error) {
        respond(false, undefined, {
          code: "INVALID_REQUEST",
          message:
            error instanceof NidoError
              ? error.message
              : "No se pudo confirmar el guardado. Actualiza la lista antes de repetir.",
        });
      }
    },
    { scope: "operator.admin" },
  );
  api.registerHttpRoute({
    path: "/plugins/nido-family/settings.js",
    auth: "plugin",
    handler: (_req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(calendarSettingsModule());
      return true;
    },
  });
  api.registerHttpRoute({
    path: "/plugins/nido-family/calendars",
    auth: "gateway",
    handler: async (req, res) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405);
        res.end();
        return true;
      }
      try {
        const data = await catalog();
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "Content-Security-Policy":
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' http://localhost:* http://127.0.0.1:* https:; base-uri 'none'; form-action 'none'",
        });
        res.end(req.method === "HEAD" ? "" : calendarPanel(data));
      } catch (error) {
        res.writeHead(503, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(
          calendarPanel({
            error:
              error instanceof NidoError
                ? error.message
                : "No se pudo consultar Google. Actualiza la página para volver a comprobarlo.",
          }),
        );
      }
      return true;
    },
  });
  // The dashboard iframe grant is read-only. Saving requires the operator's explicit bearer credential.
  // No cookie, query parameter or model tool grants configuration authority.
  api.registerHttpRoute({
    path: "/plugins/nido-family/calendar-admin",
    auth: "plugin",
    handler: async (req, res) => {
      const origin = req.headers.origin;
      const sameOrigin =
        origin ===
        `${"encrypted" in req.socket && req.socket.encrypted ? "https" : "http"}://${req.headers.host}`;
      if (origin && origin !== "null" && !sameOrigin) {
        send(res, 403, { error: "Origen no permitido." });
        return true;
      }
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "600",
        });
        res.end();
        return true;
      }
      if (req.method !== "POST") {
        send(res, 405, { error: "Método no permitido." });
        return true;
      }
      const auth = api.runtime.config.current().gateway?.auth;
      const credential =
        auth?.mode === "password" ? auth.password : auth?.mode === "token" ? auth.token : undefined;
      if (!adminBearerMatches(req, credential)) {
        send(res, 401, {
          error: "Introduce la credencial administrativa del Gateway para guardar.",
        });
        return true;
      }
      try {
        const raw = await body(req);
        send(res, 200, await saveSelection(raw));
      } catch (error) {
        send(res, error instanceof NidoError && error.code === "CONFLICT" ? 409 : 400, {
          error:
            error instanceof NidoError
              ? error.message
              : "No se pudo confirmar el guardado. Actualiza la página para comprobar la configuración antes de repetir.",
        });
      }
      return true;
    },
  });
}
