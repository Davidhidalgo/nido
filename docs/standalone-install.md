# Perfil aislado de Nido (desarrollo y despliegues independientes)

Si ya tienes OpenClaw, utiliza [la instalación del plugin](getting-started.md). Este recorrido crea otro perfil y es opcional.

Necesitas Node 24.16 o posterior de la rama 24 (la versión probada está en `.nvmrc`), pnpm 9.0.5 y un shell en macOS, Linux o WSL2. Nido funciona en español. El firmware NOTE4 tiene requisitos adicionales y es opcional.

## 1. Instalar desde una copia limpia

Desde la raíz del repositorio:

```sh
nvm use # si usas nvm; nvm install instala la versión si aún no existe
node scripts/install-local.mjs
pnpm install --frozen-lockfile
pnpm run setup
pnpm run build
pnpm run check:config
```

El primer comando de instalación prepara la versión fijada de OpenClaw en `.runtime/`. El asistente pregunta por zona horaria, miembros y horarios. Empieza con `demo` para probar sin conectar Google. Para preparar una demo sin preguntas usa `pnpm run setup -- --defaults`.

Todo el estado privado vive por defecto en `~/.openclaw/nido/`. Puedes elegir otra carpeta externa con `NIDO_HOME=/ruta/privada pnpm run setup`. `.local` es un enlace ignorado hacia esa carpeta para conservar la compatibilidad de los comandos y del firmware. El asistente migra una antigua carpeta `.local` mediante un movimiento, preservando las bases de datos y credenciales. Rechaza destinos existentes para evitar mezclar dos familias. La migración automática requiere el mismo sistema de archivos.

Nido usa un perfil separado del OpenClaw global. Su Gateway escucha por defecto en `127.0.0.1:18789`; el asistente permite elegir otro puerto si ya lo estás usando. Los puertos 18790 y 18791 están reservados para NOTE4. Para añadir Nido a una instalación existente, sigue [la guía del plugin](plugin-install.md).

## 2. Conectar el modelo y arrancar

```sh
./scripts/openclaw configure --section model
pnpm run prepare:local
pnpm run check:config
pnpm run start
```

Selecciona un modelo compatible y proporciona sus credenciales en el configurador local. La selección inicial es una referencia configurable, no incluye acceso ni saldo. El generador conserva el modelo y la autenticación; vuelve a aplicar las políticas del perfil aislado de Nido.

En otro terminal ejecuta `pnpm run dashboard`. No compartas su enlace autenticado. Selecciona Nido y conversa. Detén el Gateway con Ctrl+C; no se instala un servicio de arranque automático.

## 3. Probar y guardar preferencias

```sh
pnpm run demo:seed
```

Prueba «Organiza las cenas de esta semana», rectifica un plato y crea una cita ficticia. Los resultados deben identificarse como demo. Después puedes decir:

> Recuerda como preferencia de nuestra familia que preferimos cenas ligeras. Confírmame qué has guardado.

Las preferencias se guardan en SQLite, por persona o para la familia, y pueden tener caducidad. El agente puede consultarlas, corregirlas y eliminarlas. No edites `agents/*/AGENTS.md` con datos personales: son plantillas públicas. La demo y Google tienen bases distintas; las preferencias de prueba no pasan automáticamente al entorno real.

Members, time zone, and meal times are configured with `pnpm run setup` or in `.local/family.json`, followed by `pnpm run prepare:local`. These are operational settings; mentioning them in a conversation does not change the administrative configuration. The generator includes them in private instructions. Meal times guide scheduling and NOTE4 dimming; existing menu events are classified by chronological order within each local day, as described in [architecture](architecture.md). Food preferences are managed through conversations with the agent.

## 4. Conectar Google Calendar

1. Habilita Google Calendar API en tu proyecto de Google Cloud y crea un cliente OAuth de tipo Desktop.
2. Guarda el JSON descargado en `.local/google-client.json`.
3. Ejecuta `pnpm run google:connect` y abre el enlace en el navegador del mismo equipo. No se realiza ninguna escritura en calendarios durante la autorización.
4. Ejecuta `pnpm run setup`, selecciona `google`, introduce IDs distintos para menú y agenda y deja las escrituras desactivadas durante la primera comprobación.
5. Compila, valida y reinicia el Gateway. Comprueba lecturas; después activa escrituras con el asistente cuando quieras usarlo.

