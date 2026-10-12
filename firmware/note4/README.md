# Nido NOTE4: prueba de hardware

<!-- Alcance de main/app_main.cc, main/Kconfig.projbuild y sdkconfig.defaults -->

Firmware para **NOTE4 DevKit monocromo V1.0, ESP32-S3 N16R8, SSD2683, 400 × 300**. Por defecto compila la prueba local de audio, pantalla y reposo, sin red. El modo conectado muestra comida, cena y agenda diaria, envía audio WAV por HTTPS a Nido y dibuja sobre ese fondo ocho vistas en una modal: texto, evento, cambio de plato, pregunta binaria, lista, ficha de datos, comparación y dato destacado. NFC permanece apagado.

El audio PCM de 16 bits, mono, 16 kHz permanece en PSRAM. En modo local se descarta al terminar; en modo conectado se envía y después se libera. La duración máxima predeterminada es 12 segundos. El LED verde indica que el micrófono está preparado: empieza a hablar cuando se encienda. La pantalla se actualiza en paralelo con la captura para evitar perder audio durante un refresco lento. El pico y RMS permiten comprobar señal eléctrica; no prueban por sí solos que la voz se entienda.

## Reglas de diseño

<!-- Reglas objetivo de ../../docs/note4-design-system.md, aplicadas por AGENTS.md -->

Las nuevas propuestas deben seguir el [sistema de diseño del NOTE4](../../docs/note4-design-system.md): cabecera compacta sin logo, fecha del día mostrado, etiquetas auxiliares pequeñas en minúscula y tarjetas con volumen y sombra tramada. La vista diaria y las modales implementan estas reglas; las maquetas guardadas documentan las propuestas validadas. Las comidas de hoy atenúan solo borde y sombra dos horas después de su horario configurado, según los indicadores del puente; mantienen texto negro, tamaño y posición. Sin esos indicadores se muestran normalmente. La distribución se adapta de uno a seis eventos sin cajas vacías; las medidas exactas siguen pendientes de validación visual. La 0.4.7 agrupa las respuestas binarias en una caja sin sombra, con separador tramado y botones estrechos integrados en su borde derecho. Cada respuesta crece independientemente hasta dos líneas; los botones permanecen centrados respecto al separador. Se conserva el tamaño del texto y se recorta con «…» si no cabe. El renderer compartido del símbolo frontal usa contorno fino y trama interior; todavía se reserva para futuras acciones explícitas. Las pruebas nativas generan respuestas cortas, largas y de alturas distintas.

## Compilar y probar en el Mac

<!-- Comandos definidos en ../../scripts/note4-firmware y ../../package.json -->

```sh
./scripts/pnpm run test:note4-firmware
./scripts/pnpm run note4:firmware build
```

El primer comando usa Clang con AddressSanitizer y UndefinedBehaviorSanitizer y el código cJSON del SDK descargado en `.runtime/esp-idf` (sin ejecutar drivers). Comprueba los GPIO permitidos para despertar, botones mantenidos, límites de PCM, texto UTF-8, límite de batería baja, plazos de sesión y el respaldo previo al flasheo. Genera imágenes PGM en `.cache/note4/firmware-preview/`, incluidas citas con duración estimada, horario rectificado, todo el día, cruce de medianoche y pantalla inicial, además de conexión, escucha conectada, errores, textos u opciones largos y las trece muestras de `tests/fixtures/note4-cards.json`. El mismo JSON se valida en TypeScript y se decodifica y dibuja en C++ con comprobaciones de límites; un payload inválido no reemplaza la tarjeta anterior. El parser del resumen acepta `calendarLabel` opcional (hasta 64 bytes UTF-8); un nombre excesivo no sustituye la caché anterior. El instalador OTA se prueba con Mbed TLS del SDK compilado para el host y flash/bootloader simulados: RSA real, firma incompatible, transferencia por bloques, hash alterado, fallos de escritura/lectura, abortos y guardia de arranque. El cliente Node se prueba contra SRP-6a y AES-GCM reales del SDK con credenciales ficticias; rechaza código incorrecto, prueba falsificada y claves públicas inválidas. El segundo binario comprueba fechas UTC, caché válida, transiciones de conversación y tramado de cabecera y centrado de la modal; genera siete vistas diarias (de cero a seis eventos) y modales de conversación, mantenimiento y vinculación. No simula el consumo ni los drivers eléctricos.

