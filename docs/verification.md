# Verificación de Nido

Este documento es un registro histórico. Las rutas antiguas de capturas y diagnósticos pueden haberse trasladado al archivo privado de desarrollo; no son dependencias para reproducir las pruebas. Usa [la guía de desarrollo](development.md) y [la organización de datos](data-layout.md) para los procedimientos y destinos actuales.

Fecha: 17 de septiembre de 2026. Equipo: macOS Apple Silicon. OpenClaw 2026.9.4, Node 24.16.0.

## Comprobado

- Instalación local de OpenClaw; versión comprobada mediante CLI y registro npm. Node descargado de nodejs.org y checksum contrastado con su distribución oficial.
- Compilación y typecheck TypeScript 6, lint Oxlint y formato Oxfmt.
- 42 pruebas de comportamiento con Vitest: permisos por agente/calendario, argumentos cerrados, reintentos, huecos ocupados, cambios simultáneos, ETags, edición parcial, límites de invitados/recurrencias, persistencia de preferencias, caducidad según Madrid y adaptación HTTP de Google.
- Configuración aceptada por `openclaw config validate`.
- Manifest y entrada aceptados por `openclaw plugins validate`; `plugins inspect --runtime` carga las ocho herramientas de Nido.
- Chat web y sus nueve assets JS/CSS servidos correctamente por HTTP local.
- Gateway real arrancado en loopback; health informa plugins `nido-family` y `openai` cargados, sin errores, y heartbeat desactivado.
- Smoke test contra el endpoint real `/tools/invoke`: rechaza peticiones sin autenticación; los tres agentes carecen de terminal; Nido coordinador no puede ejecutar Calendar; agenda no puede modificar preferencias; menú no puede delegar ni escribir en family. Alta, repetición de la misma llamada y borrado de un evento ficticio completados sin duplicación.
- Auditoría de OpenClaw: ningún hallazgo crítico. Advertencia sobre proxies de confianza no configurados, coherente con una instalación exclusivamente local sin proxy.

## Pendiente

- Clave del modelo y evaluación de conversaciones reales, incluido enrutamiento y continuidad de aclaraciones entre agentes.
- OAuth con Google y prueba real de lectura/escritura en calendarios de desarrollo. Los tests de Google usaron respuestas HTTP simuladas, sin credenciales reales.
- Confirmar calendarios, comensales, horarios y preferencias de la familia.
- Validación cotidiana con la familia; no se considera completada por pasar tests técnicos.
- Telegram, audio y NOTE4: sin configurar. No se han enviado mensajes externos.
- Instalación como servicio persistente y alojamiento definitivo: sin configurar.
- Copias de seguridad: deliberadamente aplazadas, sin implementar.

## Alcance de las garantías

Las pruebas verifican barreras técnicas por calendario y herramientas; no demuestran que un modelo interprete siempre bien una petición. Confirmaciones de borrado y preferencias explícitas aún se basan en instrucciones del agente. Los permisos no se amplían por esas instrucciones.

La deduplicación corresponde a la misma sesión y llamada de herramienta. No se ha implementado equivalencia semántica entre peticiones nuevas. Calendar no ofrece una transacción conjunta para un menú completo; los resultados inciertos requieren relectura y los éxitos parciales deben comunicarse.

El Gateway se detuvo limpiamente al terminar las comprobaciones; no queda instalado como servicio automático.

Las pruebas se ejecutaron sin conectar Google ni usar la API de un modelo. No se ha publicado el proyecto, creado un remoto o activado respaldos.

## Corrección de delegación (22 de septiembre)

44 tests y lint pasan. Se verificó en el Gateway el rechazo de ejecución directa del coordinador y las restricciones de los especialistas. En una conversación nueva, Nido lanzó a menú y agenda y ambos respondieron a mensajes sintéticos (`MENU_OK` y `AGENDA_OK`). La prueba no consultó ni transmitió calendarios o preferencias. El Gateway quedó arrancado desde la sesión de diagnóstico. Las sesiones antiguas pueden conservar selecciones de modelo o perfil y requieren una conversación nueva.

## NOTE4 · 30 de septiembre de 2026

- Agente `nido-note4` y herramienta real `note4_mostrar` registrados; configuración y plugin validados con el CLI instalado.
- 66 pruebas pasan, incluyendo aislamiento/deduplicación de tarjetas, revisiones persistentes, preguntas binarias, clic único, cierre de preguntas y permisos del nuevo coordinador. Typecheck, lint, formato y compilación pasan.
- Conversación real con el modelo configurado: tarjeta de saludo, creación de cena demo mediante el especialista, consulta sin duplicación, «esa cena» para cambiar merluza por tortilla y «deshaz ese último cambio» para restaurarla. Las tarjetas de progreso se actualizaron con resultados confirmados.
- Pregunta binaria real, respuesta simulada con botón superior en la misma sesión y tarjeta de pregunta actualizada a prueba terminada.
- Gateway/configuración/SQLite de pruebas separados de Nido familiar. Las pruebas no modificaron Google. El dashboard demo usa puerto 18790 y permite inspeccionar las sesiones y los resultados de las herramientas.
- Se corrigió la elección del modelo del simulador para heredar el configurado explícitamente para Nido si el agente no tiene uno propio. No se migró el modelo del Gateway familiar.
- Esta verificación del agente no cubre audio, firmware, dibujo de tarjetas ni botones físicos; el primer corte de firmware se documenta por separado a continuación. El comportamiento del agente se ha probado con ejemplos, no se garantiza para toda petición; el deshacer universal tampoco está implementado.

