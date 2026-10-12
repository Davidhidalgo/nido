# Menú de Nido en TRMNL

Google Calendar sigue siendo la fuente de verdad. Esta pantalla solo presenta una copia del menú; no planifica comidas ni modifica eventos.

## Conexión directa a Google Calendar (objetivo actual)

<!-- Fuente y tratamiento de eventos de calendar-full.liquid; pruebas en ../../tests/trmnl-calendar.test.ts -->

El flujo previsto es Nido → Google Calendar → plugin nativo Google Calendar de TRMNL → Plugin Merge → pantalla. No necesita un proceso local, webhook ni LLM para actualizar la pantalla. La autorización de Google en TRMNL es independiente de la conexión de Nido.

Estado: plantilla `calendar-full.liquid` preparada y selector `menu_calendar` añadido al plugin remoto. Pendiente autorización/selección del plugin Google Calendar, comprobación del esquema real y activación. El plugin remoto conserva por ahora su estrategia Webhook y plantilla anterior.

1. En TRMNL, conectar el plugin nativo Google Calendar y seleccionar únicamente «Nido: menú». Usar semana fija de lunes a domingo, incluir eventos pasados de la semana y un límite de eventos de al menos 14 (preferiblemente mayor para detectar duplicados).
2. Añadir esa instancia a una playlist. Puede estar oculta mediante el icono del ojo: debe seguir en la playlist para que TRMNL actualice sus datos.
3. En «Menú semanal», seleccionar esa instancia en «Calendario del menú». Cambiar la estrategia a Plugin Merge cuando la fuente esté disponible.
4. Comprobar en las variables que `menu_calendar.events` contiene los eventos de toda la semana, incluidos los días pasados. La plantilla admite los campos nativos `summary` y `start_full`/`date_time`; la forma real debe validarse antes de activar.
5. Instalar `calendar-full.liquid` en Full y verificar una captura. No continuar con `trmnl:watch` ni `trmnl:sync`: esos comandos pertenecen al método anterior.

La plantilla conserva el diseño de siete columnas, convierte fechas con offset a Europe/Madrid y diferencia comida/cena por el prefijo del título. Las celdas duplicadas muestran «Revisar duplicados». Una fuente ausente o incompatible muestra un aviso, no un menú vacío. Los títulos se insertan como texto; no se ejecuta HTML procedente de eventos. Solo se representan títulos y fechas, aunque el plugin nativo puede recibir otros campos del calendario autorizado. La zona se fija en Europe/Madrid.

El refresco depende de TRMNL y puede conservar datos antiguos ante un fallo del plugin nativo. La vista no puede verificar por sí sola si su proveedor ha omitido eventos, ni afirma la hora de la última sincronización de Google.

