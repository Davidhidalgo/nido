# Nido por voz en NOTE4 DevKit

Primer corte implementado el 30 de septiembre de 2026: agente `nido-note4`, herramienta real `note4_mostrar` y simulador de conversaciones con tarjetas JSON. Hay también una [prueba de firmware](../firmware/note4/README.md), comprobada en hardware para despertar con el frontal, capturar audio local, dibujar una tarjeta y entrar en reposo profundo; se verificó además la interrupción del RTC. El corte conectado añade envío HTTPS de audio, transcripción en Nido y tarjetas en el dispositivo; la validación física de esa ruta y la medición de consumo se registran en [verificación](verification.md).

## Experiencia

El frontal mantenido será el canal de voz. Las peticiones entendidas se ejecutan directamente; no hay Jev, planes pendientes ni cuenta atrás. El agente publica pronto un acuse de recibo y confirma resultados únicamente tras las herramientas. Los especialistas mantienen sus permisos y comprobaciones de versiones.

La conversación del dispositivo conserva contexto y preguntas pendientes; tras un minuto desde un resultado o tres minutos desde una pregunta pendiente, el siguiente mensaje abre otra sesión. El simulador mide la inactividad desde que termina el turno. Una pregunta caducada no acepta botones; se inicia otra conversación. El dispositivo es compartido y no se asume quién habla.

Deshacer es una petición normal de la conversación. Una rectificación de plato puede revertirse con el título anterior conocido y comprobando que no haya ediciones posteriores. No se ha implementado una compensación universal ni restauración automática de borrados; no se promete deshacer cuando falta el contenido anterior. La lista de compra tampoco tiene backend todavía.

## Probar la conversación

<!-- Script note4:chat de ../package.json y opciones de ../scripts/note4.mjs -->

Desde la raíz:

```sh
./scripts/pnpm run build
./scripts/pnpm run prepare:local
./scripts/pnpm run note4:chat -- --message="¿Qué cenamos mañana?"
./scripts/pnpm run note4:chat -- --message="Cámbiala por tortilla con ensalada"
./scripts/pnpm run note4:chat -- --message="Deshaz ese cambio"
./scripts/pnpm run note4:chat -- --cards
```

El comando inicia un Gateway temporal en loopback, puerto 18790, con estado/configuración independientes en `.local/note4/`. Termina ese Gateway al acabar el turno. Reutiliza el modelo configurado y la ubicación de credenciales de agentes; si un agente no tiene modelo explícito, hereda el elegido para Nido en la configuración demo; necesita acceso válido al proveedor y conectividad. Nunca usa Calendar real: crea calendarios demo separados incluso si Nido está en modo Google. No usa Telegram ni publica mensajes externos.

La llamada al modelo es real y puede consumir uso del proveedor. Los datos del calendario son simulados. El comando imprime cada tarjeta JSON durante el turno; también muestra la salida del agente. `--cards` muestra el registro persistente de la conversación, incluidas revisiones y respuestas. `--new` abre una conversación nueva. Un lock evita ejecutar dos turnos del simulador a la vez; si el proceso se termina a la fuerza, comprobar que ya no esté activo antes de retirar `.local/note4/conversation.lock`.

Para probar preguntas binarias:

```sh
./scripts/pnpm run note4:chat -- --message="Pregúntame con dos botones si prefiero tortilla o sopa; espera mi respuesta sin guardar nada."
./scripts/pnpm run note4:chat -- --answer=upper --card=ID_DE_LA_TARJETA
```

`upper` elige la primera opción e `lower` la segunda. La respuesta entra en la misma conversación con el identificador de pregunta. Una tarjeta respondida o cerrada no admite otro clic. Si el turno falla después de registrar el clic, la respuesta queda pendiente para reenviarla usando `./scripts/pnpm run note4:chat -- --retry`. No afirmar éxito cuando el modelo no haya terminado.

Los calendarios del simulador empiezan vacíos. Para ensayar un cambio con un antes/después, pide primero al agente guardar una cena de prueba. La misma sesión se utiliza en todos los turnos dentro del plazo.

## Ver la conversación en el dashboard

<!-- Script note4:dashboard de ../package.json y Gateway de ../scripts/note4-dashboard.mjs -->

Después de terminar una prueba, ejecuta `./scripts/pnpm run note4:dashboard`. Mantiene abierto el Gateway demo en `http://127.0.0.1:18790`; las sesiones y transcripciones de las pruebas permanecen en su estado local. En el dashboard selecciona la conversación de `nido-note4`; las llamadas y resultados de `note4_mostrar` forman parte de su historial de herramientas. Este corte no renderiza tarjetas ni botones dentro del dashboard: permite inspeccionar su JSON y continuar escribiendo respuestas de texto.

