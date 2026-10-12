# Arquitectura de Nido

El producto es un conjunto de agentes sobre OpenClaw con un plugin TypeScript y clientes opcionales. El modelo interpreta peticiones; el plugin aplica permisos y modifica los datos. No hay un servidor de aplicación alternativo que sustituya al Gateway.

## Integración en un host existente

El paquete se instala sin configuración familiar obligatoria. `src/setup-admin.ts` registra RPC solo administrativos y conecta con el servicio OAuth compartido de Nido. El navegador autoriza la app común de Google y el Gateway recoge el resultado mediante una prueba privada; no recibe retornos OAuth públicos. `src/control-ui.ts` aporta una página mediante el SDK nativo de OpenClaw. Requiere el consentimiento del host para Custom plugin UI; no se modifica su código.

`src/setup.ts` prepara workspaces privados, compara la versión dentro de la transacción de configuración del host y añade únicamente los agentes de Nido. Un marcador de operación permite reconciliar respuestas perdidas. Conserva el agente existente como propietario del sistema cuando amplía un host de un solo agente. No cambia canales, credenciales del modelo ni políticas globales; hereda su autenticación compartida disponible. `src/session-policy.ts` limita a Nido el acceso a sesiones de sus propios especialistas aunque el host tenga visibilidad global.

Los agentes solo acceden a herramientas operativas: el asistente, Google OAuth y el cambio de permisos son superficies administrativas. La configuración parcial no habilita operaciones familiares hasta disponer de una configuración completa. Los perfiles aislados del repositorio conservan su generador independiente.

## Autorización compartida de Google

`scripts/nido-oauth-service.mjs` recibe el retorno del cliente Web de Google en una URL HTTPS fija, con state, PKCE y cookie de navegador. Mantiene solicitudes temporales en SQLite y cifra verificadores y permisos con AES-256-GCM. El plugin guarda un permiso opaco y lo usa para obtener tokens de acceso del servicio; llama a Calendar directamente. El secreto Web y la clave de cifrado pertenecen al despliegue del servicio y no se empaquetan. Las credenciales Desktop anteriores siguen soportadas por `google.ts`. [Despliegue, dependencias y privacidad](google-oauth-service.md).

## Recorrido de una petición

1. El chat web o Telegram llega a `nido`. NOTE4 llega al puente HTTPS, que transcribe audio y habla con `nido-note4`.
2. El coordinador delega en `menu` o `agenda` cuando necesita herramientas familiares. NOTE4 puede responder consultas inequívocas con su contexto reciente de solo lectura.
3. La factory de herramientas de `integrations/nido-family/src/index.ts` obtiene agente y sesión del runtime. `core.ts` verifica permisos antes del acceso a datos.
4. El adaptador demo utiliza SQLite. El adaptador Google de `google.ts` utiliza OAuth y Calendar API. Ambos implementan `CalendarPort`.
5. Las preferencias y operaciones persisten en SQLite. NOTE4 añade tarjetas y turnos persistentes; el firmware representa el resultado.

| Agente       | Escrituras permitidas                         | Delegación    |
| ------------ | --------------------------------------------- | ------------- |
| `nido`       | Ninguna escritura familiar directa            | Menú y agenda |
| `menu`       | Calendario de menú y preferencias             | Ninguna       |
| `agenda`     | Calendario familiar y adicionales autorizados | Ninguna       |
| `nido-note4` | Tarjetas del dispositivo                      | Menú y agenda |

Los coordinadores ven esquemas familiares para permitir la herencia de herramientas al delegar, pero el plugin rechaza su ejecución directa. Los calendarios adicionales de la agenda son de solo lectura salvo los incluidos explícitamente en `calendarAccess.agenda.write`; estos admiten alta, modificación y borrado. `nido_calendars_list` permite consultar nombres, referencias y permisos por agente. Mantener una herramienta visible no equivale a autorizar su uso.

## Mapa del código

