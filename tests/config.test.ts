import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it.each(["openai/configured", { primary: "openai/configured" }])(
  "preparar conserva modelos configurados y los límites de los especialistas (%j)",
  (model) => {
    const root = mkdtempSync(join(tmpdir(), "nido-config-"));
    const privateDir = root + "-private";
    try {
      for (const dir of ["scripts", "config", ".local/openclaw"])
        mkdirSync(join(root, dir), { recursive: true });
      for (const name of [
        "prepare-local.mjs",
        "private-state.mjs",
        "family-config.mjs",
        "honcho-runtime.mjs",
      ])
        copyFileSync("scripts/" + name, join(root, "scripts", name));
      for (const id of ["nido", "menu", "agenda", "nido-note4"]) {
        mkdirSync(join(root, "agents", id), { recursive: true });
        copyFileSync(join("agents", id, "AGENTS.md"), join(root, "agents", id, "AGENTS.md"));
      }
      copyFileSync("config/family.example.json", join(root, "config/family.example.json"));
      const configPath = join(root, ".local/openclaw/openclaw.json");
      writeFileSync(
        configPath,
        JSON.stringify({
          agents: {
            defaults: { model },
            entries: {
              nido: {
                model: "openai/chosen",
                models: { "openai/chosen": { agentRuntime: { id: "openclaw" } } },
              },
            },
          },
          channels: { telegram: { allowFrom: ["123456", "654321"] } },
          plugins: {
            entries: {
              "openclaw-honcho": {
                enabled: true,
                hooks: { allowConversationAccess: true },
                config: { baseUrl: "http://127.0.0.1:8000", workspaceId: "fixture-family" },
              },
            },
          },
        }),
      );
      writeFileSync(join(root, ".local/telegram-bot-token"), "123:fixture-not-a-real-token\n");
      const env = { ...process.env, NIDO_HOME: privateDir };
      delete env.NIDO_MODEL;
      execFileSync(process.execPath, [join(root, "scripts/prepare-local.mjs")], { env });
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      expect(realpathSync(join(root, ".local"))).toBe(realpathSync(privateDir));
      expect(config.agents.entries.menu.workspace).toBe(
        join(realpathSync(root), ".local/workspaces/menu"),
      );
      expect(
        readFileSync(join(config.agents.entries.menu.workspace, "AGENTS.md"), "utf8"),
      ).toContain("Configuración familiar privada");
      expect(config.agents.defaults.model.primary).toBe("openai/configured");
      expect(config.agents.entries.nido.model).toBe("openai/chosen");
      expect(config.agents.entries.nido.models["openai/chosen"].agentRuntime.id).toBe("openclaw");
      expect(config.agents.entries.nido.tools.allow).toContain("nido_calendar_create");
      expect(config.agents.entries.menu.tools.deny).toContain("sessions_spawn");
      expect(config.agents.entries["nido-note4"].tools.allow).toContain("note4_mostrar");
      expect(config.agents.entries["nido-note4"].model).toBe("openai/chosen");
      expect(config.agents.entries["nido-note4"].models["openai/chosen"].agentRuntime.id).toBe(
        "openclaw",
      );
      expect(config.agents.entries["nido-note4"].tools.deny).toContain("ask_user");
      expect(config.agents.entries["nido-note4"].subagents.allowAgents).toEqual(["menu", "agenda"]);
      expect(config.agents.entries["nido-note4"].tools.deny).not.toContain("sessions_send");
      expect(config.tools.agentToAgent.allow).toContain("nido-note4");
      expect(config.agents.entries.agenda.tools.allow).not.toContain("nido_preferences_set");
      expect(config.plugins.allow).toContain("telegram");
      expect(config.plugins.allow).toContain("document-extract");
      expect(config.plugins.allow).toContain("openclaw-honcho");
      expect(config.plugins.entries["openclaw-honcho"].config.workspaceId).toBe("fixture-family");
      expect(config.plugins.entries["openclaw-honcho"].hooks.allowConversationAccess).toBe(true);
      expect(config.agents.entries.menu.tools.allow).toContain("honcho_context");
      expect(config.agents.entries.nido.tools.allow).toContain("pdf");
      expect(config.agents.defaults.pdfModel.primary).toBe("openai/configured");
      expect(config.tools.fs.workspaceOnly).toBe(true);
      expect(config.channels.telegram).toMatchObject({
        tokenFile: join(realpathSync(root), ".local/telegram-bot-token"),
        dmPolicy: "allowlist",
        allowFrom: ["123456", "654321"],
        groupPolicy: "disabled",
        configWrites: false,
      });
      expect(config.session.dmScope).toBe("per-channel-peer");
      expect(config.commands.allowFrom.telegram).toEqual([]);
      expect(config.bindings).toContainEqual({
        agentId: "nido",
        match: { channel: "telegram", accountId: "default" },
      });
      delete config.channels.telegram.allowFrom;
      writeFileSync(configPath, JSON.stringify(config));
      execFileSync(process.execPath, [join(root, "scripts/prepare-local.mjs")], { env });
      const pairing = JSON.parse(readFileSync(configPath, "utf8"));
      expect(pairing.channels.telegram.dmPolicy).toBe("pairing");
      expect(pairing.bindings).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(privateDir, { recursive: true, force: true });
    }
  },
);
