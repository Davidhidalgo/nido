# Añadir Nido a tu OpenClaw

Nido se instala en un OpenClaw que ya funciona. El asistente crea Nido, Menú y Agenda, sus instrucciones privadas y los permisos correspondientes. Puedes empezar con una demo; Google, Telegram y NOTE4 son opcionales.

## 1. Instalar el paquete

Necesitas OpenClaw **2026.9.8 o posterior** y su modelo configurado. Esta revisión está probada con 2026.9.8; las APIs de plugins del host son experimentales. No necesitas otro Gateway ni instalar pnpm para usar el paquete.

<!-- Package filename matching integrations/nido-family/package.json name and version -->

Obtain `openclaw-plugin-nido-family-0.1.2.tgz` from a Nido distribution you have reviewed. This version is prepared locally; these instructions do not imply that it has been published to npm, ClawHub, or GitHub Releases. To build from source, follow the packaging section of [the plugin guide](plugin-install.md).

En el equipo o servidor donde corre tu OpenClaw:

```sh
openclaw plugins install ./openclaw-plugin-nido-family-0.1.2.tgz
```

El CLI pide confiar en el paquete y aceptar sus capacidades. En un terminal no interactivo, una vez revisadas, añade `--force --accept-capabilities`. `--force` también permite reemplazar una instalación existente: comprueba la versión antes de usarlo. Los datos familiares permanecen sin configurar hasta completar el asistente.

Si el Gateway está activo, OpenClaw intenta activar el plugin en él. Si no lo está, arráncalo como haces habitualmente. Si informa de una activación fallida, consulta el estado y usa `openclaw plugins reload nido-family` tras corregir la causa; no repitas a ciegas la instalación.

## 2. Abrir Nido

Abre tu dashboard como administrador. Activa **Settings → Labs → Custom plugin UI** y abre **Nido** en la navegación lateral. Si no aparece, recarga el navegador. Esta opción del host permite cargar interfaces de plugins de terceros; Nido no la cambia por su cuenta.

El asistente permite:

1. Probar con calendarios ficticios o conectar Google.
2. Elegir el modelo de un agente existente o la configuración general de OpenClaw.
3. Indicar zona horaria, miembros opcionales y horarios de comida y cena.
4. Permitir o no que guarde eventos cuando se lo pidas.
5. Revisar el resultado y pulsar **Guardar y activar Nido**.

Los agentes se llaman `nido`, `menu` y `agenda`. Si esos nombres pertenecen a otros agentes, el asistente se detiene sin sustituirlos. En una instalación antigua creada con el generador del repositorio, conserva ese recorrido: el asistente no toma el control de sus workspaces.

El modelo usa la autenticación compartida disponible en OpenClaw. Nido no copia credenciales privadas de otro agente. Si ese agente utiliza una cuenta exclusivamente local, tendrás que autorizar el proveedor para los nuevos agentes mediante OpenClaw. Las restricciones globales de herramientas se mantienen; una restricción que bloquee delegación o herramientas de Nido debe revisarse en el host.

## 3. Probar una conversación

Pulsa **Hablar con Nido**. Prueba «Organiza las cenas de esta semana» o crea una cita ficticia y rectifícala. En demo, Nido debe indicar que son datos de prueba. Las preferencias se guardan conversando: «Recuerda como preferencia familiar que preferimos cenas ligeras».

Un resultado perdido al guardar se comprueba leyendo el estado de la operación. Si OpenClaw se reconecta al aplicar la configuración, espera y pulsa **Actualizar estado**. No vuelvas a guardar hasta conocer el resultado.

## 4. Conectar Google Calendar

Desde la demo pulsa **Conectar Google Calendar**; también puedes elegir Google en la instalación inicial.

1. Pulsa **Conectar con Google**. Se abrirá la autorización de la app **Nido** en Google; el nombre definitivo depende de su configuración de marca.
2. Elige tu cuenta y acepta el acceso solicitado. Al terminar, puedes cerrar esa pestaña: Nido detecta la conexión y carga los calendarios automáticamente. Si el navegador bloquea la ventana, usa **Continuar en Google**.
3. Selecciona por nombre dos calendarios distintos: menú y agenda. Créelos antes en Google Calendar si no existen. El asistente no lee eventos ni crea calendarios durante la conexión.
4. Empieza con escrituras desactivadas, revisa y guarda. Los eventos y preferencias de la demo permanecen separados de Google.

No necesitas crear una app en Google Cloud, descargar archivos ni abrir un túnel para OAuth. Este recorrido funciona también cuando el navegador y OpenClaw están en equipos distintos. Tu OpenClaw necesita salida HTTPS hacia Google y el servicio de conexión de Nido.

**Estado de esta revisión:** el código del servicio está incluido, pero aún no hay un servicio público configurado. Hasta que el distribuidor lo active, el asistente muestra Google como no disponible y permite usar la demo. La activación de la app web compartida corresponde al mantenedor y está descrita en [servicio OAuth](google-oauth-service.md).

En la página Nido puedes conectar calendarios adicionales, elegir predeterminados y ajustar permisos por especialista. Menú escribe en su calendario; Agenda, en los autorizados. Google limita siempre el acceso efectivo.

Si Google revoca el acceso, usa **Reconectar Google** y autoriza de nuevo. La nueva cuenta debe mantener acceso a los calendarios configurados; un fallo conserva la conexión anterior y todos los eventos y preferencias. También puedes revocar Nido desde las conexiones de tu cuenta de Google. Las instalaciones antiguas con credenciales Desktop siguen funcionando; el script del perfil aislado conserva ese recorrido avanzado.

El servicio de conexión procesa los tokens de Google para completar y renovar la autorización. El plugin guarda un permiso cifrado privado y consulta Google Calendar directamente. Ni los eventos ni las preferencias pasan por el servicio de conexión. El operador del servicio tiene acceso técnico a los tokens; su política de privacidad debe explicarlo. [Flujo y datos](google-oauth-service.md).

## Datos privados y siguientes pasos

El plugin guarda bases, credenciales y workspaces bajo `<estado-de-OpenClaw>/nido-family/`, fuera del paquete. No edites las plantillas públicas con nombres o preferencias. Haz copia del estado privado de OpenClaw y su configuración para restaurar la instalación completa. [Organización de datos](data-layout.md).

Telegram, TRMNL y NOTE4 se configuran después. Sus herramientas del repositorio conservan el recorrido aislado existente; no ejecutes `prepare:local` contra tu OpenClaw habitual. Para desarrollar o desplegar un perfil independiente, consulta [el perfil aislado](standalone-install.md).
