# Nido

Asistente familiar sobre OpenClaw, centrado en menú y agenda con Google Calendar. La familia habla con Nido; internamente hay especialistas con permisos distintos.

## Estado

<!-- Estado de implementación y límites descritos en docs/getting-started.md, docs/implementation-notes.md e integrations/trmnl/README.md -->

Nido se añade a un OpenClaw existente mediante un paquete y una página nativa de configuración. El asistente crea Nido, Menú y Agenda, reutiliza la configuración del modelo y guarda los datos familiares fuera del paquete. Permite empezar en demo o conectar Google y elegir calendarios por nombre. Telegram, TRMNL y NOTE4 son opcionales.

La versión probada del host es OpenClaw 2026.9.8. La interfaz requiere activar Custom plugin UI en los Labs del host. La conexión usa la app de Google de Nido: el usuario pulsa **Conectar con Google** y autoriza su cuenta. El servicio compartido todavía debe desplegarse y configurarse antes de distribuir una versión con Google activo; la demo funciona sin él. Siri y las mediciones de batería de NOTE4 siguen pendientes.

## Añadirlo a tu OpenClaw

<!-- Instalación y asistente de integrations/nido-family/src/setup-admin.ts, integrations/nido-family/src/control-ui.ts y docs/getting-started.md -->

Con el paquete revisado en el servidor de OpenClaw:

```sh
openclaw plugins install ./openclaw-plugin-nido-family-0.1.0.tgz
```

Abre el dashboard como administrador, activa **Settings → Labs → Custom plugin UI**, entra en **Nido** y sigue el asistente. Para Google, autoriza la app de Nido; no necesitas crear un proyecto de Google Cloud ni cargar un JSON. Revisa antes de guardar; puedes empezar con calendarios ficticios. [Guía de instalación](docs/getting-started.md).

El paquete todavía se genera desde el repositorio; no se presupone publicado en npm o ClawHub. [Empaquetado y capacidades](docs/plugin-install.md). El [perfil aislado](docs/standalone-install.md) queda disponible para desarrollo o un despliegue independiente.

<!-- Lectura de documentos configurada en scripts/prepare-local.mjs, integrations/nido-family/src/setup.ts y agents/nido/AGENTS.md -->

Nido usa la herramienta `pdf` de OpenClaw para leer adjuntos antes de delegar. El plugin hereda los límites del host; el perfil aislado configura 10 MB y 20 páginas por documento.

<!-- Comandos NOTE4 de package.json y aislamiento en scripts/note4.mjs -->

Para probar el agente NOTE4 y ver sus tarjetas JSON: `pnpm run note4:chat -- --message="¿Qué cenamos mañana?"`. Usa calendarios demo separados incluso si Nido está conectado a Google. `pnpm run note4:dashboard` permite inspeccionar después la conversación en su dashboard demo. [Instrucciones y límites](docs/note4-voice.md).

<!-- Comandos de firmware en package.json, scripts/note4-firmware y firmware/note4/README.md -->

El firmware conectado genérico admite configuración por punto de acceso propio (frontal + inferior cinco segundos) y OTA firmada desde los ajustes administrativos del plugin o la web local. Tras guardar la Wi-Fi, muestra un código de seis dígitos para vincularlo desde los ajustes del plugin, con búsqueda local y alternativa por IP. Desde `nido-ota-0.4.2`, el NOTE4 consulta directamente la última release pública de `Davidhidalgo/nido` al entrar en mantenimiento y pide aceptación con el botón superior antes de instalar. El plugin también puede obtener el firmware firmado de la última release de GitHub cuando se configura `note4Maintenance.github.repository`. Conserva Wi-Fi y vinculación en una partición propia, con dos aplicaciones y rollback. Requiere una primera migración USB respaldada; funcionamiento físico pendiente de verificación. [Guía de mantenimiento y OTA](docs/note4-maintenance.md).

