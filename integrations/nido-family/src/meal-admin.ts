import { readFile, writeFile, copyFile, rename } from "node:fs/promises";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { defaultMealTimes, NidoError } from "./core.js";
import { pluginConfig, setupVersion } from "./setup.js";

export const MealSettings = Type.Object(
  {
    version: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    lunch: Type.String({ pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" }),
    dinner: Type.String({ pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" }),
    mealDimmingMinutes: Type.Union([Type.Null(), Type.Integer({ minimum: 0, maximum: 1440 })]),
  },
  { additionalProperties: false },
);

export function mealSettings(host: ReturnType<OpenClawPluginApi["runtime"]["config"]["current"]>) {
  const config = pluginConfig(host);
  if (!config?.mode) throw new NidoError("CONFIG", "Configura Nido antes de editar las comidas.");
  const times = config.mealTimes ?? defaultMealTimes;
  return {
    version: setupVersion(host),
    lunch: times.lunch,
    dinner: times.dinner,
    mealDimmingMinutes: config.mealDimmingMinutes === undefined ? 120 : config.mealDimmingMinutes,
  };
}
export async function saveMealSettings(api: OpenClawPluginApi, raw: unknown) {
  if (!Value.Check(MealSettings, raw) || raw.lunch === raw.dinner)
    throw new NidoError(
      "INVALID_INPUT",
      "Revisa las horas (deben ser distintas) y la atenuación (0–1440 minutos).",
    );
  const host = api.runtime.config.current();
  mealSettings(host);
  if (setupVersion(host) !== raw.version)
    throw new NidoError("CONFLICT", "La configuración cambió. Actualiza antes de guardar.");
  const config = pluginConfig(host)!;
  const mealTimes = {
    ...(config.mealTimes ?? defaultMealTimes),
    lunch: raw.lunch,
    dinner: raw.dinner,
  };
  const writeOptions: { unsetPaths: string[][] } = { unsetPaths: [] };
  await api.runtime.config.mutateConfigFile({
    writeOptions,
    afterWrite: { mode: "auto" },
    mutate(draft, context) {
      if (setupVersion(draft) !== raw.version)
        throw new NidoError("CONFLICT", "La configuración cambió. Actualiza antes de guardar.");
      const authored =
        context.snapshot.sourceConfigBeforeMigrations ?? context.snapshot.sourceConfig;
      if (authored?.agents) draft.agents = structuredClone(authored.agents);
      if (!authored?.agents?.defaults?.modelPolicy) {
        writeOptions.unsetPaths.push(["agents", "defaults", "modelPolicy"]);
        if (!authored?.meta?.migrations?.modelPolicyAllowlist)
          writeOptions.unsetPaths.push(["meta", "migrations", "modelPolicyAllowlist"]);
      }
      const target = pluginConfig(draft)!;
      target.mealTimes = mealTimes;
      target.mealDimmingMinutes = raw.mealDimmingMinutes;
    },
  });
  let warning = "";
  if (config.familyConfigFile) {
    try {
      const original = await readFile(config.familyConfigFile, "utf8");
      const family = {
        ...JSON.parse(original),
        mealTimes,
        mealDimmingMinutes: raw.mealDimmingMinutes,
      };
      const suffix = crypto.randomUUID();
      await copyFile(
        config.familyConfigFile,
        `${config.familyConfigFile}.before-meal-settings-${suffix}`,
      );
      const temporary = `${config.familyConfigFile}.meal-settings-${suffix}`;
      await writeFile(temporary, JSON.stringify(family, null, 2) + "\n", { mode: 0o600 });
      if ((await readFile(config.familyConfigFile, "utf8")) !== original)
        throw Error("Concurrent edit");
      await rename(temporary, config.familyConfigFile);
    } catch {
      warning =
        "Los ajustes se guardaron, pero no se pudo sincronizar family.json. Revísalo antes de volver a preparar la instalación.";
    }
  }
  return { saved: true, warning };
}
export function registerMealAdmin(api: OpenClawPluginApi) {
  for (const [method, action] of [
    ["nido.meals.get", async () => mealSettings(api.runtime.config.current())],
    ["nido.meals.save", (raw: unknown) => saveMealSettings(api, raw)],
  ] as const) {
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
                : "No se pudo confirmar el guardado. Actualiza el estado antes de repetir.",
          });
        }
      },
      { scope: "operator.admin" },
    );
  }
  // Runtime settings take precedence over meal times embedded in older workspaces.
  api.on("before_prompt_build", async (_event, context) => {
    if (!["nido", "menu", "agenda", "nido-note4"].includes(context.agentId ?? "")) return;
    const config = pluginConfig(api.runtime.config.current());
    if (!config?.mode) return;
    return {
      prependSystemContext:
        "Horarios actuales de Nido (sustituyen horarios anteriores del perfil; no cambian permisos ni mueven eventos existentes): " +
        JSON.stringify({
          timeZone: config.timeZone,
          mealTimes: config.mealTimes ?? defaultMealTimes,
        }),
    };
  });
}
