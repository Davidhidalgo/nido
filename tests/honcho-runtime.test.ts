import { expect, it } from "vitest";
import { disableDemoHoncho, honchoPlugin } from "../scripts/honcho-runtime.mjs";

it("la demo no captura ni recupera memoria de la familia", () => {
  const config = {
    plugins: {
      allow: ["nido-family", "openclaw-honcho"],
      entries: { "openclaw-honcho": { enabled: true, config: { workspaceId: "fixture-family" } } },
    },
    agents: { entries: { menu: { tools: { allow: ["nido_calendar_list", "honcho_context"] } } } },
  };
  disableDemoHoncho(config);
  expect(config.plugins.allow).toEqual(["nido-family"]);
  expect(config.plugins.entries["openclaw-honcho"]).toEqual({ enabled: false });
  expect(config.agents.entries.menu.tools.allow).toEqual(["nido_calendar_list"]);
});

it("Honcho es opcional y su configuración se conserva sin mutar el origen", () => {
  expect(honchoPlugin({})).toBeUndefined();
  const source = { plugins: { entries: { "openclaw-honcho": { enabled: false } } } };
  const entry = honchoPlugin(source);
  entry.enabled = true;
  expect(source.plugins.entries["openclaw-honcho"].enabled).toBe(false);
});