`agendaCalendarIds` permite añadir hasta diez calendarios en `.local/family.json`. Por defecto son de solo lectura. Incluye sus referencias `calendar:<id>` en `calendarAccess.agenda.read` y `calendarAccess.agenda.write` para que agenda pueda crear, editar y borrar eventos puntuales; el menú mantiene permisos separados. `calendarNames` relaciona IDs configurados con nombres legibles. `calendarShortNames` guarda el nombre corto de cada calendario (máximo 16 caracteres) para el pie izquierdo de las tarjetas de agenda. `calendarAccess.menu` y `calendarAccess.agenda` definen `read`, `write` y `defaultCalendar` por agente. Si omites la regla de un agente, mantiene los permisos anteriores y el predeterminado `menu` o `family`. El predeterminado se usa al consultar un intervalo o crear sin especificar calendario; editar y borrar requieren siempre la referencia del evento. `writesEnabled` controla todas las escrituras y Google debe conceder acceso `writer` u `owner`.

Para autorizar por nombre un calendario ya compartido con la cuenta conectada, compila y revisa primero la vista previa del comando de operador:

```sh
pnpm run build
node scripts/calendar-access.mjs --writable-name="Calendario de ejemplo"
node scripts/calendar-access.mjs --writable-name="Calendario de ejemplo" --apply
pnpm run prepare:local
```

Puedes repetir `--writable-name` para varios calendarios o usar `--readable-name="Calendario de ejemplo"` para añadir uno de consulta. Si el propietario va a ampliar un acceso que ahora es de lectura, `--pending-writable-name="Calendario de ejemplo"` permite preparar el permiso local: las escrituras seguirán fallando hasta que Google conceda acceso. El comando verifica los permisos de Google, conserva la configuración anterior en un respaldo privado y no lee ni modifica eventos. No concede permisos en Google. Tras preparar la configuración, recarga el Gateway y el puente NOTE4 si está en uso para actualizar herramientas, instrucciones y contexto.

Nido no distribuye un cliente OAuth compartido: cada instalación configura el suyo. Esta es la parte más técnica de la instalación actual. La configuración del consentimiento de Google determina la duración de la autorización; una respuesta `invalid_grant` exige reconectar.

## 5. Canales y dispositivos opcionales

Para Telegram crea un bot con BotFather, ejecuta `pnpm run telegram:setup` y reinicia el Gateway. Cada familiar debe enviar un mensaje. Consulta `./scripts/openclaw pairing list telegram`, contrasta los códigos con esas personas y añade únicamente sus IDs numéricos a `channels.telegram.allowFrom` en `.local/openclaw/openclaw.json`. Ejecuta `pnpm run prepare:local`, valida y reinicia. El generador conserva esa lista y activa `allowlist`. Los grupos están deshabilitados.

NOTE4: [guía de voz](note4-voice.md) y [firmware](../firmware/note4/README.md). TRMNL: [integración](../integrations/trmnl/README.md). No necesitas ninguno para usar el chat web.

## Datos privados y actualizaciones

- `.local/family.json`: miembros, zona, horarios e IDs de calendarios.
- `.local/family-data/{demo,google}/nido.sqlite`: preferencias y operaciones.
- `.local/openclaw/`: credenciales del modelo, configuración y conversaciones.
- `.local/workspaces/`: instrucciones generadas y adjuntos de los agentes.
- `.local/note4/`: configuración del dispositivo, audio y respaldos del firmware.

Estas rutas resuelven al directorio privado externo. Las familias demo también permanecen allí; los experimentos históricos de desarrollo se archivan aparte. Consulta [la organización de datos](data-layout.md). `prepare:local` actualiza solo el archivo generado `AGENTS.md` de cada workspace, no sus adjuntos ni conversaciones. Tras actualizar el código, ejecuta `pnpm install --frozen-lockfile`, `pnpm run build`, `pnpm run prepare:local` y `pnpm run check:config`; reinicia después los procesos activos. No borres el directorio privado al retirar un checkout si quieres conservar los datos. Nido no configura copias de seguridad automáticas.

## Límites

Las pruebas automáticas usan calendarios simulados y HTTP de Google simulado. No equivalen a validar tus credenciales o la calidad conversacional de un modelo. No se editan recurrencias ni eventos con invitados; no hay transacciones entre varios eventos. Ante una escritura incierta hay que releer antes de repetirla. Las mediciones de batería del NOTE4 y Siri siguen pendientes.
