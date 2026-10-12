# Memoria conversacional con Honcho

Honcho es opcional y se instala en el perfil de OpenClaw, separado del plugin familiar. Nido conserva preferencias explícitas, calendarios y permisos; Honcho captura conversaciones y recupera contexto anterior. Un recuerdo no concede permisos ni sustituye una lectura actual de preferencias o eventos.

## Servicio local

El recorrido local usa Docker Compose, PostgreSQL con pgvector, Redis, la API de Honcho y su worker de análisis. Solo la API publica un puerto, en `127.0.0.1:8000`. El almacenamiento local no implica inferencia local: los textos necesarios para extracción, resúmenes y embeddings se envían al proveedor configurado. Las credenciales de Google o del modelo de OpenClaw no se copian automáticamente.

Instala Docker y Compose; en macOS puede usarse Colima. Descarga el servidor oficial en `.runtime/honcho` y conserva su revisión para reproducir la instalación. Desde el checkout:

```sh
git clone https://github.com/plastic-labs/honcho.git .runtime/honcho
node scripts/honcho-local.mjs prepare
node scripts/honcho-local.mjs build
node scripts/honcho-local.mjs start
node scripts/honcho-local.mjs status
node scripts/honcho-local.mjs stop
```

Antes de `start`, configura `<NIDO_HOME>/honcho/.env`. El archivo inicial contiene `LLM_OPENAI_API_KEY` vacío para los modelos predeterminados del servidor. Para otros proveedores sigue la configuración oficial de la revisión instalada, incluidas sus opciones de embeddings. El script no imprime credenciales ni sobrescribe el archivo existente. `stop` conserva las bases de datos.

El servicio de este recorrido no exige autenticación y está limitado a loopback. No publiques ese puerto en la red; un despliegue remoto necesita su propia autenticación.

## Integración con OpenClaw

Instala el plugin oficial `@honcho-ai/openclaw-honcho`. La versión 1.7.0 añade sus herramientas y hooks sin ocupar el slot `memory`; puede usarse con `plugins.slots.memory: "none"`. No ejecutes la migración interactiva de archivos ni reemplaces las plantillas de Nido por las del proveedor.

Una vez verificado el servidor, configura `plugins.entries.openclaw-honcho` con `enabled: true`, `hooks.allowConversationAccess: true` y `config` con `baseUrl: "http://127.0.0.1:8000"` y un `workspaceId` exclusivo de la instalación. Incluye el plugin en `plugins.allow` y las cinco herramientas `honcho_*` en las listas permitidas de los agentes. `prepare:local` conserva esta entrada y habilita esas herramientas cuando el plugin está activado. No activa Honcho en instalaciones que no lo hayan configurado.

Cada agente tiene un peer propio. Los participantes se resuelven mediante los identificadores del canal; sin identificador, el plugin usa el peer de respaldo `owner`. En un dispositivo compartido, ese peer no identifica a una persona. No mezcles a todos los miembros bajo una identidad personal. El archivo de mapeo de peers debe ser privado y exclusivo de la instalación; el plugin admite `OPENCLAW_HONCHO_PEERS_FILE`.

El simulador `note4:chat` desactiva Honcho al copiar la configuración del Gateway: no captura ni recupera memoria de la familia. Una demo de memoria necesita un servicio/workspace y mapeo propios, con datos ficticios.

## Verificación y portabilidad

Comprueba captura y recuperación con dos sesiones ficticias en un workspace de pruebas. Verifica una corrección posterior y la separación de participantes. Cargar el plugin o recibir HTTP 200 de la API no demuestra que el worker haya producido recuerdos.

Honcho está ligado a la instalación mediante su workspace y sus peers, no al código del plugin Nido. Usarlo después desde Hermes exige alinear esas identidades y comprobar su integración; no presupone migración automática.

Fuentes: [plugin oficial](https://github.com/plastic-labs/openclaw-honcho), [servidor y despliegue local](https://github.com/plastic-labs/honcho).