La autenticación utiliza el token del Gateway demo guardado en `.local/note4/openclaw/openclaw.json`; no compartirlo. Cuando Codex abre la vista puede incluirlo en el fragmento de autenticación local. El dashboard familiar de puerto 18789 usa otro estado y no contiene estas sesiones de prueba.

Mientras el dashboard demo esté abierto, usa su chat web. Detén su proceso antes de ejecutar otro turno con `note4:chat` o simular un botón: ambos comandos comparten un lock para no arrancar dos Gateways ni cambiar la configuración mientras hay un turno activo.

## Contrato de pantalla

<!-- Esquema note4Definition y registro note4Events de ../integrations/nido-family/src/note4.ts -->

La herramienta solo puede ejecutarla `nido-note4`, con identidad y sesión procedentes de OpenClaw. El agente llama realmente a la herramienta; escribir JSON en la respuesta final no publica una tarjeta.

```json
{
  "operation": "append",
  "cardId": "cena-manana",
  "status": "progress",
  "title": "Revisando el menú",
  "view": { "type": "text", "body": "Voy a revisar la cena de mañana…" }
}
```

`append` añade una tarjeta nueva; `update` reemplaza una existente de esa conversación conservando todas sus revisiones en el historial. `cardId` admite letras ASCII, números, guion y guion bajo, hasta 64 caracteres. El texto de las tarjetas es Unicode.

La herramienta describe ejemplos completos de texto y pregunta para los runtimes que resumen `view` como `unknown`. En su entrada admite `text` como alias de `body` en una vista de texto y `question` como alias de `body` en una vista binaria; un `summary` de texto se conserva delante del cuerpo, separado por un salto de línea. Rechaza valores contradictorios entre cuerpo y alias, campos desconocidos o texto combinado que exceda los límites. El historial y el dispositivo reciben siempre el contrato de la tabla siguiente, sin esos alias. Las reglas de estado, identidad, revisiones y respuestas no cambian.

| Campo            | Valores / límites                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| status           | progress, question, done, partial, error                                                                             |
| title            | 1–60 caracteres                                                                                                      |
| view text        | body de 1–240 caracteres; también para preguntas abiertas                                                            |
| view meal_change | date ISO, meal comida/cena, before/after de 1–120 caracteres                                                         |
| view event       | summary hasta 120; date/endDate ISO; startTime/endTime HH:mm; allDay, durationEstimated; location opcional hasta 120 |
| view binary      | body y exactamente dos opciones con label de 1–40 y answer de 1–120 caracteres                                       |
| view list        | items de 1–3 elementos, label de 1–60 y detail opcional de 1–80                                                      |
| view facts       | items de 1–3 pares, label de 1–24 y value de 1–80                                                                    |
| view compare     | beforeLabel/afterLabel de 1–20 y before/after de 1–120                                                               |
| view highlight   | value de 1–40, caption de 1–60 y body opcional de 1–120                                                              |

Las cuatro vistas nuevas son informativas, sin botones; no admiten `status question`. Usa listas para consultas breves de menú o agenda, fichas para datos confirmados, comparaciones para dos alternativas o un cambio, y destacado para una respuesta directa. Las propuestas deben identificarse como tales, sin afirmar que ya se han aplicado. Los límites son máximos de transporte: el firmware recorta con «…» según el espacio disponible. El agente prioriza títulos y valores breves y avisa si muestra solo una selección de resultados.

Las preguntas binarias solo admiten status question. Hay una sola pregunta pendiente por sesión. El orden de las opciones define la asignación a botones; sus respuestas deben ser diferentes. El agente puede cerrar una pregunta actualizándola o el usuario responder con el simulador.

La vista `event` separa nombre, fecha, horario y lugar. Sus fechas y horas son locales en la zona horaria familiar configurada; `endDate` es inclusivo para la presentación. En citas de todo el día, las horas son cadenas vacías y `durationEstimated` es false; el agente convierte el final exclusivo de Calendar al último día visible. Se rechazan fechas inexistentes e intervalos incoherentes. Los resultados de varias citas pueden usar una lista de hasta tres elementos; los casos que no caben usan texto.

La salida incluye `alert`: none para progreso y éxito, attention para preguntas, failure para errores y resultados parciales. El simulador representa la señal en JSON; no emite audio. El firmware conectado emite un tono breve para errores o resultados parciales.

Cada entrada del historial contiene sequence, cardId, kind, alert y data. Las llamadas repetidas con el mismo identificador de herramienta no duplican la tarjeta. El mismo identificador no puede publicar otro contenido. SQLite guarda el historial local con permisos privados y lo separa por sesión. En este corte no hay política de purga; `--cards` devuelve el registro completo de la sesión.

