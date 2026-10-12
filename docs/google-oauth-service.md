# La app de Google de Nido

El usuario instala el plugin, pulsa **Conectar con Google** y autoriza la app compartida de Nido. No necesita un proyecto de Google Cloud, archivos de credenciales, una URL pública en su OpenClaw ni un túnel SSH. El servicio descrito aquí lo mantiene el distribuidor de Nido una sola vez.

El código está implementado y se verifica con respuestas ficticias de Google. **La URL pública y el cliente Web de producción siguen pendientes de configurar.** La distribución actual ofrece la demo y muestra la conexión a Google como no disponible. No hay un servicio activo implícito ni se ha modificado el proyecto de Google de una instalación real.

## Por qué existe el servicio

Un cliente OAuth Desktop devuelve la autorización al equipo del navegador. Para conectar sin intervención un OpenClaw que puede estar en otro servidor, se usa un cliente **Aplicación web** con una dirección de retorno HTTPS fija. Puede añadirse al mismo proyecto de Google y compartir su pantalla de consentimiento. La URL puede pertenecer al proveedor de alojamiento; no obliga a comprar un dominio, aunque la marca/verificación puede exigir un dominio verificable para la web y la política de privacidad. [Google: aplicaciones instaladas](https://developers.google.com/identity/protocols/oauth2/native-app) y [OAuth para servidores](https://developers.google.com/identity/protocols/oauth2/web-server).

1. El Gateway prepara una solicitud y una prueba aleatoria privadas; envía al servicio el hash de la prueba y el origen del dashboard.
2. El botón envía un formulario desde una ventana del mismo origen que el dashboard. El servicio compara la cabecera Origin con la instalación que inició la conexión; no admite iniciar la autorización abriendo un enlace GET reenviado. La ventana recibe una cookie segura y es dirigida a Google. El retorno fijo valida state, cookie y PKCE.
3. El servicio intercambia el código una sola vez, comprueba los permisos concedidos y cifra el token de renovación en un permiso opaco. El secreto Web nunca sale del servicio.
4. El Gateway obtiene ese permiso presentando su prueba. La lectura es repetible durante diez minutos para recuperar respuestas perdidas; no repite el intercambio de Google. El permiso se guarda con modo 0600 en el estado privado de OpenClaw.
5. Cuando necesita acceso, el plugin presenta el permiso al servicio para renovar el token. Usa el token de acceso para llamar a Calendar directamente y lo conserva en memoria hasta su caducidad.

La interfaz se actualiza sola al terminar el consentimiento. Si OpenClaw se reinicia, la solicitud privada permite continuar. Una respuesta incierta al intercambiar el código queda fallida y requiere una nueva autorización explícita; nunca se envía otra vez ese código. Una reconexión comprueba los calendarios existentes y conserva las credenciales anteriores ante conflictos o falta de acceso.

## Preparar Google una vez

En el proyecto de Nido, habilita Calendar API y crea un cliente **Aplicación web**. Conserva el cliente Desktop si hay instalaciones que aún lo usan. Registra exactamente:

```text
https://auth.example.com/oauth/google/callback
```

Sustituye el origen de ejemplo por el del servicio. No registres el dominio particular de cada OpenClaw. El plugin solicita `calendar.events` y `calendar.calendarlist.readonly`; no solicita correo, Drive ni datos de perfil. Google muestra el consentimiento antes de conectar y las restricciones de escritura del plugin se siguen aplicando por agente.

La app debe tener audiencia externa, marca y política de privacidad apropiadas y el estado de publicación/verificación que permita ofrecer esos permisos al público. El modo Testing limita los usuarios y puede hacer caducar sus tokens a los siete días. Una cuenta de Google Workspace puede estar restringida por su administrador. [Verificación de permisos sensibles](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification) y [ciclo de vida de tokens](https://developers.google.com/identity/protocols/oauth2#expiration).

## Desplegar el servicio

Requiere Node 24.16+ de la rama 24 y almacenamiento local persistente para SQLite. No necesita dependencias npm: los dos archivos `scripts/serve-nido-oauth.mjs` y `scripts/nido-oauth-service.mjs` pueden copiarse juntos al servidor. También puede ejecutarse desde el checkout mediante `pnpm run auth:serve`.

Configura en el gestor de secretos o en un archivo de entorno privado fuera del repositorio:

| Variable                   | Valor                                                                     |
| -------------------------- | ------------------------------------------------------------------------- |
| `NIDO_AUTH_PUBLIC_URL`     | Origen HTTPS del servicio, sin ruta ni parámetros                         |
| `NIDO_AUTH_CLIENT_ID`      | ID del cliente OAuth Web de Nido                                          |
| `NIDO_AUTH_CLIENT_SECRET`  | Secreto del cliente Web, solo en el servicio                              |
| `NIDO_AUTH_ENCRYPTION_KEY` | 32 bytes aleatorios codificados en base64url, conservados entre reinicios |
| `NIDO_AUTH_DATA_DIR`       | Ruta absoluta privada fuera del checkout, sin enlaces simbólicos          |
| `NIDO_AUTH_PORT`           | Puerto interno; por defecto 8787                                          |

Genera la clave con un gestor de secretos o un generador criptográfico; no la pegues en documentos, comandos compartidos ni en Git. Protege el archivo de entorno con modo 0600. La clave y el cliente OAuth deben permanecer estables: cambiarlos invalida los permisos cifrados existentes y exige reconectar las cuentas.

Ejecuta `node scripts/serve-nido-oauth.mjs` con esas variables. El proceso escucha únicamente en `127.0.0.1`; coloca un proxy HTTPS delante. Ejemplo mínimo de Caddy:

```caddyfile
auth.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Sustituye el dominio por uno resuelto al servidor. En un alojamiento gestionado configura el equivalente, incluyendo el acceso del proxy al loopback del proceso. No publiques el puerto interno. Usa una única instancia del proceso por base SQLite; no compartas la base entre réplicas activas ni la sitúes en un sistema de archivos de red.

El despliegue debe aplicar límites por IP en el proxy y una política de retención mínima. El proceso añade límites globales de 60 nuevas conexiones y 3000 peticiones por minuto y un máximo de 1000 solicitudes temporales. No confía en cabeceras de IP reenviadas. Ajusta la capacidad con pruebas de carga antes de un lanzamiento mayor.

Desactiva los logs de acceso de las rutas OAuth o elimina por completo query strings, Authorization y Cookie: el retorno contiene códigos de autorización. El proceso no registra peticiones ni respuestas de Google. `GET /health` devuelve solo disponibilidad local; no acredita que Google o su configuración funcionen.

Para un proceso persistente, el supervisor debe cargar el entorno privado, reiniciar al fallar y entregar SIGTERM al detenerlo. Respalda la clave de cifrado y el secreto en el gestor de secretos. La SQLite solo conserva solicitudes de diez minutos; no constituye un almacén permanente de cuentas. No uses una clave nueva en cada despliegue.

## Activar la distribución

Cuando el servicio esté disponible, establece su **origen público** en `googleOAuthService`, en `integrations/nido-family/src/google-oauth-config.ts`, y vuelve a empaquetar. Ese origen es público y forma parte del producto; no es un dato de una familia. El paquete nunca incluye el secreto Web ni la clave de cifrado.

Para una verificación controlada, el mantenedor puede fijar `NIDO_GOOGLE_AUTH_URL` en el entorno del Gateway. Es una opción administrativa para desarrollo o distribuciones propias; el asistente no pide esa variable a los usuarios. El RPC no acepta una URL alternativa ni credenciales del navegador.

Antes de activar una distribución pública, comprueba con una cuenta de prueba autorizada el consentimiento real, los permisos de Calendar, la renovación, la revocación y una reconexión. Las pruebas automatizadas no sustituyen esa verificación ni la revisión de Google.

## Datos y dependencias

El servicio conoce temporalmente el origen del dashboard y procesa tokens de Google y tiene la capacidad técnica de descifrarlos. Aunque su código no consulta calendarios, su operador es un tercero de confianza con capacidad de acceso mediante esos tokens. Esto debe constar en la política de privacidad y el consentimiento; no se debe presentar como una arquitectura donde nadie fuera de la instalación puede acceder a la autorización.

Los resultados cifrados y los verificadores de las solicitudes se eliminan de SQLite al caducar; la clave permanente permanece en el servicio. El plugin guarda un permiso cifrado que debe protegerse igual que un token, y los tokens de acceso solo se mantienen en memoria. Los calendarios, eventos, preferencias, miembros y conversaciones permanecen entre OpenClaw y los servicios que la instalación haya configurado; el servicio OAuth no los recibe.

La disponibilidad del servicio es necesaria para conectar y renovar el acceso. Una caída no borra datos ni hace que una lectura fallida se interprete como una agenda vacía. El usuario puede revocar la app desde las conexiones de su cuenta de Google, tras lo cual será necesaria una nueva autorización.