<!-- Vistas y avisos de main/nido_screens.cc, main/nido_small_font.cc, main/nido_home.cc, main/nido_ui.h, main/nido_device.cc y main/app_main.cc -->

El resumen diario completa los huecos con eventos de días siguientes disponibles en la caché, con borde y sombra atenuados, texto negro nítido de menor tamaño y nombre del día de la semana pequeño arriba a la izquierda solo en la primera tarjeta de cada día futuro y el rótulo «agenda». Mantiene comidas y cabecera del día seleccionado. El nombre corto del calendario aparece abajo a la izquierda en una fuente de 3 × 5 dentro de celdas de 4 × 7, menor que los horarios; si no cabe junto al horario, ocupa la línea superior del pie. Los horarios van en pequeño abajo a la derecha, con diez píxeles de margen inferior y espacio reservado, y se omiten para todo el día; a partir de siete días de distancia se añade DD/MM al nombre del día. Muestra comida, cena y hasta seis eventos en tarjetas con contorno redondeado y sombra tramada desplazada 3 píxeles a la derecha y 4 hacia abajo. La cabecera no tiene marca: muestra la referencia relativa junto a la fecha del día visible, con iconos compactos de actualización, error y batería baja a la derecha. Los datos usan la fuente de 8 × 16; los auxiliares son minúsculos, en una fuente bitmap de 5 × 7 dentro de celdas de 6 × 10. El refresco sigue siendo monocromo de 1 bit.

Los eventos de varios días ya iniciados se sitúan primero; después van los de todo el día y las citas por horario. Los de todo el día no muestran horario ni etiqueta «todo el día». Los de varias fechas permanecen disponibles al navegar por los días que abarcan, pero aparecen una sola vez por grid, con un intervalo de fechas inclusivas arriba a la izquierda (por ejemplo, «01/10 - 03/10») y sus horas de inicio y fin abajo a la derecha cuando tienen horario. Hoy se ocultan las citas ya terminadas. Se distribuyen de uno a tres en una fila; cuatro en dos filas de dos; cinco y seis en dos filas de tres, sin cajas vacías. «+N» indica los que no caben.

Las ocho vistas del agente se presentan en una modal blanca con contorno y sombra centrada en la pantalla sobre el resumen atenuado por una trama que cubre también la cabecera. Se conserva el día de origen detrás de la modal. Las preguntas binarias tienen dos opciones asociadas a los laterales; las abiertas se responden por voz. Los errores del agente explican lo ocurrido; los resultados inciertos no se vuelven a ejecutar automáticamente. Un fallo de actualización del resumen conserva los datos y muestra solamente un icono.

Después de un resultado se vuelve a leer Calendar. Si el agente publica `affectedDates` con exactamente una fecha y `status done`, se muestra ese día tras actualizarlo correctamente. Consultas, cambios de varias fechas, éxitos parciales y errores conservan la modal y el contexto. Si el cambio se guardó pero falla el refresco, la modal distingue ambos resultados.

El texto se ajusta al espacio disponible y termina con «…» al recortarse, sin dividir caracteres UTF-8. Las funciones de tarjetas sin modal se conservan para las pruebas de transporte y renderizado; la ruta conectada usa el resumen y las modales nuevos. El firmware anuncia `X-Nido-Card-Version: 2`; el servidor mantiene la conversión a texto para clientes antiguos.

<!-- Ajuste PHY de sdkconfig.defaults y restricción documentada por ESP-IDF components/esp_phy/Kconfig -->