## Agente y especialistas

<!-- Instrucciones de ../agents/nido-note4/AGENTS.md y ../agents/agenda/AGENTS.md y permisos de ../scripts/prepare-local.mjs -->

`nido-note4` delega en menú o agenda y conserva la sesión del especialista para continuar aclaraciones. Solo él publica las tarjetas. Los especialistas reciben el contexto del canal NOTE4 y devuelven datos anteriores/resultantes al rectificar. El coordinador sigue sin poder ejecutar herramientas familiares directamente; no tiene terminal, filesystem ni navegador.

Para reducir llamadas consecutivas, sus instrucciones piden publicar el progreso y delegar en el mismo paso cuando el destino esté claro. No consulta los destinos conocidos de rutina ni sobrescribe el modelo del especialista. Las consultas y cambios concretos se delegan con razonamiento bajo; la planificación con varias restricciones puede usar medio.

El coordinador comprueba la publicación y, si falla, corrige únicamente la tarjeta, usando texto sencillo cuando sea necesario y conservando el resultado del especialista. En herramientas por código usa `Promise.allSettled` para conservar por separado el resultado de publicación y delegación. Una publicación fallida no autoriza a repetir una delegación o una escritura familiar, ni a sustituir la tarjeta por texto de chat.

Para una cita con inicio conocido, agenda estima la duración si falta y guarda sin preguntar por el fin. La tarjeta `event` muestra la fecha y el intervalo realmente guardados con «(estimada)» en pequeño a la derecha del horario cuando corresponda. Una corrección por voz continúa con el especialista y actualiza el mismo evento; cambiar solo el inicio conserva la duración, mientras que un fin o duración explícitos sustituyen la estimación. Las fechas, inicios o personas imprescindibles que falten y los eventos ambiguos siguen requiriendo aclaración. Las tarjetas omiten instrucciones de uso; el firmware muestra los iconos de batería y conexión. Cambiar esta política solo requiere actualizar las instrucciones; la nueva vista `event` sí requiere la versión de firmware que la interpreta y dibuja.

El agente elige la vista y decide cuándo añadir o actualizar. Esta conducta se guía por instrucciones, no por un controlador determinista que garantice una tarjeta final por turno. Los fallos del runtime se imprimen en el simulador; un futuro servicio de dispositivo tendrá que convertir desconexiones y timeouts en avisos visibles.

## Hearth como base del firmware

