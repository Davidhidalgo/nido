import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { getSessionEntry } from "openclaw/plugin-sdk/session-store-runtime";
import { pluginConfig } from "./setup.js";

export function childSessionAllowed(
  requester: string | undefined,
  target: unknown,
  owner: string | undefined,
) {
  return Boolean(
    requester &&
    typeof target === "string" &&
    /^agent:(menu|agenda):subagent:[a-z0-9-]+$/i.test(target) &&
    owner === requester,
  );
}
export function registerSessionPolicy(api: OpenClawPluginApi) {
  api.registerTrustedToolPolicy({
    id: "nido-session-scope",
    description: "Los coordinadores de Nido solo continúan o leen sus propios especialistas.",
    evaluate(event, context) {
      if (
        !pluginConfig(api.runtime.config.current())?.setup ||
        !["nido", "menu", "agenda"].includes(context.agentId ?? "")
      )
        return;
      if (!["sessions_send", "sessions_history", "session_status"].includes(event.toolName)) return;
      const target = event.params.sessionKey;
      if (event.toolName === "session_status" && (!target || target === context.sessionKey)) return;
      if (
        context.agentId === "nido" &&
        typeof target === "string" &&
        /^agent:(menu|agenda):subagent:[a-z0-9-]+$/i.test(target)
      ) {
        try {
          const entry = getSessionEntry({
            agentId: target.split(":")[1],
            sessionKey: target,
            readConsistency: "latest",
          });
          if (childSessionAllowed(context.sessionKey, target, entry?.spawnedBy)) return;
        } catch {
          /* A missing or unreadable owner is never authorization. */
        }
      }
      return {
        block: true,
        blockReason:
          "Nido solo puede acceder a los especialistas creados por esta conversación. Usa su sessionKey exacta.",
      };
    },
  });
}
