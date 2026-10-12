# Configuración y OTA del NOTE4

Implementación de software para NOTE4 monocromo V1.0, ESP32-S3 N16R8. La compilación y las pruebas ficticias no verifican todavía el punto de acceso, el consumo, la combinación de botones ni el rollback físico. No cargar esta migración sin el respaldo completo y validado exigido por `note4-device`.

## Configuración y credenciales

El firmware conectado es común: no incorpora la Wi-Fi, el token ni el certificado de una familia. Conserva configuración versión 1 en una partición NVS propia, `nido_config`, separada de PHY y de las aplicaciones. La misma SSID/contraseña conecta voz, resumen y descarga OTA. Endpoint HTTPS, certificado público y token propio autentican las consultas y actualizaciones contra el puente. El punto de acceso temporal es abierto, sin contraseña. El Gateway, Google y los proveedores mantienen sus credenciales en el servidor.

El almacenamiento NVS no se borra automáticamente y las credenciales no se devuelven desde la web. Esta versión no configura cifrado de flash ni quema eFuses de Secure Boot. La firma OTA protege el instalador de Nido; no impide que alguien con acceso físico sustituya firmware por USB.

## Entrada en mantenimiento

Sin configuración, el primer arranque abre mantenimiento. Con configuración, mantener frontal y lateral inferior simultáneamente cinco segundos; soltar ambos cuando lo solicite la pantalla. Una combinación incompleta se consume sin enviar voz. Si el lateral se pulsa durante captura, se descarta el audio, se libera el codec y se mide la combinación antes de entrar. Se cancelan trabajos pendientes con el mecanismo existente, conservando efectos familiares ya realizados. Si una conexión aún no ha terminado, el punto de acceso no se inicia sobre ella.

La pantalla conserva la estructura de modal existente y muestra red `Nido-XXXXXX` y `http://192.168.4.1`. El sufijo son los tres últimos bytes de la MAC de fábrica grabada en eFuse: permanece igual al reiniciar, volver a entrar en mantenimiento o actualizar firmware. Es un nombre reconocible, no una credencial ni una garantía global de unicidad. Escanear el QR de la pantalla para conectar a esa red abierta, o seleccionarla manualmente. El QR contiene solo el nombre de la red temporal, no las credenciales de casa ni la vinculación. El DNS local y las redirecciones HTTP anuncian un portal cautivo para que iOS/Android ofrezcan abrir la configuración. La aparición de la ventana depende del sistema; si no aparece o no permite elegir archivos, abrir `http://192.168.4.1` en el navegador. No hay aplicación móvil. La web solo acepta conexiones por la interfaz AP, acepta IPv4 y su representación IPv6 mapeada, comprueba Host/Origin y usa un token de sesión para acciones. El punto de acceso no se publica en la red doméstica. Al ser una red abierta con web HTTP, una persona próxima puede conectarse durante mantenimiento y el tráfico de configuración no está cifrado por Wi-Fi.

Salir desde la web o mantener de nuevo la combinación cinco segundos y soltarla. Caduca tras diez minutos sin actividad; una transferencia activa no se cierra a mitad. Sin configurar, al salir se muestra cómo volver a entrar, sin abrir continuamente otra red. Entrar/salir no elimina los ajustes.

## Preparar el puente y el plugin

`pnpm run note4:setup` prepara endpoint, certificado y clave HTTPS del puente. Conserva un token antiguo si existe, pero ya no genera una cabecera de credenciales ni habilita un sdkconfig privado. Este comando modifica estado operativo: ejecutarlo únicamente al configurar una instalación autorizada.

Añadir al objeto de configuración de `nido-family`, manteniendo sus demás campos:

```json
{
  "note4Maintenance": {
    "publicKeyFile": "/ruta/privada/firmware-public.pem",
    "bridgeConfigFile": "/ruta/privada/note4/device.json"
  }
}
```

`bridgeConfigFile` apunta al archivo generado por `note4:setup`; el plugin obtiene de él el endpoint y lee `server-cert.pem` en su mismo directorio. No requiere seleccionar certificados en el navegador. La clave pública es la misma que se incorpora al firmware por USB. Se puede usar `note4Maintenance: {}` para configurar el dispositivo sin habilitar publicaciones OTA. La ausencia de `note4Maintenance` mantiene deshabilitado este servicio. Activarlo tanto en el Gateway familiar como en el demo si se quieren usar ambos, con almacenamientos separados. El puente y el plugin comparten `<dataDir>/note4-maintenance/` de la instalación seleccionada.

Compilar el plugin y arrancar el Gateway y el puente según las guías existentes. Los nuevos controles aparecen al final de Settings → Plugins → Nido Family → Configuration con la adaptación local de Settings. La adaptación verifica las estructuras de OpenClaw 2026.9.4/2026.9.8 antes de modificar los assets. Un plugin distribuido sin esta adaptación conserva los RPC administrativos, pero no añade esos controles al formulario genérico.