## Firmware NOTE4 · 30 de septiembre de 2026

- ESP32-S3 con flash de 16 MiB y PSRAM de 8 MiB identificado por USB. Se respaldó la flash completa antes de escribir; SHA-256 y comparación contra el dispositivo verificados. El respaldo privado permanece en `.local/note4/backups/`, fuera de Git.
- Compilación real con ESP-IDF 5.4.2 y pruebas nativas con ASan/UBSan de GPIO, PCM y UTF-8 correctas. Seis pruebas de protección del respaldo y rechazo de otro dispositivo pasan. El monitor POSIX se comprobó con un pseudo-terminal y después con USB físico.
- Se corrigió la alimentación inicial del controlador de pantalla. El usuario confirmó «Audio capturado» en la pantalla real; el log registró 2,4 segundos, 38.400 muestras, pico 15.874 y RMS 2.623, sin error ni límite. Estos datos prueban captura de señal, no calidad de transcripción.
- El log confirmó reposo profundo después del resultado y una interrupción del RTC: `boot=2 wake=3 pins=0x20`, `rtc_probe=interrupt received`. Ese despertar no inició micrófono ni red ni repintó; volvió a dormir con la prueba programada ya desactivada.
- La siguiente pulsación frontal despertó del reposo (`boot=3 wake=3 pins=0x1`). Se grabaron 3,2 segundos sin error; el usuario confirmó otra vez la tarjeta en pantalla. La memoria RTC conservó el resultado de la prueba entre despertares.
- Se recompiló y cargó la versión final con `NIDO_RTC_WAKE_TEST_SECONDS=0`; bootloader, particiones y aplicación se verificaron contra la flash. Una nueva grabación de 3,1 segundos y su tarjeta fueron confirmadas; el log terminó en reposo con `rtc_probe=0` y únicamente los botones frontal e inferior habilitados para despertar.
- La fecha del RTC presenta el indicador de tensión baja y se trata como inválida. La cuenta atrás funcionó sin establecer una fecha ficticia. La hora se sincronizará al integrar el servidor.
- Pendientes: conexión del firmware al agente y transcripción; medición de corriente desde batería con USB desconectado; autonomía y comparación con fábrica. Este prototipo no utiliza Wi-Fi ni realiza acciones en Nido.

## Audio y tarjetas NOTE4 · 30 de septiembre de 2026

- Implementado el servicio HTTPS local: recepción de WAV, transcripción con el runtime instalado de OpenClaw, conversación persistente con `nido-note4`, tarjetas y respuestas binarias. Usa un token propio del dispositivo y calendarios demo separados del entorno familiar.
- 73 pruebas de TypeScript pasan, incluyendo siete del transporte y sus límites, autenticación, exclusión de turnos simultáneos, repetición sin duplicados, continuidad y caducidad. Typecheck y lint pasan. Se repitieron las siete pruebas del transporte después de ampliar las comprobaciones de reenvío y concurrencia.
- Un audio sintético en español recorrió HTTPS y la transcripción real hasta devolver una pregunta binaria. Reenviar el mismo UUID mantuvo la tarjeta sin ejecutar otra vez; responder con el botón inferior mediante HTTP produjo la tarjeta final en la misma conversación. No se modificaron calendarios de Google.
- Firmware conectado compilado con ESP-IDF 5.4.2 y cargado en el dispositivo; bootloader, particiones y aplicación verificados contra la flash. Las vistas de pregunta y cambio de plato también se comprobaron mediante renderizados nativos.
- Wi-Fi se detiene al terminar el intercambio. Una pregunta permite los dos botones laterales en reposo ligero durante cinco minutos; el resto de resultados vuelve al reposo profundo. La implementación sincroniza el RTC con la hora del servidor al terminar un turno.
- Pendientes de comprobación física en esta fase: voz desde el NOTE4 hasta el agente, respuesta con ambos botones, sincronización del RTC y reposo después de la red. El dispositivo todavía requiere salir del modo de carga mediante RESET para esta prueba. El aviso sonoro tiene un ajuste posterior de espera para completar la reproducción que está compilado, pendiente de cargar.
- La política de reposo está implementada, pero aún no se ha medido corriente desde batería ni autonomía del recorrido completo. El servicio y el Gateway se ejecutan manualmente en el Mac; no están instalados como servicios automáticos. No se ha publicado el proyecto.

## NOTE4 con calendarios familiares · 30 de septiembre de 2026

- El usuario informó de funcionamiento del dispositivo conectado, con resultados todavía dirigidos a la demo. El puente se cambió para usar por defecto el Gateway familiar y los calendarios de Google ya configurados en Nido. `--demo` conserva la prueba aislada; el simulador de texto sigue siendo demo.
- El destino del agente, las tarjetas y la continuidad usan el estado y SQLite del Gateway elegido. No se copiaron los datos ni conversaciones demo al entorno familiar, y no fue necesario flashear el dispositivo.
- Dos pruebas nuevas verifican que el destino por defecto es el Gateway familiar, que la demo queda separada y que una configuración demo no se acepta silenciosamente como destino real. Ocho pruebas de selección de entorno y tarjetas, typecheck, lint y formato pasan.
- Google rechazó inicialmente el refresh token guardado con `invalid_grant` (caducado o revocado). Tras completar la reconexión OAuth se verificaron lecturas de menú y agenda a través del Gateway familiar, ambas con resultado `mode: google`, sin escrituras de prueba.
- Se recargó el Gateway familiar para incorporar `note4_mostrar`, que no estaba disponible en su proceso anterior. Una consulta de audio por HTTPS completó transcripción, delegación de `nido-note4` a `menu`, tarjeta de progreso y tarjeta final en el entorno familiar. La comprobación fue de solo lectura; no se crearon, modificaron ni borraron eventos de prueba en Google.