Se desactiva `ESP_PHY_ENABLE_USB` para que la radio no mantenga activo el circuito USB durante Wi-Fi. ESP-IDF advierte de interferencias entre USB y Wi-Fi en ESP32-S3. La consola USB puede desaparecer durante la consulta; la carga eléctrica por el cable es independiente. El modo ROM para flashear sigue accesible con frontal y RESET. Esta opción debe aplicarse también al sdkconfig local de una compilación existente.

El segundo necesita ESP-IDF **v5.4.2** y herramientas instaladas dentro de `.runtime/`. En este proyecto se prepara así, desde la raíz:

```sh
git clone --depth 1 --branch v5.4.2 --recursive --shallow-submodules \
  https://github.com/espressif/esp-idf.git .runtime/esp-idf
IDF_TOOLS_PATH="$PWD/.runtime/esp-tools" ./.runtime/esp-idf/install.sh esp32s3
IDF_TOOLS_PATH="$PWD/.runtime/esp-tools" \
  python3 .runtime/esp-idf/tools/idf_tools.py install cmake ninja
```

Si Python en macOS no encuentra certificados, usa `SSL_CERT_FILE=/etc/ssl/cert.pem` en esos comandos. La verificación TLS debe seguir activada. Los wrappers usan el entorno aislado; no es necesario modificar la instalación global de Python ni ejecutar `export.sh` a mano.

## Configurar la conexión con Nido

<!-- Configuración de ../../scripts/note4-setup.mjs, ../../scripts/note4-bridge.mjs y main/nido_device.cc y main/nido_pairing.cc -->

`note4:setup` prepara el puente HTTPS (endpoint, certificado y clave), sin compilar credenciales familiares. El firmware conectado genérico se configura desde su propia web: frontal + lateral inferior cinco segundos, soltar ambos y conectar a la red indicada en la modal. Sin configuración entra automáticamente en el primer arranque. Guarda primero la Wi-Fi sin archivos ni vinculación obligatoria. Para activar voz y agenda, introduce en los ajustes administrativos del plugin el código de seis dígitos que muestra el NOTE4 tras conectar. «Buscar Note4» lo localiza en la red de casa; se puede introducir su IP como alternativa. Los mismos ajustes sirven después para voz, resumen y OTA.

```sh
./scripts/pnpm run note4:setup
./scripts/pnpm run build
./scripts/pnpm run note4:bridge
# Compilación conectada sin cabecera privada:
./scripts/note4-firmware build-generic
```

La configuración persistente tiene su propia partición NVS. Se guarda una candidata antes de probarla y se conserva la activa si falla. El token del Gateway no se envía al NOTE4. [Configuración, firma, primera migración y OTA](../../docs/note4-maintenance.md) describe la clave pública necesaria para instalar actualizaciones, los scopes administrativos y la recuperación.

El servicio usa por defecto el Gateway familiar y sus calendarios de Google configurados. `nido-note4` delega en los agentes `menu` y `agenda` existentes; las conversaciones aparecen en el dashboard familiar, normalmente en el puerto 18789. Para pruebas aisladas arranca el dashboard demo y usa `pnpm run note4:bridge -- --demo`. Cambiar el destino del puente no requiere flashear si endpoint y token del dispositivo siguen iguales.

Usa la transcripción de OpenClaw con el proveedor/credenciales configurados para Nido. El WAV temporal del Mac se elimina después de transcribir; una interrupción del proceso se limpia al reiniciar. La petición al proveedor utiliza audio real.

Cada envío lleva un UUID: repetir los mismos bytes con el mismo UUID consulta/reutiliza el turno; no repite la acción. Un turno con efectos inciertos no se vuelve a ejecutar automáticamente. Este corte tiene un dispositivo y un turno activo a la vez.

## Conectar, respaldar y flashear

<!-- Comandos y comprobaciones de ../../scripts/note4-device.py y ../../scripts/note4-firmware -->

Necesitas un cable USB-C de **datos**. Conecta el dispositivo y enciéndelo con el lateral inferior si es necesario.