## Vincular mediante código

1. Entrar en mantenimiento y conectar el móvil a la red abierta del NOTE4 mediante el QR.
2. Introducir la Wi-Fi doméstica de 2,4 GHz y pulsar «Comprobar y guardar Wi-Fi». Funciona sin archivos ni vinculación previa.
3. El NOTE4 muestra un código de seis dígitos al conectarse. Volver a la red de casa y abrir Settings → Plugins → Nido Family → Configuration.
4. Pulsar «Buscar Note4», seleccionarlo, introducir el código y pulsar «Vincular con Nido». El Gateway debe estar en la misma red local; si el descubrimiento está bloqueado, introducir la IP mostrada en el dispositivo.
5. El NOTE4 confirma la vinculación, cierra mantenimiento y vuelve al resumen. Wi-Fi, endpoint HTTPS, certificado público y token propio quedan guardados para voz, agenda y OTA.

El código dura cinco minutos, admite cinco intentos y se consume al completar la vinculación. Solo aparece en la pantalla física. Para obtener otro, salir y volver a entrar en mantenimiento. Si ya estaba vinculado, cambiar la Wi-Fi conserva la vinculación; «Mostrar código» en la web inicia una nueva vinculación explícita. Sin vinculación y con Wi-Fi guardada, entrar en mantenimiento vuelve a mostrar un código tras conectar.

El dispositivo anuncia `_nido-pair._tcp` mediante mDNS. El plugin hace consultas desde interfaces privadas y acepta IPv4 privadas explícitas como alternativa; no sigue redirecciones. Los endpoints de vinculación solo aceptan conexiones por la IP de la Wi-Fi doméstica, nunca por la interfaz del punto de acceso abierto. La web de configuración sigue limitada al AP. La vinculación utiliza `protocomm_security2` patch 1 de ESP-IDF: SRP-6a/SHA-512 con grupo de 3072 bits y AES-256-GCM. El plugin verifica la prueba del dispositivo antes de crear y enviar la autorización; no transmite el código en claro. El anuncio mDNS sirve para localizar, no para autenticar.

El plugin entrega automáticamente una autorización temporal y el certificado del puente mediante el canal cifrado. El NOTE4 genera su token, guarda una candidata antes de canjear la autorización mediante HTTPS y persiste la activa solo al confirmar. La hora autenticada incluida permite iniciar TLS antes de sincronizar el RTC. Si se pierde la respuesta, comprobar pantalla y estado antes de repetir: el plugin conserva la misma autorización durante diez minutos en ese proceso y el dispositivo conserva el token candidato para reconciliarla. Un reinicio del plugin pierde esa caché temporal; no repetir ciegamente una operación incierta.

Una autorización usada por otro dispositivo o token se rechaza. Vincular de nuevo el mismo dispositivo rota su token; una autorización antigua no puede restaurarlo. El puente admite un solo NOTE4. Un cambio de IP del puente requiere volver a vincular. Los RPC y el receptor del paquete antiguo se conservan por compatibilidad, pero la interfaz ya no pide descargar ni importar un archivo de vinculación.

## Compilar y firmar firmware

Crear la clave privada de firma fuera del checkout y conservar una copia segura. `keygen` no sustituye archivos existentes:

```sh
pnpm run build
pnpm run note4:ota -- keygen /ruta/privada/firmware-private.pem /ruta/privada/firmware-public.pem
NIDO_OTA_PUBLIC_KEY_FILE=/ruta/privada/firmware-public.pem \
NIDO_FIRMWARE_VERSION=nido-ota-0.3 \
  ./scripts/note4-firmware build-generic
pnpm run note4:ota -- pack .cache/note4/generic/build/nido_note4.bin \
  nido-ota-0.3 /ruta/privada/firmware-private.pem /ruta/privada/nido-ota-0.3.nidoota
```

`build-generic` usa sdkconfig y build propios en `.cache/note4/generic`, sin leer una cabecera familiar ni los defaults privados. Sin clave pública compila un firmware de configuración, pero el instalador rechaza todas las actualizaciones. `pack` valida chip, nombre de proyecto y versión del descriptor ESP-IDF. Cada versión debe corresponder a un único contenido; publicar otro binario con la misma versión se rechaza.

`.nidoota` contiene magic `NIDOOTA1`, longitudes uint32 little endian, manifiesto JSON UTF-8, firma RSA-2048/SHA-256 en hexadecimal y aplicación ESP32-S3. El manifiesto declara modelo, versión, versión de configuración, tamaño y SHA-256 del binario. Se firma su cadena exacta, sin reserializarla. También se guarda un `.json` acompañante. La clave privada no llega al puente ni al NOTE4.

## Primera migración por USB