Fuente inspeccionada: [shantanugoel/hearth](https://github.com/shantanugoel/hearth), commit `edd75fd7ea7e9879b141a84aa39ce2c74b6c92bc`. No se ha compilado ni instalado en el dispositivo.

| Pieza                             | Hallazgo en el código                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| hearth_gfx / HearthCanvas         | Canvas C++ propio, sin LVGL, 400 × 300 monocromo, buffer de 15.000 bytes                           |
| app_main.cc / Paint y ChangedRows | Comparación de filas y refresco parcial de la franja cambiada; completo si pierde la base          |
| zectrix_epd                       | Driver SSD2683, operaciones síncronas                                                              |
| HearthCanvas::Text                | Solo ASCII; requiere decodificar UTF-8 y añadir glifos de español                                  |
| hearth_audio.cc                   | WAV PCM16 mono a 16 kHz, buffer PSRAM y grabación mientras se mantiene pulsado; main limita a 12 s |
| zectrix_board                     | ES8311, espressif/esp_codec_dev ~1.5 y control de alimentación                                     |
| hearth_net.cc                     | esp_http_client y tarea de red dedicada                                                            |
| hub                               | Python, cola STT y agente Hermes; sustituir la conexión por Nido                                   |
| sim                               | Compila el mismo canvas/pantallas en el ordenador y genera PNG                                     |

La limitación ASCII pertenece a su fuente, no al dispositivo. Podemos dibujar tarjetas, iconos, ajustes de línea y español con el mismo canvas. La atención de botones durante refrescos síncronos se validará en hardware.

## Audio y tarjetas en el dispositivo

<!-- Servicio y configuración de ../scripts/note4-bridge.mjs, ../scripts/note4-setup.mjs y ../integrations/nido-family/src/note4-device.ts -->

El NOTE4 envía WAV PCM16 mono a 16 kHz por HTTPS a un servicio local del Mac. OpenClaw transcribe con el proveedor configurado para Nido; el agente `nido-note4` recibe la petición en una conversación persistente y publica tarjetas con `note4_mostrar`. El dispositivo hace un único envío de audio; internamente hay una etapa de transcripción y otra de conversación. No presupone que el modelo de conversación acepte audio directamente.

Arranca primero el Gateway familiar (`pnpm run start`), ejecuta `pnpm run note4:setup`, `pnpm run build` y `pnpm run note4:bridge`. Después configura Wi-Fi y vinculación desde el punto de acceso del NOTE4; [guía de mantenimiento y OTA](note4-maintenance.md). La primera carga usa el firmware genérico con respaldo, según [sus instrucciones](../firmware/note4/README.md). El servicio usa HTTPS con un certificado local y token exclusivo del NOTE4; el Gateway permanece en loopback.

El puente usa por defecto `.local/openclaw/openclaw.json`, los calendarios de Google y el almacenamiento familiar de Nido. `nido-note4` delega en los mismos agentes `menu` y `agenda` de ese Gateway; no selecciona IDs de calendario desde el dispositivo. Respeta `writesEnabled` y requiere OAuth vigente. Las conversaciones aparecen en el dashboard familiar, normalmente `http://127.0.0.1:18789`.

El puente solicita `--thinking low` al coordinador NOTE4. Esto conserva el modelo configurado y limita el esfuerzo de razonamiento de esta entrada de voz; los especialistas mantienen la comprobación de eventos y ETags. La velocidad depende también del proveedor, las llamadas necesarias y el refresco del dispositivo: una compilación o una consulta rápida no garantizan un tiempo fijo.

Para una prueba aislada usa `pnpm run note4:bridge -- --demo` con el dashboard demo del puerto 18790 arrancado. El simulador `note4:chat` sigue siendo exclusivamente demo. El cambio de destino del puente no requiere flashear: conserva endpoint y token HTTPS, pero usa otro estado de conversación. No copia las conversaciones ni datos demo al entorno familiar.

El servicio acepta `POST /v1/turns/UUID` con `audio/wav`, devuelve el acuse inmediatamente y permite consultar tarjetas mediante `GET` a la misma ruta. Una respuesta binaria usa el mismo `POST` con JSON `{turnId, cardId, button}` y un UUID nuevo. Los UUID repetidos con el mismo contenido no ejecutan otro turno; respuestas a otra tarjeta, duplicadas o caducadas se rechazan. El firmware con las ocho vistas envía `X-Nido-Card-Version: 2`. Para un firmware anterior, el servicio convierte las cuatro vistas nuevas a texto de hasta 240 caracteres, conservando identificador, estado e historial. Esta compatibilidad permite actualizar el agente antes de volver a cargar el dispositivo. El token fijo identifica un único dispositivo; el cliente no elige sesión, modelo ni agente.

El último resultado queda guardado por turno. Tras un fallo o reinicio con posibles efectos, se comunica incertidumbre y no se reejecuta automáticamente. El usuario puede pedir por voz que Nido consulte lo ocurrido o lo deshaga con su contexto. La conversación caduca un minuto después de completar un resultado, o tres minutos si espera una respuesta; consultar tarjetas no renueva ese plazo. Las respuestas incluyen `sessionExpiresAt` en segundos Unix para cerrar la modal y volver al resumen de hoy con los datos disponibles, sin exigir una consulta al servidor.

Wi-Fi se apaga al terminar cada intercambio. El modo conectado usa reposo ligero con pantalla y audio apagados para permitir ambos laterales, incluido el superior, que no puede despertar del reposo profundo. El resumen muestra comida, cena y agenda en tarjetas con sombra, con cabecera compacta sin logo. Las ocho vistas del agente aparecen en modales sobre el resumen atenuado. Las preguntas se responden por voz o con los laterales cuando son binarias; al caducar la conversación se vuelve a hoy. Los fallos del agente se explican en una modal; los de actualización del resumen muestran solo un icono. La batería baja aparece únicamente con lectura válida inferior al 20%. Falta medir corriente de esta nueva versión desde batería.

El endpoint `GET /v1/home` (o `?date=YYYY-MM-DD`) usa el mismo token HTTPS y entrega quince días alrededor de la fecha consultada. Solo lee los calendarios ya configurados; no llama al agente ni escribe en Google. La navegación dentro del bloque descargado es local. El firmware refresca cada cinco minutos y aprovecha los clics y resultados para descargar datos recientes, sin renovar por ello la conversación. `POST /v1/session/dismiss` abandona una pregunta y su sesión; no permite reactivar los botones antiguos.

Una modificación confirmada se declara en la tarjeta `done` mediante `affectedDates`, con todas las fechas anteriores y nuevas afectadas. Si hay exactamente una, el firmware muestra ese día después de refrescarlo; una consulta o modificación de varias fechas conserva el contexto. El [sistema de diseño](note4-design-system.md) mantiene las reglas y el flujo.