```sh
./scripts/note4-device list
./scripts/note4-device backup
# Guarda la ruta JSON que devuelve el respaldo:
./scripts/note4-firmware flash --backup .local/note4/backups/ARCHIVO.json
./scripts/note4-firmware monitor -p /dev/cu.usbmodemXXXX
```

El respaldo lee los 16 MiB completos, verifica el contenido contra el dispositivo y registra SHA-256, identidad y puerto. Los archivos se guardan con permisos privados y quedan fuera de Git. El flasheo requiere ese respaldo válido y la misma identidad del dispositivo. Solo admite USB Espressif, ESP32-S3 y flash de 16 MB; el software **no puede distinguir por USB** un NOTE4 monocromo de un NOTE4C, por lo que debes confirmar el modelo físico.

El flasheo espera hasta 60 segundos a que aparezca el USB. Si el dispositivo vuelve a dormir antes de conectar, mantén el frontal, pulsa el RESET hundido y suelta el frontal para entrar en el cargador ROM. En ese modo usa `./scripts/note4-device flash --manual-boot --backup RUTA_JSON`. Tras verificar la carga, el script solicita automáticamente un reinicio mediante watchdog RTC, también con `--manual-boot`; esa opción solo cambia cómo se entra al cargador. El reset anterior mediante RTS no arrancó el firmware tras LOAD manual, según la comprobación física del usuario. El usuario confirmó el arranque mediante watchdog en este NOTE4; el éxito del comando por sí solo no confirma cada arranque. Se recurre al RESET físico si no arranca. Para solicitar solo el reinicio, sin volver a escribir flash: `./scripts/note4-device reset` (añadir `--manual-boot` si ya está en LOAD). Para las próximas cargas se intenta primero la entrada automática de esptool; el modo manual queda como alternativa si no consigue entrar a ROM. `restore` también admite `--manual-boot`.

Para observar un minuto de logs, reconectando cuando el reposo profundo desconecta USB: `./scripts/note4-device capture --port /dev/cu.usbmodemXXXX --seconds 60`. El monitor usa un descriptor POSIX en macOS/Linux, sin enviar cambios DTR/RTS, y desactiva el cambio de líneas al cerrar. `--reset` solicita el reinicio mediante watchdog únicamente al dispositivo conectado al comenzar; falla si está dormido y no aplaza el reinicio a la próxima pulsación. Las lecturas largas del respaldo tienen un plazo de 15 minutos; su progreso queda en `.local/note4/device-read_flash.log`.

Restauración del firmware de fábrica, usando el mismo respaldo:

```sh
./scripts/note4-device restore --backup .local/note4/backups/ARCHIVO.json
```

Si hay varios USB Espressif, `note4-device` admite `--port PUERTO`. Para cargar el build genérico añade `--build-dir .cache/note4/generic/build`, manteniendo `--backup`. No utiliza `erase_flash` ni borra toda la flash durante el flasheo, pero sí reemplaza bootloader, tabla de particiones y aplicación. La primera migración habilita dos particiones OTA; las siguientes instalaciones de aplicación conservan configuración y bootloader.

<!-- Mantenimiento y OTA de main/nido_config.cc, main/nido_device.cc, main/nido_ota.cc, main/nido_github.cc, main/nido_github_policy.h, partitions.csv y ../../scripts/note4-ota.mjs -->

Desde `nido-ota-0.4.2`, antes de abrir el AP se consulta GitHub con la Wi-Fi guardada: una versión posterior ofrece «Actualizar» (superior) o «Configurar» (inferior/frontal, también tras treinta segundos). Consulta acotada, TLS con certificados raíz, redirecciones limitadas, búfer de petición de 4096 bytes para las URLs firmadas largas de GitHub y paquete firmado; sin red, reloj válido o novedades se abre la configuración habitual. El repositorio público `Davidhidalgo/nido` se fija en `nido_github.cc`, sin credenciales. Las pruebas nativas cubren versiones, selección de asset, redirects, chunks y descargas corruptas con HTTP simulado y firma real. La validación física de esta ruta sigue pendiente.

