import { expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import {
  mealSettings,
  saveMealSettings,
  registerMealAdmin,
} from "../integrations/nido-family/src/meal-admin.js";
import { pluginConfig } from "../integrations/nido-family/src/setup.js";
function fixture() {
  const host: OpenClawPluginApi["config"] = {
    plugins: {
      entries: {
        "nido-family": {
          config: {
            mode: "demo",
            dataDir: "/tmp/meal-settings-fixture",
            timeZone: "Europe/Madrid",
            menuCalendarId: "menu",
            familyCalendarId: "family",
            writesEnabled: false,
            calendarAccess: { agenda: { defaultCalendar: "family", read: ["family"], write: [] } },
            mealTimes: { lunch: "13:00", dinner: "20:00", durationMinutes: 45 },
          },
        },
      },
    },
    agents: { entries: { existing: { workspace: "/tmp/existing" } } },
  };
  let race: (() => void) | undefined;
  const api = {
    runtime: {
      config: {
        current: () => host,
        mutateConfigFile: vi.fn(
          async ({ mutate }: { mutate: (draft: typeof host, context: unknown) => void }) => {
            race?.();
            mutate(host, { snapshot: { sourceConfig: structuredClone(host) } });
          },
        ),
      },
    },
  } as unknown as OpenClawPluginApi;
  return {
    host,
    api,
    race: (fn: () => void) => {
      race = fn;
    },
  };
}
it("saves only meal settings and retains duration, permissions, agents and defaults", async () => {
  const { host, api } = fixture(),
    before = structuredClone(host);
  expect(mealSettings(host).mealDimmingMinutes).toBe(120);
  await saveMealSettings(api, {
    ...mealSettings(host),
    lunch: "14:15",
    dinner: "21:30",
    mealDimmingMinutes: null,
  });
  const expected = pluginConfig(before)!;
  expected.mealTimes!.lunch = "14:15";
  expected.mealTimes!.dinner = "21:30";
  expected.mealDimmingMinutes = null;
  expect(host).toEqual(before);
  expect(mealSettings(host)).toMatchObject({
    lunch: "14:15",
    dinner: "21:30",
    mealDimmingMinutes: null,
  });
});
it.each([
  { lunch: "25:00" },
  { dinner: "13:00" },
  { mealDimmingMinutes: -1 },
  { mealDimmingMinutes: 1441 },
  { mealDimmingMinutes: 1.5 },
  { writesEnabled: true },
])("rejects invalid settings %j without writing", async (change) => {
  const { host, api } = fixture();
  await expect(saveMealSettings(api, { ...mealSettings(host), ...change })).rejects.toThrow();
  expect(api.runtime.config.mutateConfigFile).not.toHaveBeenCalled();
});
it("rejects stale reads and changes inside the host transaction", async () => {
  const f = fixture(),
    request = mealSettings(f.host);
  f.race(() => {
    pluginConfig(f.host)!.writesEnabled = true;
  });
  await expect(saveMealSettings(f.api, { ...request, lunch: "14:00" })).rejects.toThrow(/cambió/);
  expect(pluginConfig(f.host)!.mealTimes!.lunch).toBe("13:00");
  await expect(saveMealSettings(f.api, request)).rejects.toThrow(/cambió/);
});
it("restricts RPC to admins and provides current times only to Nido agents", async () => {
  const f = fixture();
  const register = vi.fn(),
    on = vi.fn();
  registerMealAdmin({
    ...f.api,
    registerGatewayMethod: register,
    on,
  } as unknown as OpenClawPluginApi);
  expect(register.mock.calls.map(([name, , options]) => [name, options.scope])).toEqual([
    ["nido.meals.get", "operator.admin"],
    ["nido.meals.save", "operator.admin"],
  ]);
  const hook = on.mock.calls[0][1];
  expect(await hook({}, { agentId: "existing" })).toBeUndefined();
  await saveMealSettings(f.api, { ...mealSettings(f.host), lunch: "14:15" });
  expect((await hook({}, { agentId: "menu" })).prependSystemContext).toContain('"lunch":"14:15"');
});