## Latencia NOTE4 · 30 de septiembre de 2026

- Se inspeccionaron tiempos y herramientas de tres turnos reales. La recepción/transcripción y llegada al agente tardaron aproximadamente 2,7–3,1 segundos; el coordinador dedicó aproximadamente 20–25 segundos a progreso y delegación antes de ejecutar el especialista. Estos datos proceden del servidor y no miden Wi-Fi ni refresco físico del panel.
- El registro del Gateway mostró que el modelo heredado por los especialistas (`openai/gpt-5.4-mini`) ya no estaba disponible en la conexión de cuenta ChatGPT utilizada por OpenClaw. El coordinador intentó además un modelo fuera de su lista permitida antes de recuperarse con el modelo que ya funcionaba. Esto no afirma que ese modelo esté retirado de toda la API de OpenAI.
- Se alinearon la selección predeterminada y las selecciones explícitas de `menu` y `agenda` con `openai/gpt-5.6-sol`, ya utilizado con éxito en estos turnos. La configuración local se validó y el Gateway confirmó su recarga sin reinicio; se conserva la configuración anterior en un archivo privado ignorado.
- El puente NOTE4 solicita razonamiento bajo. El prompt pide agrupar progreso y delegación, usar los modelos configurados y delegar consultas/cambios concretos con razonamiento bajo. No se modificaron los permisos de los especialistas, las comprobaciones de ETags ni el firmware.
- Una consulta con el mismo WAV de solo lectura produjo progreso y `sessions_spawn` en una misma respuesta, delegó a `menu` con `thinking: low` y llegó a una tarjeta final válida. El tiempo desde recepción hasta publicación de la tarjeta fue aproximadamente 38,7 segundos, frente a 50,7 en la comprobación anterior. Es una sola comparación, con contexto y calendario que pueden variar; no es una garantía de mejora para otros turnos. No se realizaron escrituras de prueba en Google.

## Eventos y presentación NOTE4 · 30 de septiembre de 2026

- Agenda estima la duración al crear una cita con inicio conocido y sin fin explícito; comunica el intervalo guardado para rectificar después. Las correcciones conservan el ID y, al cambiar solo el inicio, la duración existente. Se mantiene la aclaración de fechas, inicios, personas imprescindibles y eventos ambiguos; no se guardan preferencias permanentes a partir de la estimación.
- Conversación real del agente en el Gateway demo: creación a las 17:00 sin duración, estimación de una hora, «mejor a las 18:30» y «que acabe a las 19:15». Las tres tarjetas `event` coincidieron con los horarios guardados; las dos correcciones actualizaron el mismo ID sin duplicar la cita. La última retiró la marca de duración estimada. No se modificó Google Calendar.
- La nueva vista separa nombre, fechas, horario y lugar. El firmware dibuja «(estimada)» en pequeño a la derecha del horario y elimina las ayudas de uso de las pantallas conectadas. Se inspeccionaron renderizados nativos de la cita y de la pantalla inicial; también se renderizaron títulos largos, todo el día, horario rectificado y cruce de medianoche.
- La cabecera muestra batería baja solo con muestra válida y porcentaje estimado inferior al 20%, y Wi-Fi tachado mientras no está conectado. Se usan muestras al despertar y al terminar un turno, sin sondeo en reposo. La radio sigue apagándose entre turnos; su icono también aparece en ese reposo normal.
- `sessionExpiresAt` comunica la fecha límite desde la última actividad. El firmware conserva el plazo entre despertares y programa una única interrupción del temporizador RTC interno del ESP32 para recuperar inicio, sin micrófono ni red. Una pregunta binaria usa el mismo plazo. Los tests comprueban que consultar no lo amplía, que una nueva actividad lo renueva, que un turno de una conversación anterior no transmite otro plazo y que la recuperación de botones no retrasa la expiración.
- 84 pruebas de TypeScript, typecheck, lint, formato y compilación del plugin pasan. Las pruebas nativas con ASan/UBSan y seis pruebas de protección del respaldo pasan. Firmware final compilado con ESP-IDF 5.4.2 y cargado con el respaldo de fábrica validado; bootloader, particiones y aplicación verificados contra la flash.
- Una consulta WAV de solo lectura recorrió HTTPS, transcripción y agente en el Gateway familiar actualizado; terminó con tarjeta válida y `sessionExpiresAt` dentro del plazo de cinco minutos, sin escrituras en Google. El usuario confirmó la nueva pantalla «Hola» tras RESET.
- Pendientes de validación física en esta versión: tarjetas de evento, icono con batería realmente baja y regreso automático a inicio al caducar. No se ha medido corriente ni autonomía; los renderizados y tests no sustituyen estas comprobaciones.
- Durante la comprobación física se registraron dos intentos que agotaron 15 segundos sin conseguir conexión Wi-Fi, antes de enviar audio a Nido. La IP del Mac y las credenciales compiladas coinciden con la configuración local; el servicio HTTPS y el Gateway siguen disponibles. Se compiló, cargó y verificó una versión de diagnóstico que registra los motivos de desconexión, distingue la tarjeta «Sin Wi-Fi» y permite hasta tres intentos dentro del mismo plazo total. La causa de esos fallos todavía no está confirmada; no se afirma que los reintentos la hayan resuelto.
- La siguiente consulta física con el diagnóstico registró tres desconexiones `reason=201` (`WIFI_REASON_NO_AP_FOUND` en ESP-IDF): el dispositivo no encontró la red configurada durante el escaneo. Esto sitúa el fallo antes de la autenticación, DHCP y HTTPS; no confirma si la causa es alcance, emisión de 2,4 GHz u otra condición de radio.
- El log USB confirmó un despertar por temporizador (`wake=4`), `session expired: home screen, no network` y retorno a reposo profundo. Ese arranque no inició micrófono ni Wi-Fi. Confirma el camino de caducidad local después de un intento fallido; todavía no se ha observado en esta versión después de una consulta física completada con Nido.
- El log también mostró que la calibración RF no podía leer NVS porque faltaba inicializarla. Se preparó la inicialización sin borrado automático, conservando las credenciales Wi-Fi en RAM y el fallback de calibración si NVS no está disponible. Esta corrección está pendiente de cargar; no se presenta como causa confirmada de `NO_AP_FOUND`.
- Acercar el NOTE4 al router no resolvió la conexión. Al desconectar USB, el usuario confirmó que conectó y respondió desde batería; el Gateway registró la consulta y su respuesta. Esto apunta a interferencia asociada al USB y coincide con la advertencia del Kconfig de ESP-IDF para ESP32-S3, aunque una sola comparación no identifica el mecanismo exacto. Se preparó `ESP_PHY_ENABLE_USB=n`, que permite al driver desactivar el circuito USB mientras usa Wi-Fi; queda pendiente de cargar y repetir con el cable conectado.
- El ajuste `ESP_PHY_ENABLE_USB=n` y la inicialización de NVS se recompilaron con ESP-IDF 5.4.2 y se cargaron en el NOTE4; bootloader, particiones y aplicación verificados contra la flash. La configuración generada confirmó `ESP_PHY_ENABLE_USB=false`; las pruebas nativas con ASan/UBSan, seis de protección del respaldo y formato pasan. Pendiente la consulta física con USB conectado después de RESET.

