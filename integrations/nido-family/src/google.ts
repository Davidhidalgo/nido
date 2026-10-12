import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { oauthOrigin } from "./google-oauth-config.js";
import {
  type CalendarPort,
  type CalendarEvent,
  type EventInput,
  type EventPatch,
  fail,
  NidoError,
} from "./core.js";

type Credentials =
  | { client_id: string; client_secret?: string; refresh_token: string; type?: never }
  | { type: "nido-oauth-v1"; serviceUrl: string; grant: string };
export class GoogleCalendar implements CalendarPort {
  private token?: { value: string; expires: number; credentialVersion: string };
  constructor(
    private credentialsFile: string,
    private fetcher: typeof fetch = fetch,
    private menuCalendarId?: string,
  ) {}
  private async accessToken() {
    const source = await readFile(this.credentialsFile, "utf8");
    const version = createHash("sha256").update(source).digest("hex");
    if (version !== this.token?.credentialVersion) this.token = undefined;
    if (this.token && this.token.expires > Date.now() + 60000) return this.token.value;
    const credentials = JSON.parse(source) as Credentials;
    let response: Response;
    if (credentials.type === "nido-oauth-v1") {
      if (typeof credentials.grant !== "string" || !credentials.grant.startsWith("v1."))
        fail("AUTH_REQUIRED", "Falta completar la conexión de Google.");
      response = await this.fetcher(`${oauthOrigin(credentials.serviceUrl)}/v1/token`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credentials.grant}`,
        },
        body: "{}",
      });
    } else {
      if (!credentials.client_id || !credentials.refresh_token)
        fail("AUTH_REQUIRED", "Falta completar la conexión de Google.");
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: credentials.client_id,
        refresh_token: credentials.refresh_token,
      });
      if (credentials.client_secret) body.set("client_secret", credentials.client_secret);
      response = await this.fetcher("https://oauth2.googleapis.com/token", {
        method: "POST",
        body,
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
    }
    if (!response.ok)
      fail("AUTH_REQUIRED", "No se pudo renovar el acceso a Google; revisa la conexión.");
    const result = (await response.json()) as { access_token?: string; expires_in?: number };
    const value = result.access_token;
    if (!value) return fail("AUTH_REQUIRED", "Google no devolvió un token.");
    this.token = {
      value,
      credentialVersion: version,
      expires: Date.now() + (result.expires_in ?? 3600) * 1000,
    };
    return value;
  }
  async calendars(): Promise<
    { id: string; summary: string; summaryOverride?: string; accessRole: string }[]
  > {
    const token = await this.accessToken();
    const items: { id: string; summary: string; summaryOverride?: string; accessRole: string }[] =
      [];
    let pageToken: string | undefined;
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({ maxResults: "250", showHidden: "true" });
      if (pageToken) query.set("pageToken", pageToken);
      const response = await this.fetcher(
        `https://www.googleapis.com/calendar/v3/users/me/calendarList?${query}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(20000),
          redirect: "error",
        },
      );
      if (!response.ok)
        fail(
          "GOOGLE_ERROR",
          `No se pudieron consultar los permisos de calendarios (HTTP ${response.status}).`,
        );
      const data = (await response.json()) as { items?: typeof items; nextPageToken?: string };
      items.push(...(data.items ?? []));
      pageToken = data.nextPageToken;
      if (!pageToken) return items;
    }
    return fail("TOO_MANY_CALENDARS", "Demasiados calendarios para verificar los permisos.");
  }
  private async request(
    calendar: string,
    suffix: string,
    method = "GET",
    body?: unknown,
    etag?: string,
  ) {
    const token = await this.accessToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (body) headers["Content-Type"] = "application/json";
    if (etag) headers["If-Match"] = etag;
    let response: Response;
    try {
      response = await this.fetcher(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar)}/events${suffix}`,
        {
          method,
          headers,
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(20000),
          redirect: "error",
        },
      );
    } catch {
      return fail(
        method === "GET" ? "UNAVAILABLE" : "UNCERTAIN",
        "Google no respondió. Releer antes de repetir cualquier escritura.",
      );
    }
    if (response.status === 401) {
      this.token = undefined;
      fail("AUTH_REQUIRED", "El acceso a Google ha caducado.");
    }
    if (response.status === 403) fail("FORBIDDEN", "Google rechazó el acceso al calendario.");
    if (response.status === 404 || response.status === 410)
      fail("NOT_FOUND", "El evento o calendario no existe.");
    if (response.status === 409 || response.status === 412)
      fail("CONFLICT", "El evento existe o cambió; vuelve a consultarlo.");
    if (response.status === 429)
      fail("RATE_LIMIT", "Google ha limitado temporalmente las peticiones.");
    if (!response.ok)
      fail(
        response.status >= 500 && method !== "GET" ? "UNCERTAIN" : "GOOGLE_ERROR",
        `Calendar respondió HTTP ${response.status}.`,
      );
    return response.status === 204 ? undefined : response.json();
  }
  async list(calendar: string, from: string, to: string) {
    const events: CalendarEvent[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({
        timeMin: from,
        timeMax: to,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
      });
      if (pageToken) query.set("pageToken", pageToken);
      const data = (await this.request(calendar, `?${query}`)) as {
        items?: CalendarEvent[];
        nextPageToken?: string;
      };
      events.push(...(data.items ?? []));
      pageToken = data.nextPageToken;
      if (!pageToken) return events;
    }
    return fail("TOO_MANY_EVENTS", "Demasiados eventos. Consulta un intervalo menor.");
  }
  async get(calendar: string, id: string) {
    return (await this.request(calendar, `/${encodeURIComponent(id)}`)) as CalendarEvent;
  }
  async create(calendar: string, event: EventInput & { id: string }) {
    const body = {
      ...event,
      ...(calendar === this.menuCalendarId
        ? { transparency: "transparent", reminders: { useDefault: false } }
        : {}),
    };
    try {
      return (await this.request(calendar, "", "POST", body)) as CalendarEvent;
    } catch (error) {
      if (error instanceof NidoError && ["UNCERTAIN", "CONFLICT"].includes(error.code)) {
        // The caller supplies a stable id. A lost POST response can be reconciled without another write.
        try {
          const existing = await this.get(calendar, event.id);
          if (
            existing.status !== "cancelled" &&
            existing.summary === event.summary &&
            JSON.stringify(existing.start) === JSON.stringify(event.start) &&
            JSON.stringify(existing.end) === JSON.stringify(event.end) &&
            (existing.description ?? "") === (event.description ?? "") &&
            (existing.location ?? "") === (event.location ?? "")
          )
            return existing;
        } catch {
          /* Preserve the original result; never retry the POST here. */
        }
      }
      throw error;
    }
  }
  async update(calendar: string, id: string, etag: string, patch: EventPatch) {
    return (await this.request(
      calendar,
      `/${encodeURIComponent(id)}`,
      "PATCH",
      patch,
      etag,
    )) as CalendarEvent;
  }
  async delete(calendar: string, id: string, etag: string) {
    await this.request(calendar, `/${encodeURIComponent(id)}`, "DELETE", undefined, etag);
  }
}
