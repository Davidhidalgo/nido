# Nido para OpenClaw

Plugin de menú, agenda y preferencias familiares. Incluye un asistente nativo que añade tres agentes a un OpenClaw existente y una página para gestionar calendarios por nombre. No incluye datos familiares, cuentas ni credenciales. La UI nativa requiere OpenClaw 2026.9.8 o posterior; la versión probada es 2026.9.8.

## Instalar y configurar

<!-- Package filename matching integrations/nido-family/package.json name and version -->

On your OpenClaw server, install the package you have reviewed:

```sh
openclaw plugins install ./openclaw-plugin-nido-family-0.1.2.tgz
```

Confirma la confianza y las capacidades cuando el CLI lo solicite. Para una instalación no interactiva revisada puedes añadir `--force --accept-capabilities`; `--force` también puede reemplazar una versión existente. El paquete no se presupone publicado en npm ni ClawHub.

Abre el dashboard con una sesión administradora, activa **Settings → Labs → Custom plugin UI** y entra en **Nido**. Recarga el navegador si es necesario. El asistente permite probar en demo o conectar Google, elegir el modelo, configurar la familia y revisar antes de guardar. Puede funcionar con configuración inicial del plugin vacía. No instala otro Gateway ni un servicio del sistema.

Nido reutiliza la configuración del modelo y el acceso compartido disponible en el host; no copia autenticación exclusiva de otro agente. Conserva los canales y las políticas globales. En un host con un solo agente, registra ese mismo agente como propietario de las operaciones del sistema para conservar su destino al ampliar el grupo.

Pulsa **Conectar con Google**, autoriza la app de Nido y selecciona dos calendarios distintos por nombre. El asistente detecta la conexión automáticamente; funciona desde un navegador en otro equipo sin configurar clientes OAuth ni túneles. Esta revisión aún requiere que el mantenedor despliegue el servicio compartido y configure su URL en la distribución; hasta entonces, la interfaz indica que Google no está disponible y permite la demo. Las escrituras reales empiezan desactivadas. Puedes habilitarlas explícitamente en el asistente o después, en el panel de calendarios. La demo no se transfiere a Google.

La guía completa está en `docs/getting-started.md` del repositorio. Referencias del host: [instalación](https://docs.openclaw.ai/cli/plugins/install) e [interfaces nativas de plugins](https://docs.openclaw.ai/plugins/feature-plugins).

## Qué se guarda

La configuración se añade a `plugins.entries.nido-family.config` y las entradas propias a `agents.entries`. El asistente rechaza agentes con IDs ocupados y configuraciones antiguas que no administra. Los agentes son `nido`, `menu` y `agenda`; las plantillas de `nido-note4` también están incluidas, pero su agente y puente son opcionales y no se activan durante la instalación.

Bajo `<OPENCLAW_STATE_DIR>/nido-family/` (el estado habitual del host si no defines esa variable):

- `demo/`: SQLite y preferencias ficticias.
- `google/`: SQLite, preferencias reales y `google-credentials.json` con el permiso cifrado de conexión, guardado con permisos 0600. `oauth-pending.json` conserva temporalmente la prueba privada para recuperar una autorización en curso tras un reinicio.
- `profiles/<hash>/<agente>/AGENTS.md`: instrucciones públicas más miembros y horarios privados.
- `agents/<agente>/`: estado independiente de los agentes administrado por OpenClaw.

Los perfiles anteriores se conservan si cambias datos o modo. Un fallo antes de guardar puede dejar un perfil preparado sin activar; no se reutiliza con datos distintos. Nunca borres bases, sesiones o respaldos como si fueran caché.

El servicio compartido completa y renueva OAuth con Google; procesa los tokens y conserva resultados cifrados durante diez minutos para recuperar respuestas perdidas. El plugin consulta Calendar directamente. El servicio no recibe eventos ni preferencias, aunque su operador tiene acceso técnico a los tokens y debe reflejarlo en su política de privacidad. Las credenciales Desktop anteriores siguen siendo compatibles.

## Calendarios y permisos

El coordinador delega; el plugin bloquea que ejecute herramientas familiares directamente. Menú escribe menú y preferencias; Agenda escribe agenda y otros calendarios autorizados. La identidad la proporciona OpenClaw. Una política del plugin limita las consultas y continuaciones de sesión a especialistas creados por la conversación de Nido.

La página Nido reutiliza tu sesión administrativa. Permite ver calendarios, nombres cortos, predeterminados y acceso de cada especialista. Las reglas `calendarAccess` usan `read`, `write` y `defaultCalendar`; `write` debe estar incluido en `read`. `writesEnabled=false` bloquea las escrituras de eventos. Google debe conceder `writer` u `owner` para autorizar escrituras nuevas. Se conservan ETags, versiones de preferencias y reconciliación de resultados inciertos.

`familyConfigFile` es opcional y solo se usa en el despliegue aislado antiguo para sincronizar calendarios con su generador. El asistente guarda directamente en el host. `note4Maintenance` permite mantenimiento y OTA de un NOTE4 configurado por separado; sus RPC exigen permisos administrativos.

La interfaz está en `dist/control-ui/<hash>/`. No requiere modificar OpenClaw. El antiguo `openclaw-settings.mjs` se conserva como integración heredada opcional y ya no se ejecuta al instalar el runtime ni al compilar.

## Reconectar Google

Usa **Reconectar Google** y vuelve a autorizar la app de Nido. La nueva conexión debe poder leer todos los calendarios actualmente configurados antes de sustituir las credenciales. Si falla o cambió la configuración durante el proceso, se conservan las anteriores. No se repite automáticamente un intercambio OAuth incierto. Los permisos efectivos de escritura siguen dependiendo de Google.

## Empaquetar desde el código

Solo para desarrollo o distribución: Node 24.16+ de la rama 24, pnpm 9.0.5, macOS, Linux o WSL2.

```sh
nvm use
node scripts/install-local.mjs
pnpm install --frozen-lockfile
pnpm run plugin:pack
```

<!-- Package output and isolated verification from scripts/pack-plugin.mjs, scripts/test-plugin-install-isolated.mjs and integrations/nido-family/package.json -->

The output is `release/openclaw-plugin-nido-family-0.1.2.tgz`. `plugin:pack` runs the privacy check and build. The archive contains only compiled code, the active UI, generic templates, the manifest, and this guide. It does not publish anything. The build uses temporary state without reading `.local` or modifying the runtime.

Run `pnpm run test:plugin:isolated` to install the archive matching the source package version in a temporary host. The check verifies installed package/manifest versions, setup, preservation of the existing host, runtime permissions, and chronological menu behavior using the installed code. It requires localhost access and makes no model or Google calls. It stops the temporary Gateway and removes its test state when finished.