## Identidad visual NOTE4 · 30 de septiembre de 2026

- Nueva marca de nido dibujada con líneas, cabecera separada, tarjetas redondeadas, fondo de trama ligera y sombra desplazada. Estados con etiqueta compacta, horarios y plato nuevo destacados, y opciones binarias con contorno y números de los botones físicos. Se mantiene el framebuffer de 1 bit y la política de refresco, radio y reposo.
- El aviso de Wi-Fi tachado se reserva para un fallo real en la tarjeta «Sin Wi-Fi»; no aparece durante el envío ni en reposo normal. El canvas añade un glifo de tres puntos para «…», que antes se sustituía por «?». El ajuste del texto respeta caracteres UTF-8 completos, ancho y alto disponibles; las líneas grandes usan 32 píxeles para no superponerse.
- Pruebas nativas con ASan/UBSan y seis pruebas de protección del respaldo pasan. Se comprobó que el glifo de puntos suspensivos dibuja tres puntos y que un título y cuerpo de longitud máxima sin espacios no alteran el borde, la sombra ni las zonas fuera del contenido. Se inspeccionaron doce vistas conectadas, incluidas preguntas con opciones largas, respuesta larga, todo el día, horario rectificado, cruce de medianoche y errores. Se generan diecisiete PGM en total. La lámina de propuesta está en `.local/note4/firmware-preview/proposal.png` y la revisión completa en `design-review.png` del mismo directorio.
- Compilación ESP-IDF 5.4.2 completada en modo conectado; el ajuste previo que desactiva PHY USB se conserva. Carga en el mismo NOTE4 del respaldo completo validado; bootloader, particiones y aplicación comparados contra flash con resultado `verify OK`.
- Los reinicios USB ordinarios conservaron el modo de descarga ROM. Se aplicó el reinicio por watchdog soportado por esptool para ESP32-S3 sin reescribir flash; el puerto volvió a enumerarse y después se desconectó. Esta observación no confirma visualmente la pantalla ni una interacción con Nido. Quedan la valoración del contraste y las tramas en el panel real, y una consulta física para confirmar las vistas durante el uso. No se ha medido corriente ni autonomía.

## Iteraciones de tarjetas NOTE4 · 1 de octubre de 2026