El nombre `Nido-XXXXXX` usa los tres últimos bytes de la MAC de fábrica en eFuse y permanece estable entre reinicios y actualizaciones. La modal de mantenimiento muestra un QR Wi-Fi con la red temporal abierta, sin contraseña; conserva el nombre y la dirección web como alternativa. Al pie de la modal se muestra en tipografía mínima la versión del firmware activo, obtenida de su descriptor, para comprobar qué aplicación ha arrancado tras una OTA. El QR se genera en el dispositivo con Nayuki v1.8.0 (MIT), con módulos enteros de tres píxeles y margen blanco de cuatro módulos.

El código de vinculación dura cinco minutos y admite cinco intentos; el intercambio usa `protocomm_security2` patch 1 por la interfaz de la Wi-Fi doméstica. El componente administrado `espressif/mdns` 1.8.2 anuncia el dispositivo. La web temporal permite cambiar Wi-Fi/iniciar vinculación y subir `.nidoota` firmado. Un DNS limitado a la interfaz AP y redirecciones HTTP ofrecen apertura como portal cautivo; si el móvil no muestra la ventana o no admite archivos, se abre `http://192.168.4.1` en su navegador. La comprobación de interfaz admite IPv4 y direcciones IPv4 mapeadas en sockets IPv6. Sale por la misma combinación de botones, por la web o tras diez minutos sin actividad. El firmware comprueba órdenes del plugin después de sincronizar el resumen y fuera de conversación. El instalador verifica firma RSA-2048/SHA-256, modelo, tamaño, hash y descriptor, exige al menos 40 % de batería válida o alimentación externa sin fallo y escribe la aplicación inactiva. El arranque se confirma después de inicializar configuración, placa y pantalla; rollback y guardia de arranque conservan la versión anterior si no se confirma. Umbral, AP, botones y recuperación física permanecen pendientes de validación en hardware. [Guía de mantenimiento](../../docs/note4-maintenance.md).

## Reposo y RTC

<!-- Política de main/app_main.cc, main/nido_power_policy.h y main/Kconfig.projbuild -->

- En modo local, el arranque muestra instrucciones y conserva el flujo de grabación y reposo profundo para comprobar hardware.
- En modo conectado, el arranque descarga quince días alrededor del día seleccionado. La caché reside en RAM; navegar entre esos días no requiere red. Al salir del intervalo se solicita otro bloque. Un reinicio pierde esa caché y vuelve a descargarla.
- Un clic frontal de menos de 200 ms descarta el audio, cierra una modal en espera o terminada, vuelve a hoy y pide una actualización. Una pulsación más larga envía el audio al soltar. La distinción no añade una espera al inicio de captura: se mantiene la preparación del codec existente y se mide la liberación mientras el audio se prepara o captura.
- El modo conectado usa reposo ligero para que también GPIO39 (superior) pueda despertar. Ambos laterales navegan por días; una pregunta binaria los usa como respuestas. Los botones mantenidos no deben generar acciones repetidas. El modo local conserva reposo profundo y los disparadores GPIO0/GPIO18.
- Wi-Fi empieza a conectar en una tarea al pulsar el frontal, mientras se captura audio, y utiliza ahorro de módem. Se reutiliza la asociación durante la conversación; sin conversación activa, se apaga tras la ventana de 60 segundos de voz o 5 segundos de una actualización del resumen. La pantalla de progreso se pinta después de iniciar el envío. El envío espera a que terminen la conexión anticipada y la descarga del resumen; si no hay memoria para anticipar la conexión, conecta al enviar. TLS se sigue creando por intercambio. La captura y la radio simultáneas requieren validación física de audio, memoria y consumo.
- El resumen se actualiza cada cinco minutos desde una descarga correcta, y tras un clic o turno. Un fallo se reintenta después de cinco minutos. Actualización y caducidad de conversación tienen temporizadores independientes.
- El servidor envía `sessionExpiresAt`: un minuto tras resultados y tres minutos tras preguntas; los sondeos y lecturas del resumen no lo renuevan. Al caducar, se abandona la pregunta, se cierra la modal y se vuelve a hoy con los datos disponibles, sin exigir red. La siguiente petición abre una sesión nueva en el servidor. Un clic que abandona una pregunta también invalida esa sesión para impedir que se reactive por voz.
- Pantalla, audio y LED se apagan entre acciones. Bluetooth y NFC permanecen desactivados. Falta medir el consumo de este recorrido con reposo ligero y actualizaciones periódicas.

