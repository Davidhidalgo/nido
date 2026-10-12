# Nido Family

Extensión de herramientas de OpenClaw para menú y agenda familiar. Generada con el CLI oficial y adaptada a los permisos de Nido.

<!-- Herramientas y autorización implementadas en src/index.ts y src/core.ts -->

Expone lectura, alta, modificación y borrado de eventos, y consulta/edición de preferencias. El agente de menú solo escribe en su calendario; agenda escribe en el familiar y en los calendarios adicionales autorizados explícitamente. `nido_calendars_list` devuelve los calendarios legibles con nombres, referencias, `shortName`, `readOnly` e `isDefault` para el agente. La identidad procede del contexto del runtime. El coordinador ve los esquemas para delegar, pero toda ejecución directa suya devuelve `FORBIDDEN` antes de acceder a datos. No expone terminal ni acepta payloads arbitrarios de Google. Los calendarios reales requieren OAuth y configuración explícita; el asistente ofrece una demo local y las operaciones requieren completar la configuración.

<!-- Instalación y ajustes de src/setup.ts, src/setup-admin.ts, src/control-ui.ts, src/calendar-admin.ts y ../../scripts/build-plugin.mjs -->

El plugin puede instalarse con configuración vacía en un OpenClaw existente. La página nativa **Nido**, disponible al activar **Settings → Labs → Custom plugin UI**, guía la creación de agentes, la demo y la autorización de la app compartida de Google de Nido. El botón **Conectar con Google** abre el consentimiento y detecta su finalización automáticamente. El distribuidor debe activar antes el [servicio OAuth](../../docs/google-oauth-service.md); mientras falte, el asistente ofrece la demo e indica que Google no está disponible. Los calendarios se seleccionan por nombre, con permisos por especialista y guardado administrativo. [Instalación](../../docs/getting-started.md).

La versión probada es OpenClaw 2026.9.8. `scripts/build-plugin.mjs` compila y empaqueta la interfaz mediante el SDK en un estado temporal; no lee `.local` ni modifica el dashboard del host. `scripts/openclaw-settings.mjs` sigue disponible únicamente como integración heredada opcional.

<!-- Comandos de compilación y prueba definidos en ../../package.json -->

Desde la raíz de Nido: `pnpm run build`, `pnpm run test` y `pnpm run typecheck`. La instalación compartida de dependencias vive en la raíz; no hace falta instalar un segundo node_modules aquí.

Los límites de consentimiento verbal y los pasos para conectar cuentas se describen en [la guía de inicio](../../docs/getting-started.md).

<!-- Identificación de comidas y cenas por menuSlot en src/core.ts -->

Los eventos nuevos llevan solo el nombre del plato. Se identifica comida o cena por `mealTimes` y la zona familiar, manteniendo la detección de duplicados. Si falta `mealTimes`, se mantienen los valores de compatibilidad 13:00 y 19:00. Los títulos antiguos con prefijo siguen siendo compatibles.

## Tarjetas NOTE4

<!-- Herramienta note4_mostrar de src/note4.ts, registrada en src/index.ts -->

`note4_mostrar` permite al agente `nido-note4` añadir o actualizar ocho vistas: texto, evento, cambio de plato, pregunta binaria, lista breve, ficha de datos, comparación y dato destacado. La vista de evento separa nombre, fecha, horario, lugar opcional y duración estimada; admite todo el día y citas que cruzan medianoche. Usa fechas y horas locales en la zona familiar y un último día inclusivo para mostrar. Las listas y fichas admiten de uno a tres elementos; comparación y destacado separan sus datos en campos propios. Solo texto y pregunta binaria admiten una pregunta. Guarda revisiones y respuestas en SQLite por conversación; devuelve la señal de aviso para preguntas o fallos. Menú y agenda no pueden publicar tarjetas y el coordinador NOTE4 no puede ejecutar directamente las herramientas familiares. El [simulador](../../docs/note4-voice.md) usa un Gateway y calendarios demo separados.