- Se conservaron cuatro láminas de revisión en `.local/note4/design-iterations/`: base, ampliación, refinamiento y propuesta final. Las nuevas revisiones unifican títulos y estados, centran la marca inicial y los datos destacados, separan etiquetas y valores en las fichas y mantienen la trama fuera del área principal de las letras. La lámina resumida está en `.local/note4/firmware-preview/proposal-final.png`.
- El contrato pasa de cuatro a ocho vistas: se añaden `list`, `facts`, `compare` y `highlight`. Listas y fichas admiten de uno a tres elementos; las cuatro vistas son informativas y no activan botones. El agente tiene instrucciones para elegirlas, conservar resultados parciales, identificar propuestas y evitar afirmar que se han guardado datos cuando solo se presentan. Se mantienen autorización, revisiones, deduplicación y una sola pregunta pendiente.
- Trece fixtures JSON compartidos se validan en TypeScript y se decodifican y dibujan en C++. Las pruebas nativas con ASan/UBSan verifican que los nuevos contenidos no salen del rectángulo común y que los payloads inválidos no reemplazan la tarjeta anterior. Se generan treinta PGM. El decoder usa una tarjeta temporal en heap para evitar aumentar innecesariamente la pila del ESP32.
- Pasan 96 pruebas TypeScript, typecheck, lint, formato de los archivos afectados, compilación del plugin y compilación ESP-IDF 5.4.2. Las pruebas HTTP verifican entrega de las cuatro vistas nuevas a clientes v2 y conversión a texto para los anteriores, sin alterar el historial; el recorte respeta pares Unicode y el máximo de 240 caracteres. Las seis pruebas de protección del respaldo también pasan.
- El reinicio interno de OpenClaw conservó el esquema antiguo en caché: una primera prueba sintética no pudo publicar las nuevas vistas. Se reiniciaron completamente los Gateways familiar y demo conservando configuración y datos, y se reinició el puente HTTPS con su misma configuración. Los tres servicios están disponibles. La segunda prueba con el agente real del Gateway demo publicó cuatro tarjetas `done`, una por vista nueva, con la herramienta real y datos sintéticos. No se consultó ni modificó Google.
- El NOTE4 no aparece por USB después de entrar en reposo. El firmware final está compilado, pero **esta última revisión todavía no está cargada en el dispositivo**. El nuevo firmware anuncia `X-Nido-Card-Version: 2`; el puente presenta las vistas nuevas como texto al firmware anterior para que siga funcionando hasta cargarlo. Quedan la carga con el respaldo verificado y la valoración de contraste en el panel real; no se ha medido corriente ni autonomía.

## Cabecera NOTE4 · 1 de octubre de 2026

- El estado de la petición se sitúa arriba a la derecha. Los iconos de Wi-Fi y batería comparten la fila a su izquierda; conservan su aparición según el estado real del dispositivo. Las tarjetas aprovechan el espacio liberado para subir títulos y contenido.
- Las pruebas nativas con ASan/UBSan comprueban que ambos iconos juntos no alteran el logo ni la etiqueta de estado. Pasan también las seis pruebas de protección del respaldo y la compilación ESP-IDF. Se generan treinta y una vistas PGM; la comparación de cabeceras está en `.local/note4/firmware-preview/proposal-header.png`.
- La revisión está compilada, pendiente de carga: el NOTE4 sigue sin aparecer por USB. La comprobación visual realizada corresponde al renderizado nativo, no al panel físico.
- Después de que el usuario pusiera el NOTE4 disponible para carga, se flasheó esta revisión en el mismo dispositivo del respaldo validado. Bootloader, aplicación de 1.094.000 bytes y tabla de particiones se compararon contra la flash: los tres devolvieron `verify OK (digest matched)`.
- Se solicitó salir del cargador ROM con el watchdog de esptool. El USB se desconectó durante el reinicio, generando un error del descriptor serie, y después volvió a enumerarse y desapareció de nuevo. La carga queda verificada; esta observación no confirma visualmente la pantalla ni una consulta física con Nido.

## Resumen diario y modales del NOTE4 · 2 de octubre de 2026

- Implementados resumen diario, cabecera compacta sin marca, auxiliares pequeños en minúscula, tarjetas con sombra y distribución de cero a seis eventos. Los eventos de todo el día y los que abarcan fechas se proyectan desde Calendar.
- El modo conectado conserva quince días en RAM y permite navegación local dentro del bloque. Refresca cada cinco minutos, tras un clic frontal y después de los resultados; no renueva por ello la sesión del agente.
- Una máquina explícita de estados en C++ distingue captura, procesamiento, pregunta, resultado, error e incertidumbre. Las vistas del agente aparecen en modales sobre el día; `affectedDates` permite saltar al día de una modificación confirmada. Se conserva el cierre de conversación a cinco minutos y el descarte de clics menores de 200 ms.
- Pasaron 41 pruebas TypeScript de tarjetas, transporte y proyección diaria; Clang con ASan/UBSan verificó los renderers, la caché, fechas UTC y transiciones, además de los seis controles de respaldo de fábrica. También pasaron typecheck, lint y formato de los archivos modificados.
- ESP-IDF compiló la aplicación de 1.104.432 bytes. El puente se reinició sin turnos activos y su endpoint autenticado devolvió quince días de los calendarios reales de Google, sin escrituras. El Gateway reiniciado informó que los plugins están cargados sin errores.
- El firmware se cargó en el NOTE4 identificado por el respaldo de fábrica y se verificaron por lectura los hashes de bootloader, aplicación y particiones. El reinicio por USB no produjo un arranque observable; tras RESET físico el usuario confirmó la pantalla de hoy con «Sin eventos pendientes», coherente con la lectura real de Calendar. Quedan las comprobaciones físicas de botones, audio, caducidad, modales y consumo. El reposo conectado ahora es ligero para permitir GPIO39; no se ha medido aún la autonomía de esta versión.

## Modelo rápido del coordinador NOTE4 · 2 de octubre de 2026