`pnpm run note4:setup` prepara el puente HTTPS y `pnpm run note4:bridge` recibe audio y sirve tarjetas en la red local, con el Gateway familiar arrancado. Usa los calendarios de Google ya configurados en Nido; `pnpm run note4:bridge -- --demo` selecciona el Gateway demo. `pnpm run test:note4-firmware` verifica audio, renderizado y protecciones del respaldo en el Mac. `pnpm run note4:firmware build` compila la prueba para NOTE4; el flasheo exige primero un respaldo completo y verificado. [Firmware y prueba de batería](firmware/note4/README.md).

## Documentación

<!-- Documentos existentes en docs/ -->

- [Arquitectura](docs/architecture.md).
- [Memoria conversacional con Honcho](docs/memory.md).
- [Guía para desarrollar y diagnosticar](docs/development.md).
- [Organización de datos y archivos privados](docs/data-layout.md).
- [Plugin instalable en OpenClaw](docs/plugin-install.md).
- [Servicio OAuth compartido y publicación de la app de Google](docs/google-oauth-service.md).
- [Privacidad y preparación para GitHub](docs/privacy.md).
- [Plan del MVP y respaldos aplazados](docs/implementation-plan.md).
- [Instalación y configuración familiar](docs/getting-started.md).
- [Perfil aislado para desarrollo o un servidor independiente](docs/standalone-install.md).
- [Decisiones de implementación y datos locales](docs/implementation-notes.md).
- [Resultado de verificación](docs/verification.md).
- [Conversación NOTE4 y pruebas de tarjetas JSON](docs/note4-voice.md).
- [Sistema de diseño del NOTE4](docs/note4-design-system.md).

## Desarrollo

<!-- Scripts de calidad definidos en package.json -->

`pnpm test`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check` y `pnpm run build`. `pnpm run test:plugin:isolated` instala el paquete en un host temporal con un agente existente y verifica el asistente. `pnpm run test:gateway:isolated` verifica permisos y operaciones contra un Gateway demo temporal, sin leer la instalación familiar.

Para continuar el desarrollo empieza por [AGENTS.md](AGENTS.md) y la [guía de desarrollo](docs/development.md). El contexto reutilizable está en el repo con datos ficticios; no necesitas el historial de chats ni diagnósticos privados.

<!-- Estado privado de scripts/private-state.mjs y preparación de scripts/prepare-local.mjs -->

La memoria conversacional opcional usa Honcho mediante su plugin de OpenClaw. La preparación conserva su configuración; el simulador NOTE4 desactiva Honcho para evitar mezclar recuerdos demo y familiares. Véase [memoria conversacional](docs/memory.md).

El plugin integrado guarda datos bajo `<estado-de-OpenClaw>/nido-family/`. En el perfil aislado del repositorio, los datos privados viven en `~/.openclaw/nido/` (o el `NIDO_HOME` elegido al configurar). `.local` es un enlace ignorado hacia ese directorio. Las instrucciones públicas contienen solo reglas genéricas; los miembros y horarios se añaden en workspaces privados. Las preferencias alimentarias se guardan hablando con el agente. Las familias demo permanecen en ese estado; el archivo privado de desarrollo y las cachés tienen otra función, descrita en [la organización de datos](docs/data-layout.md).

<!-- Comprobación y empaquetado de scripts/release-check.mjs, config/public-assets.json y scripts/pack-plugin.mjs -->

Antes de publicar ejecuta `pnpm run release:check`: revisa archivos, índice e historial de publicación sin abrir el estado privado. Los binarios públicos deben coincidir con los hashes revisados de `config/public-assets.json`; las imágenes de diseño y sonidos del dispositivo usan datos ficticios o sintéticos. Revisa también el texto libre y la identidad del primer commit según [la guía de privacidad](docs/privacy.md). `pnpm run plugin:pack` genera el paquete en `release/` con una lista explícita de archivos. No publica en npm ni GitHub.
