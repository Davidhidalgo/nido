# Desarrollar y diagnosticar sin datos familiares

`AGENTS.md` es el punto de entrada para asistentes de programación. Este documento y `architecture.md` contienen el contexto necesario para continuar desde una copia limpia del repo. El archivo privado de experimentos conserva evidencias antiguas, pero no es una dependencia del desarrollo.

## Instalación como plugin

El recorrido principal del producto está en [inicio](getting-started.md); el despliegue con otro perfil está en [perfil aislado](standalone-install.md). La compilación `pnpm run build` usa `scripts/build-plugin.mjs`, un estado temporal y el SDK público para la UI. No consulta `.local` ni aplica parches al runtime. Esbuild se instala como dependencia de desarrollo en la raíz.

Después de `pnpm run plugin:pack`, `pnpm run test:plugin:isolated` instala el `.tgz` mediante el CLI real de OpenClaw, arranca un Gateway temporal sin configuración de Nido y comprueba el asistente con un agente previo. Usa datos ficticios y no llama al modelo ni a Google. `-- --ui` permite revisar la pantalla antes de continuar; Enter termina la revisión. La fixture necesita abrir localhost. Los tests de `tests/setup.test.ts` cubren conflictos, aislamiento y conservación de configuración. `tests/google-oauth.test.ts` recorre la autorización compartida con un servicio real en memoria y respuestas ficticias de Google: comprueba state/cookie, PKCE, pruebas por instalación, expiración, permisos parciales, reinicios y reconexión. No usa una app ni una cuenta de Google reales. `pnpm run test:oauth:browser` sirve una prueba manual del formulario en una ventana nueva, con la política de referrer del host y un receptor en otro puerto local; pulsa el botón, comprueba el resultado y vuelve al terminal con Enter. La fixture permite comprobar el formulario en la misma pestaña si el navegador bloquea ventanas emergentes; esa alternativa no verifica la apertura de una ventana nueva. No accede a OpenClaw ni a Google.

## Preparar herramientas

Usa Node 24.16+ de la rama 24 y pnpm 9.0.5. Instala el runtime con `node scripts/install-local.mjs`, seguido de `pnpm install --frozen-lockfile`. El enlace de desarrollo a OpenClaw requiere instalar primero ese runtime.

```sh
pnpm run build
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm run test:gateway:isolated
```

El último comando genera un perfil demo temporal sin leer `.local`, usa un puerto loopback libre y prueba autenticación, permisos y alta/reintento/borrado de un evento ficticio. Detiene el Gateway y elimina el entorno temporal al terminar. No llama a un modelo ni a Google. Las pruebas unitarias tampoco requieren credenciales.

`test:gateway` se conserva para un Gateway demo que el operador haya arrancado explícitamente; rechaza el modo Google. `demo:seed` modifica el entorno demo seleccionado y también rechaza Google. Una conversación con `note4:chat` sí puede consumir la API del modelo, aunque use calendarios ficticios.

## Dónde guardar trabajo

| Resultado                                           | Destino                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------- |
| Decisión, explicación, procedimiento                | `docs/`, sin información de una familia                                           |
| Reproducción de un fallo                            | `tests/`, con fixtures ficticias                                                  |
| Herramienta reutilizable                            | `scripts/`, sin rutas de una instalación ni credenciales incrustadas              |
| Render, ejecutable o log de una prueba ficticia     | `.cache/`, ignorado y regenerable                                                 |
| Evidencia privada de una incidencia real autorizada | Archivo de desarrollo externo a checkout y estado operativo; ver `data-layout.md` |

No conviertas una transcripción real en fixture cambiando solamente los nombres: reconstruye un caso mínimo ficticio. Conserva la condición que provocó el fallo, no los datos originales. Evita que tests o guías dependan de archivos que solo existan en el equipo del desarrollador.

## Lo aprendido de los diagnósticos anteriores

- **Permisos:** verifica a través del Gateway además de comprobar listas de herramientas. Que el coordinador vea un esquema no le concede ejecución. El smoke test aislado cubre este límite.
- **Conflictos y reintentos:** prueba duplicación, versión de preferencias y ETags en `family.test.ts` y `google.test.ts`. Un timeout puede ocurrir después de guardar; no lo conviertas en un reintento ciego.
- **Duración de citas:** el agente de agenda puede estimar un final si el inicio es conocido; debe identificarlo como estimado. Al mover una cita, conserva su ID y duración salvo petición distinta. Las tarjetas deben reflejar el resultado guardado.
- **Contexto frente a pantalla:** una cita que no cabe en la pantalla o ya ha terminado puede seguir siendo relevante para una orden. `agent-context.test.ts` y `note4-home.test.ts` cubren representaciones con funciones distintas.
- **Protocolo de voz:** comprueba autenticación antes de aceptar audio, límites WAV, UUID repetidos, respuestas antiguas, cancelación y caducidad con `note4-device.test.ts`. Usa audio sintético para pruebas de transporte.
- **Esquema de herramientas:** si cambia una tarjeta o herramienta, recompila el plugin y reinicia el Gateway de prueba. Una caché de esquemas de un proceso existente puede conservar el contrato anterior.
- **OAuth:** `invalid_grant` requiere reconectar la cuenta. El código debe devolver un error de autorización; una lectura fallida no es un calendario vacío. No exportes respuestas con tokens a un informe público.
- **Modelos:** conserva la selección de cada instalación. Una prueba histórica de un modelo no establece su disponibilidad actual ni justifica cambiar el de una familia.