- La cuenta mostró `openai/gpt-5.4-mini` como disponible en el catálogo, pero una ejecución técnica lo rechazó: el runtime informó de su retirada en la ruta Codex de cuenta ChatGPT y recomendó `gpt-5.6-luna`. No se usa el catálogo por sí solo como prueba de acceso real.
- Se cambió únicamente la selección activa de `nido-note4` a `openai/gpt-5.6-luna`, con runtime `openclaw` y razonamiento `low` del bridge. `nido`, `menu` y `agenda` siguen en `openai/gpt-5.6-sol`. Se conserva respaldo privado de la configuración anterior.
- La configuración valida y una sesión técnica nueva, sin audio ni Calendar ni delegación, ejecutó realmente Luna y publicó una tarjeta `text` con estado `done`. El runtime registró 5.843 ms de ejecución; no es una comparación equivalente con la consulta familiar anterior. Falta medir una consulta física comparable. No requiere carga de firmware ni cambios de credenciales.

## Evaluación inicial de transcripción local · 2 de octubre de 2026

- Frase sintética generada localmente con la voz macOS Eddy (Spanish (Spain)): «¿Qué cenamos mañana?», WAV mono PCM16 a 16 kHz, duración 1,593 s. No se usó audio familiar ni se envió a un proveedor externo.
- Whisper Python ya instalado, modelo multilingüe `base` en caché, CPU con cuatro hilos, temperatura 0 y beam 1. Imports: 2,473 s; carga del modelo: 0,543 s. Tres transcripciones en el mismo proceso: 1,143 s, 0,939 s y 0,950 s.
- Las tres devolvieron «que tenemos mañana»: falló la palabra «cenamos». El resultado muestra una latencia local plausible con proceso persistente, pero no acredita precisión suficiente ni constituye una comparación equivalente con el audio físico de OpenAI (2,214 s). No activar este modelo como transcriptor de producción basándose en esta muestra. La transcripción local durante la captura requiere un motor incremental o procesamiento de ventanas; Whisper básico no ofrece ese flujo de forma directa.

## Etiquetas y horarios de agenda · 2 de octubre de 2026

- Las tarjetas futuras muestran el día de la semana en la primera tarjeta del día; el horario se sitúa abajo a la derecha y se omite para eventos de todo el día. Se reserva espacio para el título.
- Pruebas nativas con ASan/UBSan y seis pruebas Python correctas; compilación ESP-IDF correcta (aplicación de 1.145.424 bytes). Revisada la imagen del renderer con hoy vacío, cumpleaños con horario el sábado y más eventos el domingo. Datos ficticios; carga y comprobación física pendientes.
- El usuario decide conservar por ahora la transcripción con GPT; la alternativa local no se activa.

- Ajuste visual posterior: horarios elevados seis píxeles, dejando diez píxeles libres hasta el borde inferior; títulos ajustados para conservar separación. Pruebas nativas y Python correctas. Pendiente de carga en el dispositivo.

## Eventos de varios días sin repetición · 2 de octubre de 2026

- El resumen añade claves opacas por calendario/evento y fechas de inicio/fin inclusivas. Los eventos ya iniciados tienen prioridad. El renderer deduplica las tarjetas al completar la grid con días futuros y muestra el intervalo de fechas arriba a la izquierda. La navegación conserva el evento en cada fecha que abarca.
- Pasan seis pruebas TypeScript de proyección, typecheck, lint, pruebas nativas con ASan/UBSan (incluida equivalencia de la grid con/sin duplicados) y seis pruebas Python. Compilación ESP-IDF correcta; imagen ficticia revisada. Pendiente de carga y validación física.

- Puente reiniciado sin turnos activos con la nueva proyección. Firmware de 1.145.968 bytes cargado en el NOTE4 del respaldo; hashes de bootloader, aplicación y particiones verificados y reinicio USB enviado. Incluye también el mayor margen inferior de los horarios. Pendiente de comprobar visualmente el panel físico.

- Rango de fechas ajustado a «01/10 - 03/10», con guion y espacios. Renderer revisado, pruebas y compilación correctas; firmware cargado, tres hashes verificados y reinicio USB enviado.

## Reinicio USB después de LOAD · 2 de octubre de 2026

- El usuario confirma que el reset RTS anterior no arranca la aplicación. No considerar los mensajes anteriores de reinicio enviado como prueba de arranque. Espressif documenta que USB Serial/JTAG conserva el estado de strap al resetear desde LOAD manual, y propone watchdog RTC.
- El script separa verificación de flash y solicitud de watchdog; añade comando reset sin escribir flash. Primera prueba real alcanza la activación del watchdog y el USB se desconecta antes de bloquear su registro, con OSError 83 en macOS. Arranque pendiente de confirmación física. Se reconoce únicamente esa desconexión concreta sin declarar éxito de arranque; otros errores siguen fallando.

- Confirmación física del usuario: el NOTE4 arrancó con el watchdog sin pulsar RESET. Este método queda validado en el dispositivo y se utiliza después de futuras cargas. Pasan ocho pruebas Python del script.

## Grabaciones accidentales · 2 de octubre de 2026

- Grabaciones válidas con menos de 16.000 muestras (un segundo de PCM a 16 kHz) se descartan localmente, sin enviar, abortar un turno activo ni renovar sesión. Se restauran modo y modal previos; los eventos de red pendientes se procesan al regresar al bucle principal. El clic breve conserva su acción previa.
- Comprobados límites de 15.999, 16.000 y 16.001 muestras en pruebas nativas; pasan ASan/UBSan y ocho pruebas Python. ESP-IDF compila aplicación de 1.146.416 bytes. Intento de entrada automática a LOAD falla con No serial data received; no se ha cargado esta revisión. Pendiente de LOAD físico y comprobación de una grabación corta durante un turno.

