# Spec: OTA directa desde GitHub al entrar en mantenimiento

This specification owns the OTA contract and acceptance details. Current follow-ups, including physical verification, are tracked centrally. See [next steps](next-steps.md) and [session workflow](session-workflow.md).

Estado: implementado en firmware desde `nido-ota-0.4.2`, con pruebas nativas y compilación ESP-IDF. El usuario confirmó la instalación física mediante OTA directa de 0.4.4 a 0.4.5 el 2026-10-12, después de corregir el búfer de petición para las redirecciones largas. La recuperación ante cortes y el rollback provocado siguen pendientes de prueba física. La release `nido-ota-0.4.1` solo admite el recorrido mediante el plugin.

## Repositorio y artefacto

Repositorio público: `Davidhidalgo/nido`. No se incorpora un token de GitHub al NOTE4. Cada release estable incluye exactamente un archivo `.nidoota` firmado con la clave privada externa al repositorio. El tag `nido-ota-X.Y.Z`, el manifiesto firmado y el descriptor ESP-IDF deben declarar la misma versión. Nunca sustituir el contenido de una versión publicada.

La clave pública instalada en el dispositivo es la raíz de confianza. TLS verifica el servidor de descarga, y la firma RSA-2048/SHA-256 verifica el firmware independientemente de GitHub. La clave privada, credenciales de Wi-Fi, tokens de dispositivos y respaldos no forman parte de la release. Se compila exclusivamente con `build-generic` y se publica el paquete de aplicación firmado, no un volcado de flash.

## Entrada y elección

1. Mantener frontal + lateral inferior cinco segundos y soltar ambos. Descartar audio según el gesto existente.
2. Con Wi-Fi guardada, intentar conectar y consultar la última release estable antes de abrir el AP. Mostrar progreso breve y acotar toda esta fase a veinte segundos. Sin red guardada, ir directamente al mantenimiento con QR.
3. Aceptar solo metadatos acotados de una release estable compatible, con una versión numéricamente posterior y un único `.nidoota`. No usar orden lexicográfico ni proponer versiones iguales o anteriores. La información de GitHub es una propuesta; la firma se verifica antes de escribir firmware.
4. Mostrar «Nueva versión disponible: X» con «Actualizar» en lateral superior y «Configurar» en lateral inferior. Un clic frontal o treinta segundos sin elección continúa a configuración. Entrar en mantenimiento no autoriza por sí solo instalar.
5. «Configurar», ausencia de novedades, falta de red, límite de API, timeout o metadatos inválidos llevan al AP habitual y su QR. Un fallo de GitHub nunca impide configurar el dispositivo.

La pantalla debe usar el renderer de 400 × 300, modal y reglas de `note4-design-system.md`. Generar y validar la propuesta visual antes de cargarla en hardware.

## Descarga e instalación

Al aceptar, conservar la URL del asset bajo el tag, su tamaño y la versión mostrada, para que una nueva publicación no cambie el destino a mitad del proceso. Descargar directamente por HTTPS desde GitHub, con redirecciones limitadas a sus hosts de assets, tamaño máximo, cinco segundos por operación HTTP y tres minutos para la transferencia completa. Reservar 4096 bytes para la petición HTTP: las URLs firmadas de redirección pueden superar el búfer predeterminado de ESP-IDF (512 bytes), aunque estén dentro del límite permitido de 2048. Una prueba ficticia reproduce la redirección larga y exige completar la instalación. No seguir URLs arbitrarias ni desactivar la validación TLS. Usar el reloj del RTC o sincronizado con Nido. Si no tiene una fecha válida, continuar a configuración sin instalar; no se omite la validación temporal de TLS ni se incorpora un servicio horario nuevo.

Reutilizar el lector `.nidoota`, `OtaWriter`, clave pública y comprobaciones existentes: modelo NOTE4 monocromo, configuración compatible, firma, longitud, hash, descriptor y energía suficiente. Exigir batería válida de al menos 40 % o alimentación externa sin fallo. Escribir solo la aplicación inactiva, conservando NVS, Wi-Fi, vinculación, bootloader y particiones. Reiniciar solo tras la verificación completa.

During an accepted installation, retain the daily view with a small header download icon. A configured connected boot confirms the application after configuration, board and display-controller initialization without refreshing the panel. Keep its physical image until a successful home response; failed network retries must not replace it with an empty view. Explicit voice/setup interactions may replace it. Existing rollback and the boot guard recover the previous application if confirmation fails. An interrupted download is not installed again automatically; retain the active application and offer configuration. Do not add irreversible antirollback or burn eFuses.

## Convivencia con el plugin

Se mantienen la subida local y las órdenes OTA del plugin. La instalación directa debe comprobar que no hay otra instalación activa. Persistir la versión objetivo con identificador de trabajo del plugin vacío para distinguir el origen directo tras reinicio, y comunicar la nueva versión al puente en la siguiente conexión. Una operación del plugin incierta no se resuelve suponiendo que la instalación directa la completó: debe aplicarse el contrato de observación y reconciliación existente.

La configuración `note4Maintenance.github.repository` solo afecta al plugin. El firmware fija explícitamente `Davidhidalgo/nido` en `nido_github.cc`; cambiarlo requiere otra compilación. No lo infiere de datos familiares ni acepta repositorios suministrados por contenido del modelo.

## Publicación y aceptación

Antes de publicar: comprobaciones del plugin, pruebas nativas, compilación genérica, revisión de secretos del índice y commit, firma externa, inspección del paquete y verificación de su descarga pública. Publicar primero como borrador, adjuntar los artefactos completos y comprobarlos antes de marcar la release estable como última.

Pruebas ficticias: versión igual/anterior/nueva, prerelease, assets ambiguos, respuesta gigante, redirección ajena, falta de reloj/red, batería baja, firma/modelo/hash incorrectos, corte de descarga y conservación de configuración. Probar renderizado de progreso y elección. Las comprobaciones físicas posteriores deben cubrir entrada por botones, elección de ambas opciones, descarga pública, primer arranque y recuperación; compilar no acredita estas comprobaciones.