El RTC PCF8563 aporta la hora de arranque si es válida y se sincroniza en UTC con el servidor autenticado tras las lecturas y los turnos. La cabecera interpreta la fecha en Europe/Madrid y calcula los saltos de día con aritmética UTC independiente del cambio de hora. La prueba opcional de cuenta atrás del RTC que sigue corresponde al modo local.

Para comprobar el RTC sin pantalla ni red, ejecuta `./scripts/note4-firmware menuconfig`, configura `NIDO_RTC_WAKE_TEST_SECONDS=60` y recompila. En el primer reposo después de un arranque en frío se programa una única cuenta atrás. El RTC debe despertar por GPIO5, informar `rtc_probe=interrupt received` y volver a dormir sin repintar. Si USB no llega a enumerarse en ese despertar breve, el resultado se conserva en memoria RTC y se imprime al terminar la próxima grabación: `rtc_probe_result=1` confirma la interrupción; `2` indica una interrupción ajena o el temporizador alternativo. El temporizador interno del ESP32 es una alternativa de diagnóstico cinco segundos después. La prueba está desactivada por defecto y no crea despertares periódicos.

El reloj del dispositivo usa UTC; el agente sigue interpretando las fechas familiares en Europe/Madrid. El contador del RTC permite esta prueba aunque todavía no haya una fecha válida.

## Validación en el dispositivo

La prueba física del 30 de septiembre confirmó la tarjeta «Audio capturado», dos grabaciones y el despertar desde reposo con el frontal. El RTC despertó por GPIO5 y volvió a dormir sin repintar ni iniciar audio o red. Se conserva el respaldo de fábrica completo y verificado. [Resultados y límites](../../docs/verification.md).

El éxito de la compilación o del simulador no confirma el consumo. Con hardware hay que comprobar:

1. Repetir desde batería con USB desconectado: despertar con el frontal, grabar y ver el resultado.
2. Confirmar que el LED aparece al estar preparado, que el audio no se corta al repintar y que el límite de duración funciona.
3. Probar RTC, lateral inferior y un frontal mantenido al alcanzar el límite.
4. Medir corriente desde el trayecto de batería, con USB desconectado: reposo estable y energía de cada interacción. USB alimenta el equipo y altera la medida.
5. Comparar el consumo con el firmware de fábrica bajo condiciones equivalentes. No hay todavía una autonomía medida ni garantizada.

## Procedencia

<!-- Componentes de components/, sus ORIGIN.md y THIRD_PARTY_NOTICES.md -->

Drivers de placa y pantalla, y canvas, adaptados de Hearth, commit `edd75fd7ea7e9879b141a84aa39ce2c74b6c92bc`; proceden del ejemplo oficial de Zectrix. Se conservan las licencias MIT y la OFL de la tipografía. El canvas añade decodificación UTF-8 y marcas para español en NFC; los caracteres no soportados ocupan un único glifo de sustitución. [Licencias y cambios locales](THIRD_PARTY_NOTICES.md).

