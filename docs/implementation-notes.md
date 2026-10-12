# Decisiones de implementación

These notes retain technical rationale. Current priorities and the dated decision index are maintained centrally. See [next steps](next-steps.md) and [session workflow](session-workflow.md).

## Extensión pequeña de Calendar

Se revisó [openclaw-google-workspace de tensorfold](https://github.com/tensorfold/openclaw-google-workspace). Su configuración documenta acceso de Calendar global de lectura/escritura, pero no las autorizaciones distintas por agente y calendario de Nido. No se instaló ese plugin ni se concedió acceso general a Google Workspace.

Se usó el generador oficial `openclaw plugins init nido-family --directory integrations/nido-family --name "Nido Family"`. La extensión conserva el contrato oficial de tool plugins y usa una factory para obtener `agentId` y sesión del runtime, nunca de argumentos del modelo.

Las funciones de Calendar se comparten entre agentes y verifican el alias permitido antes de acceder al adaptador. `nido` ve sus esquemas para poder delegarlas (OpenClaw hereda las herramientas visibles del padre), pero el plugin rechaza cualquier ejecución directa del coordinador con `FORBIDDEN`, antes de acceder a los datos; `menu` y `agenda` no reciben herramientas de delegación. El Gateway familiar es el ámbito operativo previsto; el simulador NOTE4 usa un Gateway temporal separado con calendarios demo.

El repositorio tiene un paquete pnpm simple para compilar y probar esta extensión. No se ha creado un monorepo Nx ni una aplicación web o agente alternativo. TypeScript 6.0.3, Vitest 5.0.1, Oxlint 1.83.0 y Oxfmt 0.68.0 están fijados. El lockfile fija las dependencias restantes. OpenClaw está instalado aparte en `.runtime/` y enlazado como dependencia de desarrollo.

## Separación de datos

- `agents/`: instrucciones sin información privada real, versionables.
- `config/`: plantillas y versiones, sin secretos.
- `.local` es un enlace ignorado al directorio privado externo configurado por `setup`.
- `.local/workspaces/`: instrucciones generadas y adjuntos; las plantillas públicas están en `agents/`.
- `.local/family.json`: IDs y opciones particulares, ignorados por Git.
- `.local/family-data/<modo>/nido.sqlite`: preferencias, registro de operaciones y, solo en demo, eventos ficticios.
- `.local/family-data/google/google-credentials.json`: credenciales OAuth, ignoradas por Git y con permisos 0600.
- `.local/openclaw/`: configuración generada, sesiones y estado del Gateway.
- `.runtime/` y `.cache/`: runtime y cachés locales, ignorados por Git.

En modo Google no se mantiene una réplica de la agenda. El registro de operaciones contiene los datos necesarios para conocer el cambio y su resultado, y está separado por modo. Las opciones familiares se almacenan en el directorio privado externo.

El runtime descargado queda en `.runtime/`, ignorado. El estado operativo, incluidas las familias demo, queda fuera del checkout mediante `.local`. Los experimentos históricos se archivan aparte; las conclusiones reutilizables están en las guías públicas de arquitectura y desarrollo. Consulta [la organización de datos](data-layout.md).

## Reinstalación del runtime

`node scripts/install-local.mjs` requiere Node 24.16+ de la rama 24 e instala la versión fijada de OpenClaw en `.runtime/`. Usa el Node del equipo y admite shell POSIX en macOS, Linux y WSL2. No instala ni modifica el Node global. El checksum histórico de Node en `config/runtime-versions.json` describe la instalación original y ya no se utiliza para descargar Node.

Después:

```sh
nvm install
nvm use
pnpm install --frozen-lockfile
pnpm run build
pnpm run prepare:local
```

La versión recomendada de Node está en `.nvmrc`; pnpm está fijado en `package.json`. No se presupone la versión global de Node ni un gestor concreto. El wrapper `scripts/pnpm` se conserva por compatibilidad; `scripts/openclaw` mantiene el runtime y estado aislados del Gateway. Una migración de sistema operativo requiere adaptar la distribución de Node y verificar de nuevo el arranque. No se ha ensayado todavía una reinstalación completa en otro equipo.

## Fuentes de implementación

- Documentación y tipos de OpenClaw 2026.9.4 incluidos en el paquete instalado: `tool-plugin`, contexto de herramientas, configuración, permisos y `/tools/invoke`.
- [OpenClaw: tool plugins](https://docs.openclaw.ai/plugins/tool-plugins).
- [Google Calendar: altas e identificadores de eventos](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert).
- [Google Calendar: escrituras condicionales con ETag](https://developers.google.com/workspace/calendar/api/guides/version-resources).

No copiar configuraciones de versiones anteriores sin pasar `openclaw config validate`: por ejemplo, esta versión usa `agents.entries` y exige `agents.ownership: "explicit"` para estos cuatro agentes.