- Tras LOAD físico autorizado por el usuario, revisión de descarte de audio corto cargada: aplicación de 1.146.416 bytes, hashes de bootloader/aplicación/particiones coincidentes. Watchdog activado con desconexión USB esperada; arranque de esta carga y comportamiento físico de la grabación corta pendientes de comprobar.

## Preparación para compartir · 2 de octubre de 2026

- Estado privado trasladado fuera del checkout, conservando `.local` como enlace ignorado. Adjuntos antiguos preservados fuera del repo; nuevos workspaces privados separados de las plantillas públicas. Comprobación de integridad SQLite correcta en demo y Google.
- Asistente `setup` para zona horaria, miembros, horarios, puerto y calendarios. La migración rechaza destinos existentes o dentro del checkout. Las instrucciones generadas conservan las políticas de permisos.
- Instalación completa desde una copia limpia en macOS: instalación del runtime fijado, dependencias con lockfile congelado, preparación demo, compilación y validación de OpenClaw. Gateway temporal probado con autenticación, permisos y alta/reintento/borrado de un evento ficticio; detenido al terminar. No se utilizaron calendarios reales en esa prueba.
- Paquete local instalado en un perfil independiente de OpenClaw 2026.9.4 con aceptación explícita de origen y capacidades. El host lo deja sin habilitar hasta configurar sus campos obligatorios. La integración de agentes en un OpenClaw global continúa siendo manual.
- Pruebas de preferencias y permisos, horarios configurables, proyección NOTE4, migración de rutas y detección de secretos en índice e historial. Typecheck, lint y formato comprobados. `release:check` revisa archivos publicables, índice e historial alcanzable sin imprimir secretos; sigue siendo necesaria revisión humana de documentos e imágenes.
- Las capturas de diseño son ficticias. No se ha añadido remoto ni publicado el código. La identidad de autor del primer commit debe revisarse antes de publicar. Linux y WSL2 tienen rutas de instalación compatibles, pero esta verificación se ha ejecutado en macOS.

## Contexto público y archivo de desarrollo · 2 de octubre de 2026

- Añadido `AGENTS.md` en la raíz y guías de arquitectura, desarrollo y organización de datos. El contexto para continuar el proyecto está en el repo con ejemplos ficticios, sin depender de conversaciones anteriores ni evidencias privadas.
- Separados los diagnósticos y experimentos históricos inactivos en un archivo privado externo con manifiesto y hashes verificados. Conservados los datos reales y demo de OpenClaw, adjuntos, respaldos de fábrica y archivos abiertos por los servicios. Las bases de datos de las familias pasan `quick_check`.
- Las pruebas nativas generan ahora imágenes y ejecutables ficticios en `.cache/note4/firmware-preview/`. Pasan las comprobaciones C++ con ASan/UBSan y las ocho pruebas Python del dispositivo; no se ha flasheado hardware durante esta organización.
- Añadido `test:gateway:isolated`: prepara un perfil temporal a partir de plantillas públicas, sin leer `.local`, arranca un Gateway en un puerto loopback libre y ejecuta autenticación, permisos y alta/reintento/borrado ficticios. Verificado el recorrido y su limpieza al terminar.
- Las cachés y dependencias internas de OpenClaw siguen bajo su administración. La familia demo permanece como estado operativo; no se ha trasladado al archivo de experimentos.

## Vinculación NOTE4 mediante código · 9 de octubre de 2026

- Firmware conectado `nido-ota-0.4.0`: guardar Wi-Fi es independiente de vincular. Tras conectar muestra seis dígitos durante cinco minutos; cinco intentos como máximo, canal SRP-6a/SHA-512 + AES-256-GCM mediante protocomm security2 patch 1. Endpoints limitados a la interfaz doméstica; el AP abierto conserva QR, portal y nombre derivado del hardware.
- El plugin busca el dispositivo mediante mDNS o acepta su IP privada. Obtiene automáticamente endpoint y certificado del puente configurado. Los RPC `discover` y `pairCode` requieren `operator.admin`; la UI no solicita paquetes de vinculación.
- Pasan 168 pruebas TypeScript, typecheck, lint, formato y build. El recorrido aislado del Gateway comprueba autenticación y scopes, incluida la denegación de los nuevos RPC a operadores de solo lectura. Comprobados en el navegador los controles de vinculación con datos ficticios. Una primera ejecución aislada coincidió con la recompilación del plugin y fue rechazada por cambio de archivos; se repitió correctamente después de terminar el build.
- Pasan pruebas nativas ASan/UBSan, nueve pruebas Python, firma RSA y flash simulada. El cliente Node intercambia mensajes con SRP y AES reales del SDK en el host; se rechazan código incorrecto, prueba del dispositivo falsificada y claves públicas inválidas. La pantalla se renderiza a 400 × 300 con datos ficticios.
- Compilación ESP-IDF correcta, aplicación de 1.278.864 bytes. Carga USB autorizada con respaldo e identidad verificados; coinciden los hashes de bootloader, aplicación, particiones y metadatos OTA. Reinicio por watchdog solicitado. Esto no confirma todavía el arranque, la búsqueda mDNS ni la vinculación en hardware; pendiente de comprobación en pantalla y recorrido real.

## Preparación de OTA desde GitHub · 12 de octubre de 2026