Referencias: [guía oficial](https://wiki.zectrix.com/en/software/note4-development-guide), [esquema V1.0](https://wiki.zectrix.com/sch_zectrix_note4_developer_kit_v1.0_en.pdf), [reposo del ESP32-S3](https://docs.espressif.com/projects/esp-idf/en/v5.4.2/esp32s3/api-reference/system/sleep_modes.html), [RTC](https://www.nxp.com/docs/en/data-sheet/PCF8563.pdf).

<!-- feedback sounds from main/nido_sounds.h and main/app_main.cc -->

Las grabaciones con menos de un segundo de PCM capturado se descartan como pulsaciones accidentales, restaurando la vista anterior sin enviar audio ni interrumpir el turno activo. La preparación del codec no cuenta en ese segundo. El clic frontal de menos de 200 ms conserva su acción de volver a hoy o detener una petición.

El firmware incorpora cuatro sonidos originales: inicio (120 ms, durante la preparación existente del codec), pregunta (350 ms), resultado (250 ms) y error/resultado parcial (350 ms). Los sonidos se reproducen una vez al mostrar la primera tarjeta de pregunta o resultado, sin esperar al cierre posterior del turno en el servidor, sin sonar en cada sondeo ni refresco. Los avisos de respuesta, pregunta y error incluyen 80 ms de silencio inicial para estabilizar DAC/amplificador y 20 ms al final, conservando el PCM aprobado. Esta preparación no se añade al inicio de captura. El volumen de salida usa 80/100 (−10 dB en la curva del driver), y al activar el altavoz se retira explícitamente el silencio del DAC. Volumen y posible entrada del aviso de inicio en el micrófono requieren validación física.

<!-- active turn cancellation from main/nido_device.cc and ../../scripts/note4-bridge.mjs -->

Un clic frontal de menos de 200 ms durante el procesamiento solicita la parada nativa `chat.abort` de OpenClaw y vuelve a hoy al recibir el acuse. El servidor conserva el turno como cancelado y evita que se reactive al finalizar el worker. La parada no revierte escrituras ya ejecutadas; un fallo de la solicitud muestra incertidumbre. El clic se detecta entre sondeos; una petición HTTPS en curso puede retrasar su detección.

<!-- recording while processing from main/app_main.cc and main/nido_ui.h -->

La red y el polling se ejecutan en una tarea separada con 16 KB de pila; las tarjetas y resultados de la cola se asignan explícitamente en PSRAM, y el envío escribe el resultado por referencia para evitar copias grandes en la pila. La tarjeta inicial de conexión se asigna en el heap. Antes de crear la tarea se permite liberar las pilas de captura y refresco finalizadas. Se puede iniciar otra grabación mientras el turno anterior procesa; al soltar una grabación válida se interrumpe el turno activo y se continúa en la misma sesión con la aclaración y el contexto anterior. Las tarjetas del agente se aplican en el hilo principal después de la captura, evitando que su sonido compita con el micrófono. El clic breve durante procesamiento solicita parada y descarta audios todavía no enviados. El aviso de grabación incorpora 60 ms de silencio dentro de la preparación existente del codec; el altavoz permanece activo hasta cumplirse la duración del sonido y su margen de vaciado DMA, con 20 ms de silencio final, sin retrasar la entrada. Los bloques de entrada ya almacenados no se usan como reloj del altavoz. Un audio con muestras capturadas nunca se interpreta como clic, aunque la pantalla haya observado una liberación breve. Ambos ajustes requieren validación física.

<!-- continuation after interruption from ../../integrations/nido-family/src/note4-device.ts -->

`POST /v1/turns/{uuid}/cancel?continue=1` espera a que termine el worker detenido y conserva la sesión para el siguiente audio. Ese mensaje lleva una marca de aclaración usada una sola vez; el bridge refresca los eventos antes de continuar. El clic breve usa la parada ordinaria, sin conservar la sesión. Una parada incierta no envía automáticamente la aclaración y lo explica en pantalla.

<!-- Latency measurements from main/nido_device.cc and ../../integrations/nido-family/src/note4-device.ts -->

Las trazas `latency` del firmware separan conexión Wi-Fi y petición HTTP (incluye TLS y transferencia). El bridge escribe eventos JSON `note4_latency` con identificador de turno y milisegundos de transcripción, agente y total; no incluye audio ni transcripción. Estas medidas no afirman todavía una reducción observada en hardware. El transporte sigue enviando un WAV completo y OpenClaw sigue transcribiendo después de recibirlo: el streaming de audio/transcripción es la siguiente fase, no está activo.