La tabla conserva NVS/PHY en sus offsets existentes y deja sin escribir la antigua región de aplicación de Nido. Añade `otadata` en `0x310000`, configuración en `0x312000`, `ota_0` en `0x330000` y `ota_1` en `0x730000`, con cuatro MiB por aplicación. La antigua región no es una partición de rescate arrancable. La recuperación de fábrica sigue utilizando el respaldo completo.

Esta primera carga reemplaza bootloader y tabla, inicializa metadatos OTA y escribe la aplicación genérica. El script no borra toda la flash y sigue exigiendo respaldo/identidad:

```sh
./scripts/note4-device backup
./scripts/note4-device flash --backup /ruta/privada/respaldo.json \
  --build-dir .cache/note4/generic/build
```

Usar `--manual-boot` únicamente cuando sea necesario según la guía del dispositivo. Conservar también la configuración y claves del puente. El nuevo firmware no importa las antiguas credenciales compiladas: configurar mediante mantenimiento tras esta primera carga. No confundir conservar datos de flash con migrar automáticamente la configuración de la aplicación anterior.

## Actualizar desde Nido

En los ajustes del plugin, añadir un `.nidoota` firmado, seleccionar una versión y solicitar actualización. «Añadir versión» solo registra un artefacto en el almacenamiento privado local; no publica en Internet. Consultar estado muestra dispositivo, versiones, última observación y operaciones.

El plugin registra `nido.note4.status` con scope `operator.read`; `discover`, `pairCode`, `pair`, `publish`, `update`, `resolve`, `githubCheck` y `githubDownload` exigen `operator.admin`. No son herramientas de menú, agenda o coordinadores. Los agentes familiares no pueden conceder estos permisos. Si no se utiliza la UI adaptada, pueden invocarse como RPC administrativos del Gateway.

El puente recibe `POST /v1/pair`; con el token propio del NOTE4 admite `GET /v1/maintenance/check`, `POST /v1/maintenance/report` y `GET /v1/maintenance/binary`. El firmware consulta después de una sincronización correcta del resumen y cuando no está grabando, procesando ni mostrando una modal. No mantiene Wi-Fi permanentemente ni instala sobre una conversación activa. La orden espera a esa consulta: no despierta a distancia el dispositivo. Con puente o calendario inaccesible, puede demorarse; la web local ofrece una vía independiente.

Una orden incluye un identificador único y versión concreta. Repetir el identificador devuelve la misma operación; cambiar su destino genera conflicto. Solo hay una operación activa por dispositivo. Las órdenes en cola caducan a las veinticuatro horas. Si el NOTE4 ya comunica la versión solicitada, se confirma sin reflashear.

Antes de descargar exige batería válida de al menos 40 % o alimentación externa sin fallo, según el driver. El umbral es provisional y necesita medición física. La instalación escribe por bloques en la partición inactiva y verifica firma, modelo, tamaño, SHA-256 y descriptor antes de elegirla como siguiente arranque. No entra en reposo ni acepta grabaciones durante ese recorrido. Las actualizaciones normales no cambian bootloader, particiones ni configuración.

## Subida local y recuperación

Desde la web del NOTE4, seleccionar `.nidoota` y confirmar. Utiliza el mismo `OtaWriter` y clave pública que la descarga OTA. Funciona sin puente ni Wi-Fi doméstica. Los binarios sin firma válida se rechazan antes de escribir; una descarga incompleta conserva la aplicación de arranque. La actualización reinicia tras verificar.

El firmware confirma el nuevo arranque después de inicializar placa, colas, configuración y refrescar la pantalla correctamente. No requiere que Google o el puente estén disponibles. Un arranque OTA sin confirmar tiene una guardia de treinta segundos y rollback del bootloader; watchdog con panic cubre bloqueos que no permiten avanzar. Estos mecanismos necesitan prueba física de corte/reset y no detectan cualquier defecto funcional.

Una instalación sin resultado después de diez minutos queda `uncertain`, sin reemitirse automáticamente. La próxima comunicación puede confirmar la versión objetivo o un rollback vinculado al identificador guardado en el NOTE4. Si sigue comunicando la anterior, un operador puede resolver la operación desde la UI: exige una observación reciente y sin cambios desde que se consultó. Solo entonces se permite solicitar otra. Un rollback antiguo sin el identificador de esta operación no la resuelve.

La configuración versión 1 debe seguir siendo legible por ambas aplicaciones durante rollback. Una migración incompatible o rotación de clave pública requiere un diseño específico; esta versión no implementa esas migraciones ni antirollback irreversible. Mantener USB/respaldo como recuperación final.

## GitHub Releases desde el plugin

La integración permanece desactivada hasta configurar `note4Maintenance.github.repository`. No deduce el repositorio del remoto ni consulta GitHub al arrancar. Cuando exista, añadir este objeto dentro de `note4Maintenance`, conservando `publicKeyFile` y los demás ajustes:

```json
{
  "github": {
    "repository": "propietario/repositorio"
  }
}
```

En los ajustes del plugin, «Buscar en GitHub» consulta la última release estable. «Descargar versión firmada» la verifica y añade al catálogo privado local; después se solicita su instalación con el botón OTA existente. La descarga no crea una orden ni reinicia el dispositivo. No exige recompilar ni cargar firmware en un NOTE4 que ya soporte la OTA firmada.

Contrato para publicar releases:

- Publicar una release estable, sin `draft` ni `prerelease`, con tag `nido-ota-X.Y.Z`, igual a la versión incorporada y firmada en el firmware. Se aceptan también las versiones antiguas de dos componentes.
- Adjuntar exactamente un `.nidoota` generado por `note4:ota pack`, firmado con la clave correspondiente a la clave pública instalada. Puede haber otros archivos, pero no varios `.nidoota` ambiguos.
- La consulta usa `/releases/latest`; si la última release del repositorio no contiene ese firmware, se informa del problema y no se busca silenciosamente una versión anterior. En un repositorio con releases de otros productos, incluir el firmware en la release estable o dedicar un repositorio a sus releases.
- Mantener cada versión inmutable. El plugin fija repositorio, ID de release, ID de archivo, tamaño y fecha de actualización entre consulta y descarga. Comprueba de nuevo firma RSA, modelo, configuración, descriptor, longitud y SHA-256 antes de registrar. El catálogo rechaza reutilizar una versión con contenido distinto.

La comparación numérica evita ofrecer la descarga si la release es igual o anterior a la versión comunicada por el dispositivo. Si la versión instalada no es reconocible, se indica que no se pudo comparar; la instalación sigue requiriendo una orden explícita. Este filtro no implementa antirollback irreversible ni cambia la posibilidad de seleccionar manualmente una versión ya registrada.

Para repositorios privados, añadir `tokenEnv: "NIDO_FIRMWARE_GITHUB_TOKEN"` al objeto `github` y definir esa variable en el entorno del proceso Gateway. El valor del token no se guarda en este objeto, ni se envía al navegador, al puente o al NOTE4. Usar acceso de lectura a Contents del repositorio. Solo se envía autorización a `api.github.com`; las redirecciones a los hosts de almacenamiento de releases permitidos van sin el token. HTTPS mantiene la validación de certificados, las transferencias tienen tamaño máximo y treinta segundos por petición, y los errores no vuelcan URLs temporales ni respuestas de GitHub. Una consulta/importación usa scope `operator.admin`.

Referencias del contrato HTTP: [última release](https://docs.github.com/en/rest/releases/releases#get-the-latest-release) y [descarga de assets](https://docs.github.com/en/rest/releases/assets#get-a-release-asset). Las pruebas usan respuestas ficticias y claves temporales; la primera descarga real queda pendiente de disponer de repositorio y release.

### Pendiente: aviso en la pantalla antes de mantenimiento

El [spec de OTA directa desde GitHub](note4-github-ota-spec.md) recoge el diseño acordado y las comprobaciones necesarias.

La consulta automática al mantener frontal + inferior y el diálogo «Actualizar / Configurar» en el NOTE4 siguen pendientes. Esta integración resuelve la descarga desde el plugin. El futuro flujo del dispositivo debe conservar aceptación física, consulta acotada, comprobación de versión y firma, batería, rollback y entrada normal al mantenimiento si no hay red o no se desea actualizar. Para repositorios privados se mantendrán las credenciales de GitHub en el servidor.

## Verificación reproducible

- `pnpm test`, `typecheck`, `lint`, `format:check` y `build`: firma, autenticación, paquetes caducados/repetidos, versiones inmutables, deduplicación y reconciliación; integración de Settings y scopes administrativos.
- `pnpm run test:gateway:isolated`: Gateway temporal, sin familia, Google ni llamadas al modelo.
- `pnpm run test:note4-firmware`: ASan/UBSan, RSA real con Mbed TLS del SDK y flash/bootloader simulados, intercambio SRP/AES real entre Node y el SDK (código incorrecto, prueba falsificada y claves públicas inválidas), configuración y límites, gesto continuo/liberación, batería y modal ficticia de mantenimiento en `.cache/note4/firmware-preview/`.
- `note4-firmware build-generic`: compilación ESP-IDF del cliente conectado sin secretos familiares.

Antes de uso real: validar frontal primero/inferior primero, capturar y descartar voz durante combinación, entrada/salida/caducidad AP, Wi-Fi errónea, respuesta de vinculación perdida, móvil iOS/Android, batería/alimentación, binario manipulado, corte de transferencia, corte de energía y rollback. No afirmar funcionamiento físico a partir de estos tests de software.