| Ruta                                                            | Responsabilidad                                                                     |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `scripts/prepare-local.mjs`                                     | Generar el perfil aislado, permisos e instrucciones privadas a partir de plantillas |
| `scripts/private-state.mjs`, `scripts/setup.mjs`                | Ubicación externa del estado y configuración inicial                                |
| `agents/`                                                       | Plantillas públicas de comportamiento; los workspaces de ejecución son privados     |
| `integrations/nido-family/src/core.ts`                          | Permisos, validación, preferencias, operaciones y adaptador demo                    |
| `integrations/nido-family/src/google.ts`                        | OAuth, Calendar, errores y reconciliación de altas                                  |
| `integrations/nido-family/src/index.ts`                         | Esquemas, registro de herramientas y conexión con OpenClaw                          |
| `integrations/nido-family/src/agent-context.ts`                 | Contexto completo reciente para interpretar y modificar eventos                     |
| `integrations/nido-family/src/note4-home.ts`                    | Proyección limitada de menú y agenda para la pantalla                               |
| `integrations/nido-family/src/note4.ts`                         | Contrato y almacenamiento de tarjetas                                               |
| `integrations/nido-family/src/note4-device.ts`, `note4-http.ts` | Turnos del dispositivo, autenticación HTTP, cancelación y caducidad                 |
| `scripts/note4-bridge.mjs`                                      | Servicio HTTPS y enlace con transcripción/Gateway                                   |
| `firmware/note4/`                                               | Firmware ESP32-S3, audio, pantalla, botones y transporte                            |
| `integrations/trmnl/`                                           | Proyecciones y plantillas opcionales de menú/agenda                                 |
| `tests/`                                                        | Comprobaciones con datos ficticios, incluidas fixtures compartidas con C++          |

## Persistencia y consistencia

La memoria conversacional puede delegarse en Honcho mediante su plugin opcional de OpenClaw. Es independiente de las preferencias explícitas y los calendarios de Nido, que prevalecen sobre los recuerdos. La preparación conserva su configuración y el simulador NOTE4 lo desactiva para no mezclar demo y familia. Véase `memory.md`.

`Store` crea `nido.sqlite` con preferencias y registro de operaciones. La demo añade eventos ficticios. El transporte NOTE4 utiliza esa base para sus propias tablas de sesiones, turnos y tarjetas. Las bases internas de OpenClaw son distintas y pertenecen al runtime.

Las operaciones conservan identidad para deduplicar reintentos. Las ediciones usan ETags; las preferencias usan versiones. Un resultado `UNCERTAIN` exige releer antes de repetir. No hay transacción global entre eventos de Google y no se modifican recurrencias ni eventos con invitados.

`agent-context.json` contiene referencias completas de una ventana reciente de calendarios. No es una copia de seguridad ni una réplica histórica completa. La proyección enviada a la pantalla elimina IDs y notas, limita texto y número de eventos; no debe utilizarse para reconstruir una edición. Un fallo conserva el contexto anterior y lo marca como obsoleto.

Meal times and the time zone belong to each installation. Active menu events are grouped by their start date in the family time zone and ordered by start instant: the first is lunch and the second dinner, regardless of titles or configured times. A single event is lunch, including an all-day event. More than two events, equal start instants, or a pair containing an all-day event require clarification; NOTE4 refresh fails without replacing the last successful snapshot. Writes validate the resulting day before saving, while deletion can remove a conflicting event using its current ETag. `mealTimes` supplies scheduling defaults and NOTE4 dimming thresholds; changing it neither moves existing events nor changes their classification. Conversational preferences do not automatically change these administrative settings.

## NOTE4

El puente recibe WAV autenticado, devuelve un acuse y permite consultar el turno. Los UUID deduplican solicitudes; las respuestas a tarjetas se vinculan a la pregunta vigente. Un cliente con `X-Nido-Card-Version: 2` recibe las ocho vistas; el puente convierte las nuevas vistas a texto para firmware anterior.

El plazo de conversación depende de su actividad, no del sondeo de estado. Una cancelación detiene trabajo pendiente cuando el runtime lo permite, pero no revierte una escritura ya realizada. `affectedDates` proviene de operaciones confirmadas y guía el día mostrado tras un cambio.

Las reglas visuales vigentes están en `note4-design-system.md`; el protocolo y uso están en `note4-voice.md`. La documentación de verificación distingue renderizado, compilación, carga y confirmación física. Los informes antiguos no prueban qué firmware está instalado hoy.

El mantenimiento NOTE4 usa RPC administrativos del plugin con scopes del operador; no añade herramientas a agentes familiares. El NOTE4 muestra un código temporal tras conectar a la Wi-Fi; el plugin lo descubre por mDNS o IP y entrega la autorización mediante SRP-6a/AES-GCM antes del canje HTTPS. El puente autentica el token propio obtenido mediante vinculación y distribuye artefactos firmados desde `dataDir/note4-maintenance`. El firmware conserva configuración en NVS y aplica OTA sobre la partición inactiva con rollback. [Contrato y procedimientos](note4-maintenance.md).
