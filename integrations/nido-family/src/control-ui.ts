import { defineControlUiPlugin, type ControlUiView } from "openclaw/plugin-sdk/control-ui";
// Generated at build time from the same calendar UI used by the legacy integration.
import "./calendar-element.js";
import { openOAuthWindow } from "./google-oauth-window.js";

type Status = {
  version: string;
  configured: boolean;
  managed: boolean;
  mode?: string;
  requestId?: string;
  modelAgents: { id: string; name: string }[];
  googleConnected: boolean;
  googleAuthAvailable: boolean;
  googleAuthPending: boolean;
  occupiedAgents: string[];
  hostToolPolicy: boolean;
  profile: {
    timeZone: string;
    members: string[];
    mealTimes: { lunch: string; dinner: string; durationMinutes: number };
  };
};
type Choice = { id: string; summary: string; summaryOverride?: string; accessRole: string };
const mount: ControlUiView = (container, context) => {
  const { host, signal } = context;
  const shell = document.createElement("div");
  container.append(shell);
  const root = shell.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    :host{display:block;color:var(--text,#e8e8e8);font:15px/1.6 system-ui,sans-serif}
    main{max-width:850px;margin:0 auto;padding:28px 24px 60px}h1{font-size:30px;margin:0}h2{font-size:20px;margin:0 0 12px}p{margin:8px 0 18px}.muted{opacity:.75}
    section{border:1px solid var(--border,#555);border-radius:14px;padding:22px;margin-top:20px}label{display:block;margin:12px 0 6px}
    input,select,button{font:inherit;border:1px solid var(--border,#777);border-radius:8px;padding:9px 12px;color:inherit;background:var(--bg,#242629);max-width:100%;box-sizing:border-box}
    input:not([type=checkbox]),select{width:100%}input[type=checkbox]{margin-right:10px}button{cursor:pointer;margin:6px 8px 0 0}button.primary{background:#bfe7d1;color:#153629;border-color:#bfe7d1}button:disabled{opacity:.5;cursor:wait}
    a{color:inherit;text-decoration:underline}.row{display:grid;grid-template-columns:1fr 1fr;gap:16px}.notice{padding:12px;border-left:3px solid #9bbca9}#status{white-space:pre-wrap}fieldset{border:0;padding:0;margin:0}details{margin:12px 0}[hidden]{display:none!important}
    @media(max-width:600px){main{padding:16px}.row{grid-template-columns:1fr}section{padding:16px}}
  </style><main>
    <h1>🪺 Nido</h1><p class="muted">Menú y agenda familiar en tu OpenClaw.</p>
    <p id="status" role="status" aria-live="polite">Cargando configuración…</p>
    <button id="refresh">Actualizar estado</button>
    <div id="ready" hidden><section><h2 id="ready-title"></h2><p id="ready-text"></p><button id="chat" class="primary">Hablar con Nido</button><button id="switch" hidden>Conectar Google Calendar</button><button id="reconnect" hidden>Reconectar Google</button></section><div id="calendars"></div></div>
    <form id="setup" hidden><fieldset id="fields">
      <section><h2>1. Elige cómo empezar</h2><label for="mode">Calendarios</label><select id="mode"><option value="demo">Probar con calendarios ficticios</option><option value="google">Conectar Google Calendar</option></select><p id="mode-help" class="muted">La demo guarda datos de prueba y no necesita una cuenta de Google.</p>
        <div id="google" hidden><p>Conecta tu cuenta y autoriza a Nido para acceder a Google Calendar.</p>
          <div id="connect"><p id="reconnect-help" hidden>Conecta una cuenta que tenga acceso a tus calendarios actuales. Nido conservará tus eventos y preferencias.</p><button id="authorize" type="button" class="primary">Conectar con Google</button><p id="google-unavailable" hidden>La conexión con Google de Nido todavía no está disponible en esta distribución. Puedes empezar con la demo.</p><p><button id="oauth-link" type="button" hidden>Continuar en Google ↗</button></p></div>
          <button id="load-calendars" type="button">Actualizar calendarios</button><p id="google-status" role="status"></p>
          <div class="row"><div><label for="menu-calendar">Calendario del menú</label><select id="menu-calendar" required disabled></select></div><div><label for="family-calendar">Calendario de la agenda</label><select id="family-calendar" required disabled></select></div></div>
          <p class="muted">Selecciona dos calendarios distintos. Puedes crearlos antes en Google Calendar; Nido no crea calendarios automáticamente.</p>
        </div>
      </section>
      <section><h2>2. Tu familia</h2><label for="model-agent">Modelo de OpenClaw</label><select id="model-agent"><option value="">Usar la configuración general</option></select><label for="timezone">Zona horaria</label><input id="timezone" required maxlength="100" placeholder="Europe/Madrid"><label for="members">Nombres de los miembros (opcional, separados por comas)</label><input id="members" maxlength="1600" autocomplete="off"><div class="row"><div><label for="lunch">Hora habitual de la comida</label><input id="lunch" type="time" required></div><div><label for="dinner">Hora habitual de la cena</label><input id="dinner" type="time" required></div></div><label for="duration">Duración habitual de las comidas (minutos)</label><input id="duration" type="number" min="1" max="240" required></section>
      <section><h2>3. Permisos</h2><label><input id="writes" type="checkbox">Permitir guardar y rectificar eventos cuando se lo pida a Nido</label><p>Menú podrá escribir en su calendario y Agenda en el suyo. Ambos podrán leer los dos. Los borrados requieren confirmación del evento en la conversación. Después podrás ajustar los accesos por calendario.</p><p>Se añadirán Nido, Menú y Agenda con tu modelo actual. Los datos se guardarán en el estado privado de OpenClaw. Telegram y NOTE4 se pueden añadir más adelante.</p><p id="policy" class="notice" hidden>Tu OpenClaw tiene restricciones globales de herramientas. Esas restricciones se mantienen y pueden impedir que Nido delegue o use sus herramientas; revisa la política del host si sucede.</p><button class="primary" type="submit">Revisar instalación</button><button id="cancel" type="button" hidden>Volver</button></section>
    </fieldset></form>
    <section id="review" hidden><h2>Revisa antes de guardar</h2><p id="summary"></p><button id="apply" class="primary">Guardar y activar Nido</button><button id="back">Volver al formulario</button></section>
  </main>`;
  const el = <T extends HTMLElement>(id: string) => root.getElementById(id) as T;
  const input = (id: string) => el<HTMLInputElement>(id);
  const select = (id: string) => el<HTMLSelectElement>(id);
  let status: Status;
  let draft: Record<string, unknown> | undefined;
  let reconnect = false;
  let disposed = false;
  let busy = false;
  let googleTimer: ReturnType<typeof setTimeout> | undefined;
  let pollingGoogle = false;
  let authorizationUrl: string | undefined;
  function notice(text: string) {
    if (!disposed) el("status").textContent = text;
  }
  async function action(task: () => Promise<void>) {
    if (busy || disposed) return;
    busy = true;
    const buttons = [...root.querySelectorAll("button")];
    for (const button of buttons) button.disabled = true;
    try {
      await task();
    } catch (error) {
      notice(
        error instanceof Error
          ? error.message
          : "No se pudo completar la operación. Actualiza el estado.",
      );
    } finally {
      busy = false;
      for (const button of buttons) button.disabled = false;
      el<HTMLButtonElement>("authorize").disabled = !status?.googleAuthAvailable;
    }
  }
  function event(id: string, task: () => Promise<void> | void) {
    el(id).addEventListener(
      "click",
      () =>
        void action(async () => {
          await task();
        }),
      { signal },
    );
  }
  function modeChanged() {
    const google = select("mode").value === "google";
    el("google").hidden = !google;
    el("mode-help").hidden = google;
    select("menu-calendar").required = google;
    select("family-calendar").required = google;
    input("writes").checked = !google;
    el("connect").hidden = !reconnect && (status?.googleConnected ?? false);
    el("reconnect-help").hidden = !reconnect;
    el("google-unavailable").hidden = status?.googleAuthAvailable ?? false;
    el<HTMLButtonElement>("authorize").disabled = !status?.googleAuthAvailable;
  }
  function showForm() {
    el("ready").hidden = true;
    el("setup").hidden = false;
    el("review").hidden = true;
    el("cancel").hidden = !status.configured;
    input("timezone").value =
      status.profile.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    input("members").value = status.profile.members.join(", ");
    input("lunch").value = status.profile.mealTimes.lunch;
    input("dinner").value = status.profile.mealTimes.dinner;
    input("duration").value = String(status.profile.mealTimes.durationMinutes);
    el("policy").hidden = !status.hostToolPolicy;
    select("model-agent").replaceChildren(new Option("Usar la configuración general", ""));
    for (const agent of status.modelAgents)
      select("model-agent").append(new Option(`Usar el modelo de ${agent.name}`, agent.id));
    if (status.modelAgents.length === 1) select("model-agent").value = status.modelAgents[0].id;
    modeChanged();
  }
  async function readStatus() {
    for (let attempt = 0; ; attempt++) {
      try {
        return await host.request<Status>("nido.setup.status", {});
      } catch (error) {
        if (
          disposed ||
          attempt >= 15 ||
          !/reloaded|unavailable|disconnected|closed|not connected|unknown method/i.test(
            String(error),
          )
        )
          throw error;
        notice("OpenClaw está recargando Nido. Comprobando el estado guardado…");
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
  async function load() {
    if (!host.connection.connected) {
      notice("Conectando con OpenClaw…");
      return;
    }
    if (!host.connection.canAdmin) {
      notice("Abre Nido con una sesión administradora de OpenClaw para configurar la instalación.");
      return;
    }
    const next = await readStatus();
    if (disposed) return;
    status = next;
    if (status.googleAuthPending) waitForGoogle();
    reconnect = false;
    el("review").hidden = true;
    if (status.occupiedAgents.length && !status.configured) {
      notice(
        `Ya existen agentes con estos nombres: ${status.occupiedAgents.join(", ")}. La instalación se detiene para conservarlos. Renómbralos desde OpenClaw si quieres reservar esos nombres para Nido.`,
      );
      el("setup").hidden = true;
      return;
    }
    if (!status.configured) {
      notice("Configura Nido una vez; después podrás hablar con él desde OpenClaw.");
      showForm();
      return;
    }
    notice("");
    el("setup").hidden = true;
    el("ready").hidden = false;
    el("ready-title").textContent =
      status.mode === "demo" ? "Nido está en modo de prueba" : "Nido está conectado a Google";
    el("ready-text").textContent =
      status.mode === "demo"
        ? "Puedes hablar con Nido. Los eventos y preferencias de esta demo quedan separados de Google."
        : "Los permisos de cada calendario se muestran abajo. Abre una conversación para organizar tu menú o tu agenda.";
    el("switch").hidden = !(status.managed && status.mode === "demo");
    el("reconnect").hidden = !(status.managed && status.googleConnected);
    const panel = document.createElement("nido-calendar-settings") as HTMLElement & {
      client: unknown;
    };
    panel.client = { request: host.request.bind(host) };
    el("calendars").replaceChildren(panel);
  }
  event("refresh", load);
  event("cancel", load);
  event("switch", () => {
    select("mode").value = "google";
    showForm();
  });
  select("mode").addEventListener("change", modeChanged, { signal });
  event("reconnect", () => {
    reconnect = true;
    select("mode").value = "google";
    showForm();
  });
  function waitForGoogle() {
    if (pollingGoogle || disposed) return;
    pollingGoogle = true;
    const deadline = Date.now() + 10 * 60 * 1000;
    async function check() {
      if (disposed) return;
      try {
        const result = await host.request<{ status: string; message?: string }>(
          "nido.google.status",
          {},
        );
        if (disposed) return;
        if (result.status === "connected") {
          pollingGoogle = false;
          status.googleAuthPending = false;
          el("oauth-link").hidden = true;
          if (status.configured && status.mode === "google") {
            await load();
            notice("Cuenta de Google conectada. Tus calendarios y preferencias se han conservado.");
          } else await loadCalendars();
          return;
        }
        if (["failed", "expired", "idle"].includes(result.status)) {
          pollingGoogle = false;
          el("oauth-link").hidden = true;
          const message =
            result.message ||
            "La autorización no se completó. Puedes volver a conectar con Google.";
          el("google-status").textContent = message;
          notice(message);
          return;
        }
        el("google-status").textContent = "Esperando tu autorización en Google…";
      } catch {
        if (disposed) return;
        el("google-status").textContent = "Comprobando el estado de la conexión…";
      }
      if (Date.now() < deadline) googleTimer = setTimeout(() => void check(), 2000);
      else {
        pollingGoogle = false;
        el("google-status").textContent = "La autorización caducó. Vuelve a conectar con Google.";
      }
    }
    void check();
  }
  event("oauth-link", () => {
    if (
      authorizationUrl &&
      !openOAuthWindow(authorizationUrl, window.open("about:blank", "_blank"))
    )
      notice(
        "Permite las ventanas emergentes de OpenClaw o abre su dashboard en tu navegador habitual para conectar con Google.",
      );
  });
  el("authorize").addEventListener(
    "click",
    () => {
      if (busy || disposed || !status.googleAuthAvailable) return;
      // Open synchronously with the user's click to avoid popup blocking after RPC.
      const popup = window.open("about:blank", "_blank");
      if (popup) popup.opener = null;
      void action(async () => {
        try {
          const result = await host.request<{ url: string }>("nido.google.start", {
            replace: reconnect,
            origin: location.origin,
          });
          if (disposed) {
            popup?.close();
            return;
          }
          authorizationUrl = result.url;
          el("oauth-link").hidden = false;
          const opened = openOAuthWindow(result.url, popup);
          el("google-status").textContent = opened
            ? "Acepta el acceso en Google. Nido detectará la conexión automáticamente."
            : "El navegador bloqueó la ventana. Pulsa Continuar en Google y permite las ventanas emergentes de OpenClaw.";
          if (!opened)
            notice("Pulsa Continuar en Google y permite las ventanas emergentes de OpenClaw.");
          waitForGoogle();
        } catch (error) {
          popup?.close();
          throw error;
        }
      });
    },
    { signal },
  );
  async function loadCalendars() {
    const result = await host.request<{ calendars: Choice[] }>("nido.google.calendars", {});
    if (disposed) return;
    status.googleConnected = true;
    el("connect").hidden = true;
    for (const id of ["menu-calendar", "family-calendar"]) {
      const field = select(id);
      field.replaceChildren(new Option("Elige un calendario…", ""));
      for (const calendar of result.calendars.filter((c) =>
        ["owner", "writer", "reader"].includes(c.accessRole),
      )) {
        field.append(
          new Option(
            `${calendar.summaryOverride || calendar.summary}${calendar.accessRole === "reader" ? " (solo lectura)" : ""}`,
            calendar.id,
          ),
        );
      }
      field.disabled = false;
    }
    el("google-status").textContent = "Cuenta conectada. Elige los dos calendarios por su nombre.";
  }
  event("load-calendars", loadCalendars);
  el<HTMLFormElement>("setup").addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      void action(async () => {
        const google = select("mode").value === "google";
        draft = {
          ...(select("model-agent").value ? { modelAgentId: select("model-agent").value } : {}),
          version: status.version,
          requestId: crypto.randomUUID(),
          mode: google ? "google" : "demo",
          timeZone: input("timezone").value.trim(),
          members: input("members")
            .value.split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          mealTimes: {
            lunch: input("lunch").value,
            dinner: input("dinner").value,
            durationMinutes: Number(input("duration").value),
          },
          writesEnabled: input("writes").checked,
          ...(google
            ? {
                menuCalendarId: select("menu-calendar").value,
                familyCalendarId: select("family-calendar").value,
              }
            : {}),
        };
        const preview = await host.request<{ calendars: string[]; writesEnabled: boolean }>(
          "nido.setup.preview",
          draft,
        );
        if (disposed) return;
        el("summary").textContent =
          `${google ? "Google Calendar" : "Calendarios ficticios"}: ${preview.calendars.join(" y ")}. ${preview.writesEnabled ? "Se permite guardar eventos a petición tuya." : "Los eventos estarán en modo de solo lectura."} Se crearán o actualizarán únicamente los agentes de Nido. El cambio de modo no copia eventos ni preferencias de la demo.`;
        el("review").hidden = false;
        el("setup").hidden = true;
        notice("");
        el("apply").focus();
      });
    },
    { signal },
  );
  event("back", () => {
    el("review").hidden = true;
    el("setup").hidden = false;
  });
  event("apply", async () => {
    if (!draft) return;
    try {
      await host.request("nido.setup.apply", draft);
    } catch {
      // Read the operation marker after a lost response. Never send apply again here.
      const current = await readStatus();
      if (current.requestId !== draft.requestId) {
        await load();
        throw new Error(
          "El guardado no está confirmado. Revisa el estado y vuelve a preparar la instalación.",
        );
      }
    }
    await load();
    notice(
      "Configuración guardada. Si OpenClaw se está reconectando, espera unos segundos y actualiza el estado.",
    );
  });
  event("chat", async () => {
    await host.agents.refresh();
    const key = await host.sessions.create({ agentId: "nido", label: "Nido" });
    if (key) host.sessions.open({ sessionKey: key, agentId: "nido" });
  });
  let connected = host.connection.connected;
  void action(load);
  return {
    update() {
      const next = host.connection.connected;
      if (next && !connected) void action(load);
      connected = next;
    },
    dispose() {
      disposed = true;
      clearTimeout(googleTimer);
      shell.remove();
    },
  };
};

export default defineControlUiPlugin({
  id: "nido-family",
  activate(host) {
    const page = host.ui.registerPage({ id: "setup", label: "Nido", mount });
    const navigation = host.ui.registerNavigation({
      id: "nido",
      label: "Nido",
      page: { id: "setup" },
      icon: "home",
      order: 50,
    });
    return () => {
      navigation();
      page();
    };
  },
});