Fuentes: [Plugin Merge](https://docs.trmnl.com/go/private-api/plugin-data), [selector de instancia](https://help.trmnl.com/en/articles/10513740-custom-plugin-form-builder), [vistas oficiales de Calendar](https://github.com/usetrmnl/plugins/tree/master/lib/calendars).

## Método anterior: webhook (conservado como alternativa)

<!-- Comandos trmnl:* definidos en ../../package.json y comportamiento de ../../scripts/trmnl.mjs -->

Primera implementación: Private Plugin con estrategia **Webhook**, compatible con el servicio oficial. Un servidor propio necesita implementar el mismo endpoint HTTPS; no se ha comprobado otro backend.

1. En TRMNL crea un Private Plugin, selecciona Webhook y guarda. La disponibilidad depende de las funciones habilitadas en tu cuenta.
2. Pega `full.liquid` en la vista Full del editor de markup y añade el plugin a la playlist del dispositivo.
3. Desde la raíz de Nido ejecuta `pnpm run trmnl:preview --demo`. Genera `.local/trmnl/preview.json` con datos ficticios sin usar Google ni enviar nada. En el editor de TRMNL puedes usar el contenido de `merge_variables` como variables de prueba.
4. Copia el Webhook URL generado por TRMNL y guárdalo como variable de entorno local. En zsh puedes introducirlo sin mostrarlo ni añadirlo al historial:

```sh
read -rs 'TRMNL_WEBHOOK_URL?Webhook privado de TRMNL: '
export TRMNL_WEBHOOK_URL
```

5. `pnpm run trmnl:sync --demo` envía los datos ficticios. Comprueba el resultado en la vista previa de TRMNL y en el dispositivo.
6. Con Google Calendar conectado a Nido, `pnpm run trmnl:sync` lee únicamente el calendario del menú configurado en `.local/family.json` y publica su semana actual. Si Nido sigue en modo demo, leerá su calendario simulado y lo marcará DEMO.

`pnpm run trmnl:watch` repite la sincronización cada diez minutos mientras el proceso esté abierto. Se detiene con Ctrl+C; no se instala un servicio de arranque ni se activa por sí solo. Necesita conexión a Internet y el equipo encendido. El refresco físico depende además de la configuración del dispositivo. Para fijar un rango distinto usa `--start=2026-09-21`; sin esa opción la semana cambia automáticamente cada lunes.

La vista previa normal (`pnpm run trmnl:preview`) lee la fuente configurada pero no publica en TRMNL. Hace falta haber compilado Nido con `pnpm run build` para disponer del adaptador de Google; una instalación ya compilada no requiere repetirlo.

## Alcance de los datos

<!-- Proyección, transporte y validaciones de menu.mjs y ../../scripts/trmnl.mjs -->

Solo se incluyen eventos titulados `Comida · …` o `Cena · …`, según su fecha inicial en la zona familiar. Se envían los platos, fechas y hora de generación: nunca IDs, asistentes, ubicaciones, descripciones ni preferencias. La integración no escribe en Calendar ni llama al LLM. Reutiliza la conexión Google de Nido, que tiene permisos de escritura para los agentes, pero este proceso solo hace consultas.

Un envío sustituye la semana completa para reflejar cambios y borrados. Los eventos cancelados se omiten; las casillas sin evento quedan sin planificar. Dos eventos del mismo tipo en un día detienen el envío en lugar de elegir uno arbitrariamente. Si hay un error de Google o TRMNL se conserva la pantalla anterior; consulta siempre «Actualizado» para detectar datos antiguos.

El webhook es un secreto: no lo subas al repositorio. No se siguen redirecciones ni se imprime la URL en errores de transporte. Cada payload se limita a 2000 bytes UTF-8 para encajar en el límite básico documentado; si no cabe, acorta los títulos. El bucle envía seis veces por hora, por debajo del límite básico de doce; evita arrancar varios procesos o repetir envíos manuales rápidamente. Ante un fallo no hay reintentos inmediatos; el bucle espera al siguiente intervalo.

[Contrato y límites oficiales del webhook](https://docs.trmnl.com/go/private-plugins/webhooks).

## Plantilla

<!-- Estructura, variables y límites de visualización de full.liquid -->

[full.liquid](full.liquid) es el contenido de la vista **Full** de un Private Plugin de TRMNL. Está pensado para la pantalla horizontal de 800 × 480, en blanco y negro. Usa las clases oficiales `layout`, `table` y `title_bar`, con estilos locales para conservar los siete días visibles. No añade imágenes, scripts, fuentes ni otros recursos remotos.

En el editor de TRMNL se pega el archivo completo. No se envuelve en `screen` ni `view`: la plataforma añade esos contenedores. Necesita el framework que proporciona TRMNL; el archivo no es una página HTML independiente. No incluye diseños para media pantalla ni cuadrantes.

Cada comida ocupa como máximo dos líneas. Los nombres muy largos se recortan visualmente; el evento completo sigue en Calendar. Una celda vacía aparece como «Sin planificar». `DEMO` identifica datos simulados y la fecha de actualización permite detectar una pantalla desactualizada. Esta fecha corresponde a la generación de los datos, no al último cambio de Calendar ni al refresco físico del dispositivo.

## Datos de entrada

<!-- Contrato de merge_variables consumido por full.liquid -->

El payload del webhook contiene un objeto `merge_variables`. Sus campos se usan directamente en Liquid (`title`, `days`, etc.), sin anteponer `merge_variables.`.

| Campo           | Tipo    | Contenido                                                     |
| --------------- | ------- | ------------------------------------------------------------- |
| `title`         | string  | Título corto, por ejemplo «Menú semanal».                     |
| `range`         | string  | Rango visible, por ejemplo «21–27 sep».                       |
| `updated`       | string  | Fecha y hora local de generación, por ejemplo «22/09 10:30».  |
| `demo`          | boolean | `true` solo para datos simulados.                             |
| `days`          | array   | Exactamente siete días, en orden.                             |
| `days[].label`  | string  | Nombre corto del día, por ejemplo «Lun».                      |
| `days[].date`   | string  | Fecha para mostrar, en formato ISO, por ejemplo «2026-09-21». |
| `days[].lunch`  | string  | Comida del día; vacío si no hay evento.                       |
| `days[].dinner` | string  | Cena del día; vacío si no hay evento.                         |

Las cadenas se reciben como texto sin escapar; la plantilla aplica `escape` en todas las interpolaciones. No enviar HTML, credenciales, descripciones privadas de eventos ni preferencias familiares. El emisor prepara fechas y los siete días completos; la plantilla no calcula la semana y limita la presentación a las primeras siete entradas.

## Verificación pendiente

La estructura sigue el framework oficial. Antes de usarla en casa hay que comprobar la vista previa de TRMNL y el dispositivo real, especialmente con nombres largos y caracteres acentuados. El acceso al dispositivo y al Private Plugin no forma parte de esta plantilla.

Fuentes oficiales: [estructura del framework](https://trmnl.com/framework/docs/3.3/structure), [tablas](https://trmnl.com/framework/docs/3.3/table), [barra de título](https://trmnl.com/framework/docs/3.3/title_bar) y [plantillas Liquid](https://docs.trmnl.com/go/private-plugins/templates).

## Plantilla existente y acceso MCP

<!-- Compatibilidad de buildMenu en menu.mjs con la plantilla de siete columnas -->

Nido también envía `week` (rango, con prefijo DEMO si procede) y `days[].short` (día abreviado), compatibles con la plantilla de siete columnas del plugin «Menú semanal». No es necesario sustituirla por `full.liquid`. Esa plantilla existente no muestra la hora de actualización.

La clave MCP permite revisar y editar el plugin en `https://trmnl.com/mcp`, pero no sustituye a `TRMNL_WEBHOOK_URL` para publicar el menú. El MCP consultado no expone el valor del Webhook URL: se obtiene en la configuración del plugin. No se guarda la clave MCP en este repositorio.
