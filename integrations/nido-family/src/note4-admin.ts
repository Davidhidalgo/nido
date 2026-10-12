import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { NidoError } from "./core.js";
import { Note4Maintenance, OTA_LIMIT } from "./note4-maintenance.js";
import { discoverNote4 } from "./note4-discovery.js";
import { codePairer } from "./note4-pairing.js";
import { githubConfig, Note4GitHub } from "./note4-github.js";
export function registerNote4Admin(api: OpenClawPluginApi) {
  const pairCode = codePairer();
  function github() {
    const config = api.runtime.config.current().plugins?.entries?.["nido-family"]?.config as any;
    const source = githubConfig(config?.note4Maintenance?.github);
    return source ? new Note4GitHub(source) : undefined;
  }
  let downloading = false;
  function current() {
    const config = api.runtime.config.current().plugins?.entries?.["nido-family"]?.config as any;
    if (!config?.note4Maintenance || typeof config.dataDir !== "string")
      throw new NidoError("CONFIG", "Habilita note4Maintenance en la configuración del plugin.");
    const directory = join(config.dataDir, "note4-maintenance");
    return new Note4Maintenance(
      directory,
      config.note4Maintenance.publicKeyFile
        ? readFileSync(config.note4Maintenance.publicKeyFile, "utf8")
        : "",
    );
  }
  const actions: Record<
    string,
    { scope: "operator.read" | "operator.admin"; run: (m: Note4Maintenance, p: any) => unknown }
  > = {
    githubCheck: {
      scope: "operator.admin",
      run: async (m) => {
        const source = github();
        return source
          ? {
              configured: true,
              release: await source.latest(String(m.status().devices[0]?.version ?? "")),
            }
          : { configured: false };
      },
    },
    githubDownload: {
      scope: "operator.admin",
      run: async (m, p) => {
        const source = github();
        if (!source) throw new NidoError("CONFIG", "Configura note4Maintenance.github.repository.");
        if (downloading) throw new NidoError("CONFLICT", "Ya hay una descarga de GitHub en curso.");
        downloading = true;
        try {
          return await source.download(m, p);
        } finally {
          downloading = false;
        }
      },
    },
    discover: { scope: "operator.admin", run: () => discoverNote4() },
    pairCode: {
      scope: "operator.admin",
      run: (m, p) =>
        pairCode(
          m,
          p,
          (api.runtime.config.current().plugins?.entries?.["nido-family"]?.config as any)
            ?.note4Maintenance?.bridgeConfigFile,
        ),
    },
    resolve: { scope: "operator.admin", run: (m, p) => m.resolve(p) },
    status: { scope: "operator.read", run: (m) => m.status() },
    pair: { scope: "operator.admin", run: (m, p) => m.pair(p.endpoint, p.certificate) },
    publish: {
      scope: "operator.admin",
      run: (m, p) => {
        if (
          typeof p.binary !== "string" ||
          p.binary.length > Math.ceil(OTA_LIMIT / 3) * 4 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(p.binary)
        )
          throw new NidoError("INVALID_INPUT", "Binario inválido.");
        return m.publish(p.envelope, Buffer.from(p.binary, "base64"));
      },
    },
    update: { scope: "operator.admin", run: (m, p) => m.request(p.id, p.deviceId, p.version) },
  };
  for (const [name, action] of Object.entries(actions)) {
    api.registerGatewayMethod(
      `nido.note4.${name}`,
      async ({ params, respond }) => {
        try {
          const manager = current();
          try {
            respond(true, await action.run(manager, params));
          } finally {
            manager.close();
          }
        } catch (error) {
          respond(false, undefined, {
            code: "INVALID_REQUEST",
            message:
              error instanceof NidoError
                ? error.message
                : "No se pudo confirmar la operación. Consulta el estado antes de repetir.",
          });
        }
      },
      { scope: action.scope },
    );
  }
}