La descripción de la herramienta incluye formatos explícitos para texto y preguntas. Su entrada admite los alias `text` y `question` para el cuerpo en sus respectivas vistas y conserva un `summary` de texto como prefijo; normaliza y valida antes de guardar. El dispositivo recibe siempre `body`, con los límites originales. Los campos contradictorios o desconocidos se rechazan. Una publicación fallida se corrige sin repetir la delegación ni las escrituras del especialista.

<!-- Transporte NOTE4 de src/note4-device.ts, src/note4-home.ts y src/note4-http.ts; servicio de ../../scripts/note4-bridge.mjs -->

El servicio del dispositivo recibe audio por HTTPS, lo transcribe y continúa una conversación de `nido-note4`. Guarda los resultados por UUID, evita ejecutar otra vez un reenvío y acepta una sola respuesta por pregunta binaria. Una conversación nueva empieza tras un minuto desde el último resultado, o tres minutos si espera una respuesta a una pregunta. Las respuestas incluyen `sessionExpiresAt` para que el dispositivo vuelva a la pantalla inicial sin consultar la red; los sondeos no prolongan ese plazo. El firmware nuevo anuncia `X-Nido-Card-Version: 2`; a un cliente sin esa cabecera se le presentan las cuatro vistas nuevas como texto de hasta 240 caracteres, sin modificar el historial ni activar botones. Por defecto usa el Gateway y almacenamiento familiares con Google; `--demo` selecciona el entorno aislado. El endpoint autenticado `GET /v1/home[?date=YYYY-MM-DD]` proyecta quince días de comida, cena y agenda, sin notas ni identificadores originales de Calendar; incluye una clave opaca por calendario/evento para evitar tarjetas repetidas, fechas de inicio y fin inclusivas, eventos de todo el día, los que cruzan fechas y un contador de eventos no visibles. Los eventos de varios días ya iniciados tienen prioridad. El resumen añade `lunchPast` y `dinnerPast`: solo para comidas planificadas de hoy, desde dos horas después del horario configurado y en la zona horaria de la instalación. Se recalculan al sincronizar y permiten al firmware atenuar borde y sombra sin ocultar el plato. `POST /v1/session/dismiss` invalida una pregunta pendiente, sin ejecutar escrituras en Calendar. Una tarjeta `done` puede declarar `affectedDates`; el transporte expone `affectedDate` únicamente si hay una sola fecha, para que el firmware muestre ese día tras refrescarlo. La [guía de voz](../../docs/note4-voice.md) describe la configuración y sus límites.

El puente usa razonamiento bajo para el coordinador de voz. Sus instrucciones agrupan progreso y delegación cuando el destino es conocido; los especialistas siguen validando las lecturas y versiones antes de escribir.

<!-- local agent context from src/agent-context.ts and ../../scripts/note4-bridge.mjs -->

El bridge mantiene `agent-context.json` privado en `dataDir`, separado del resumen recortado del NOTE4. Conserva todos los eventos de la ventana consultada con alias de calendario, ID, ETag y campos completos, incluidos eventos terminados y los que no caben en pantalla. Actualiza al arrancar, cada cinco minutos, al leer el resumen y al finalizar un turno; inyecta el JSON en cada petición de voz. Un fallo conserva la última copia y marca el contexto obsoleto. Los especialistas pueden preparar una edición directamente con su ID y ETag; la herramienta verifica el evento actual antes de escribir.

Las consultas simples con contexto reciente se responden directamente desde Nido NOTE4, sin delegación al especialista ni tarjeta intermedia. Las modificaciones mantienen la delegación y la comprobación de versión. El JSON excluye metadatos de Google ajenos al comando (enlaces, creador y organizador), conservando los campos del evento y las señales de invitados/recurrencia.

<!-- Agenda calendar permissions from src/index.ts, src/core.ts, src/note4-home.ts and src/agent-context.ts -->