### Una respuesta de chat no garantiza una tarjeta NOTE4

Si el dispositivo termina con «No he recibido el resultado completo», revisa por separado la transcripción, el resultado del especialista, las llamadas a `note4_mostrar` y las tarjetas persistidas. El especialista puede haber pedido una aclaración correctamente y el coordinador haber escrito esa pregunta en el chat, pero ninguna tarjeta llegará al dispositivo si todas las llamadas de publicación fallaron. El puente espera hasta su plazo y el turno queda `uncertain`; ese estado no demuestra que haya ocurrido una escritura. Comprueba las herramientas ejecutadas y el registro de operaciones antes de decidir si hace falta reconciliar cambios.

En el modo de herramientas por código de OpenClaw se ha observado la firma resumida `view: unknown` y errores de validación que mezclan requisitos de distintas variantes. `note4Definition`, en `integrations/nido-family/src/note4.ts`, incluye ejemplos explícitos y acepta alias de presentación limitados: `text` por `body` en texto y `question` por `body` en preguntas binarias. Un `summary` de texto se conserva como prefijo del cuerpo. El plugin normaliza antes de persistir, rechaza contradicciones y valida de nuevo el contrato estricto del dispositivo, incluidos los límites del texto completo. El modelo debe seguir usando `body`.

La primera publicación de un `cardId` usa `append`; `update` exige que ya exista. Un fallo en una llamada paralela tampoco implica que la delegación no haya arrancado: conserva ambos resultados con `Promise.allSettled` y corrige solo la tarjeta. `tests/note4-tool-input.test.ts` reproduce con datos ficticios la pregunta posterior a un progreso fallido, su entrega y la respuesta única con botón. `test:gateway:isolated` comprueba además que la validación de OpenClaw admite los alias antes de ejecutar el plugin, manteniendo permisos y deduplicación. Estas pruebas no garantizan que el modelo formule siempre una tarjeta correcta ni sustituyen la verificación física.

## Firmware y hardware

`pnpm run test:note4-firmware` usa el SDK local y Clang con ASan/UBSan. Genera vistas ficticias en `.cache/note4/firmware-preview/` a partir de fixtures compartidas con TypeScript, y ejecuta las pruebas Python de protección del dispositivo. También compila Mbed TLS del SDK para el host y ejecuta el instalador OTA real con flash/bootloader simulados y claves ficticias. No requiere Wi-Fi ni el calendario real.

Las pruebas de laboratorio anteriores motivaron inicializar NVS sin borrar automáticamente, tratar la interacción entre USB PHY y Wi-Fi y usar el mecanismo de reinicio documentado por el script del dispositivo. Mantén esos comportamientos y consulta `firmware/note4/README.md`. Un log de puerto desconectado no demuestra arranque correcto. Antes de cargar firmware se requiere el respaldo completo y validado que exige el comando de flasheo.

`./scripts/note4-firmware build-generic` compila el cliente conectado con sdkconfig/build en `.cache/note4/generic`, sin cabecera de credenciales ni defaults privados. `NIDO_OTA_PUBLIC_KEY_FILE` incorpora únicamente la clave pública de firma. La vinculación y OTA se prueban con paquetes, claves y datos ficticios; [procedimiento](note4-maintenance.md).

Las decisiones de diseño están en `note4-design-system.md`; las imágenes públicas de diseño y `tests/fixtures/note4-cards.json` son ficticias. Las capturas históricas privadas no son necesarias para reproducir los renderizados actuales. No afirmes autonomía, consumo, carga o funcionamiento físico a partir de tests de software.

## Al terminar

Ejecuta las comprobaciones pertinentes y actualiza las guías afectadas. `release:check` busca secretos y datos personales reconocibles en archivos publicables, índice e historial de publicación sin abrir `.local`. Los recursos binarios requieren un hash revisado en `config/public-assets.json`; sigue revisando manualmente texto, imágenes y metadatos según [la guía de privacidad](privacy.md). `plugin:pack` produce un paquete con una lista explícita de código y plantillas públicas.

En OpenClaw 2026.9.8 se observó que una recarga de configuración del plugin puede invalidar callbacks administrativos de su instancia anterior. Si aparece `PluginInstanceUnavailableError`, reiniciar el Gateway de esa instalación vuelve a registrarlos. El test aislado reinicia exclusivamente su Gateway temporal tras cambiar permisos de calendarios; comprueba luego los RPC de mantenimiento y los scopes de una sesión de solo lectura. Las órdenes OTA no modifican la configuración del Gateway.