- El plugin permite consultar la última release estable y descargar un único `.nidoota` firmado al catálogo local. Permanece desactivado sin `note4Maintenance.github.repository`. La descarga no solicita instalación; se reutiliza la orden OTA explícita existente.
- Las pruebas usan respuestas HTTP ficticias y claves RSA temporales: versión numérica, selección fijada entre consulta/descarga, archivo modificado o truncado, firma incorrecta, tag incompatible, límites de tamaño, redirecciones acotadas y token reservado al host API. No se consultó un repositorio familiar ni se utilizó una credencial real.
- Pasan 177 pruebas, typecheck, lint, formato y build. El Gateway aislado comprueba el estado desactivado sin repositorio y deniega los RPC de consulta/descarga a operadores sin scope administrativo. No se ha reiniciado la instalación real ni cargado firmware para esta preparación.
- Pendiente probar la primera release real cuando exista el repositorio. La consulta y aceptación desde la pantalla del NOTE4 antes de mantenimiento siguen pendientes; esta revisión implementa el recorrido desde el plugin.

## 12 de octubre de 2026 · Plugin para un OpenClaw existente

Verificación en macOS con Node 24.21.0, pnpm 9.0.5 y OpenClaw 2026.9.8, usando exclusivamente familias ficticias y estados temporales.

- 215 pruebas en 22 suites; typecheck, lint, formato y compilación correctos. Los tests del asistente preparan sus propias plantillas temporales y no dependen de una compilación anterior.
- Paquete `.tgz` instalado con el CLI real en un host temporal que ya tenía un agente. Configuración vacía aceptada, asistente demo completado desde el navegador y comprobación automática del estado tras la recarga del plugin.
- Conservados el agente previo, su modelo, el Gateway y las restricciones globales. Comprobado que una ruta de canal sin binding mantiene el agente original al ampliar el grupo.
- Creación de un evento ficticio de cena mediante el Gateway; menú no puede escribir en agenda, el coordinador no puede ejecutar herramientas familiares, agenda no modifica preferencias y menú no tiene terminal.
- La política del plugin impide que Nido lea sesiones del agente ajeno. Los cinco RPC del asistente y OAuth rechazan una conexión con solo `operator.read`.
- Un reenvío de la misma operación devuelve el resultado aplicado sin reescribir la configuración. Conflictos, destinos con enlaces y archivos divergentes se rechazan en pruebas.
- OAuth probado con respuestas simuladas: state, PKCE, caducidad, intercambio de un solo uso, credenciales privadas y reconexión que conserva acceso a los calendarios actuales. El adaptador invalida el token en memoria cuando cambian las credenciales.
- `test:gateway:isolated` mantiene las comprobaciones anteriores de calendario, preferencias y administración NOTE4. No se ha flasheado hardware.
- `release:check` superado. El paquete contiene 55 archivos públicos de código, UI, plantillas y documentación; no contiene estado familiar ni rutas del equipo de desarrollo. La captura de la demo se conserva únicamente en la caché ignorada.

Estas comprobaciones no equivalen a una conversación evaluada con un modelo real ni a una autorización y escritura real en Google. No se ha accedido a la instalación familiar ni publicado el paquete. La UI de terceros debe habilitarse en los Labs del host, y Google sigue requiriendo un cliente OAuth propio.

## OAuth de la app compartida de Nido — 12 de octubre de 2026

Este recorrido sustituye el cliente Desktop propio del asistente descrito en la comprobación anterior. Las instalaciones antiguas y el script de conexión del perfil aislado conservan compatibilidad con esas credenciales.

- La interfaz usa **Conectar con Google**, abre la autorización y consulta su finalización automáticamente. No pide JSON ni acceso a Google Cloud al usuario final.
- El servicio compartido usa un cliente Web, retorno HTTPS fijo, state, PKCE y cookie. Solo inicia la autorización mediante POST desde el origen del OpenClaw solicitante. Un enlace GET reenviado no inicia el flujo.
- El plugin conserva una prueba privada para recuperar la conexión tras reinicios; el servicio cifra los permisos y verificadores. Las respuestas perdidas se reconcilian por lectura, sin repetir el intercambio del código. Los fallos de reconexión se conservan para no presentar la cuenta anterior como una nueva conexión exitosa.
- `pnpm test`: 221 pruebas en 23 archivos. Se comprobaron intercambios concurrentes, permisos insuficientes, origen incorrecto, expiración, respuestas perdidas, reinicios y conservación de credenciales anteriores, con Google simulado.
- `typecheck`, `lint`, `format:check`, compilación y empaquetado: correctos. La revisión de privacidad y el contenido del paquete no incluyen rutas locales ni identidad del desarrollador. El servicio se despliega por separado del plugin.
- Navegador: vista de Google comprobada en un OpenClaw temporal. La fixture `test:oauth:browser` confirmó que el formulario llega mediante POST con el origen correcto a otro puerto local, incluso con la política de referrer del host. También se comprobó el resultado visible en una ventana nueva. Se cerraron las pestañas y los servidores de prueba.

No se ha desplegado el servicio público ni creado el cliente OAuth Web. No se ha usado una cuenta real ni modificado la instalación familiar. La distribución sigue indicando que Google no está disponible hasta configurar el servicio, y la demo funciona. Antes del lanzamiento faltan el consentimiento real, la renovación y revocación con Google, y la comprobación del estado de publicación/verificación de la app. [Activación del servicio](google-oauth-service.md).