La configuración opcional `agendaCalendarIds` añade hasta diez calendarios a la agenda y a las herramientas de lectura. Los permisos por agente se configuran en `calendarAccess.menu` y `calendarAccess.agenda`: `read` y `write` contienen referencias `menu`, `family` o `calendar:<id>`; `defaultCalendar` selecciona el destino cuando una consulta de intervalo o alta no especifica calendario. Editar y borrar siempre requieren la referencia explícita. La escritura incluye crear, editar y borrar eventos puntuales y exige lectura. El calendario por defecto debe estar autorizado para lectura. Menú solo puede escribir en menú y agenda en los otros calendarios; los coordinadores no obtienen ejecución directa. Si una regla se omite, se conservan los valores anteriores (menú escribe `menu`, agenda escribe `family`; adicionales de solo lectura). `calendarNames` asigna nombres a los IDs configurados. `calendarShortNames` guarda etiquetas de hasta 16 caracteres para el pie izquierdo de las tarjetas de agenda, enviadas como `calendarLabel` sin exponer IDs; si no hay etiqueta, se omite. `writesEnabled=false` desactiva todas las escrituras; Google sigue aplicando sus permisos. El contexto conserva `sourceCalendarId`, una referencia `calendar:<id>` para cada calendario adicional y `readOnly` según configuración. Las herramientas comprueban el calendario de destino y el agente antes de acceder al adaptador. El menú sigue separado.

<!-- cancel endpoint from src/note4-http.ts and src/note4-device.ts -->

`POST /v1/turns/{uuid}/cancel` solicita la parada del turno activo. El bridge usa `chat.abort` sobre la sesión NOTE4, sin invocar otra respuesta del modelo; sus especialistas también se detienen mediante OpenClaw. El turno queda `cancelled` y no se reejecuta por reenvíos. Si no se confirma la parada, queda incertidumbre. Los resultados y escrituras ya ejecutados se conservan.

La variante `cancel?continue=1` conserva la conversación para una aclaración. Espera a que salga el worker previo antes de admitir otra petición, y el siguiente audio se marca una sola vez como continuación del encargo original. El bridge renueva el contexto y el agente debe comprobar las escrituras dudosas antes de repetir operaciones.

## Distribución

<!-- Empaquetado definido en ../../scripts/pack-plugin.mjs -->

`pnpm run plugin:pack` desde la raíz compila y crea un archivo instalable de OpenClaw con código, manifiesto e instrucciones genéricas. Los datos privados y el checkout completo no se empaquetan. Sigue [la guía de instalación del plugin](../../docs/plugin-install.md); después de instalarlo, su página Nido crea los agentes y guía la conexión de la cuenta.

## Mantenimiento NOTE4

<!-- RPC administrativos de src/note4-admin.ts, persistencia de src/note4-maintenance.ts y controles de src/note4-settings.ts y vinculación de src/note4-pairing.ts, src/note4-srp.ts, src/note4-discovery.ts; releases remotas de src/note4-github.ts -->

`note4Maintenance: { publicKeyFile: "/ruta/privada/firmware-public.pem", bridgeConfigFile: "/ruta/privada/note4/device.json" }` habilita vinculación y OTA. El plugin registra `nido.note4.status` (`operator.read`) y `nido.note4.discover`, `pairCode`, `pair`, `publish`, `update`, `resolve`, `githubCheck`, `githubDownload` (`operator.admin`), separados de herramientas familiares. La página nativa Nido permite buscar el NOTE4 y vincularlo con el código de su pantalla, añadir firmware firmado, solicitar una versión y reconciliar incertidumbre tras una observación reciente. El puente y plugin comparten `dataDir/note4-maintenance`, aislado por instalación; solo admite un dispositivo. Sin la opción permanece deshabilitado. El campo opcional `note4Maintenance.github.repository` (`propietario/repositorio`) permite buscar la última release estable y descargar su `.nidoota` firmado desde los ajustes, antes de solicitar la OTA. Sin repositorio no consulta GitHub; `github.tokenEnv` permite leer un token del entorno del Gateway si el repo es privado. [Configuración, credenciales, firmware y límites](../../docs/note4-maintenance.md).
