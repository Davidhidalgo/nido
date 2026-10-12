import { expect, it } from "vitest";
import { Script } from "node:vm";
// @ts-expect-error Script entry points are plain ESM.
import { nidoSettingsPatch } from "../scripts/openclaw-settings.mjs";
import { calendarSettingsModule } from "../integrations/nido-family/src/calendar-settings.js";
it("patches only the Nido plugin form and is idempotent", () => {
  const source =
    "function zr(e,t){return 1} let m={connected:e.connected,other:1}; function render(){return Kr({context:this.context,other:1})}";
  const patched = nidoSettingsPatch(source);
  expect(patched).toContain("t.id===`nido-family`");
  expect(patched).toContain("this.gateway.client");
  expect(nidoSettingsPatch(patched)).toBe(patched);
  expect(() => nidoSettingsPatch("different runtime")).toThrow(/cambió/);
});
it("uses native RPC without a second token or embedded account data", () => {
  const module = calendarSettingsModule();
  expect(() => new Script(module)).not.toThrow();
  expect(module).toContain("host.client.request('nido.calendars.configure',payload)");
  expect(module).toContain("nido.calendars.catalog");
  expect(module).not.toContain("fetch(");
  expect(module).not.toContain("credential.value");
  expect(module).not.toContain("location.reload");
});

it("patches the 2026.9.8 settings editor and carries the authenticated client to Nido", () => {
  const source =
    "render(){let e=this.model;if(!e)return O;return 1}let _={connected:e.connected,other:1};function render(){return Zr({mcpLogin:this.mcpLogin.render(),context:this.context})}";
  const patched = nidoSettingsPatch(source);
  expect(patched).toContain("e.pluginId===`nido-family`");
  expect(patched).toContain("nidoClient:this.gateway.client");
  expect(patched).toContain(".client=${e.nidoClient}");
  expect(nidoSettingsPatch(patched)).toBe(patched);
});
it("exposes NOTE4 maintenance through administrative native RPC", () => {
  const module = calendarSettingsModule();
  for (const action of [
    "pair",
    "publish",
    "update",
    "status",
    "resolve",
    "githubCheck",
    "githubDownload",
  ])
    expect(module).toContain(`nido.note4.${action}`);
  expect(module).toContain("pendingUpdate");
  expect(module).toContain(".nidoota");
});
