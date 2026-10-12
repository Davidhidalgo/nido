# Organización del código y los datos

La documentación y las pruebas públicas deben bastar para entender y desarrollar Nido. La instalación de una familia y los diagnósticos privados se conservan fuera del checkout. La familia demo es parte de OpenClaw y permanece con su estado operativo.

## Plugin añadido a un OpenClaw existente

La instalación recomendada guarda el estado en `<OPENCLAW_STATE_DIR>/nido-family/`, usando el directorio de estado resuelto por el host. Contiene `demo/` y `google/` separados, `profiles/<hash>/<agente>/AGENTS.md` privados y `agents/<agente>/` para el estado independiente de OpenClaw. Las carpetas nuevas se crean con permisos 0700 y los archivos de instrucciones y credenciales con 0600. Las credenciales de Google no se incluyen en el paquete ni se devuelven a la interfaz.

`google/google-credentials.json` contiene, para la conexión compartida, el origen del servicio y un permiso cifrado equivalente a una credencial. `google/oauth-pending.json` conserva una prueba privada de diez minutos para recuperar la autorización; no es una credencial pública. Ambos se guardan con permisos 0600 y no se devuelven al navegador. El servicio usa una SQLite privada temporal fuera del checkout, además del secreto OAuth Web y una clave de cifrado permanente que debe respaldarse por separado. [Detalles](google-oauth-service.md).

La configuración se guarda en el archivo del host, incluyendo miembros y horarios. Los perfiles anteriores se conservan; los fallos parciales pueden dejar perfiles preparados sin activar. Las copias de seguridad deben incluir el estado y la configuración, nunca subirse al repositorio. La distribución solo contiene plantillas genéricas en `dist/agent-templates/`.

Los apartados siguientes describen el perfil aislado del repositorio, usado por el desarrollo y las herramientas de dispositivos existentes.

## Código y conocimiento compartible

El repo contiene código, plantillas genéricas de agentes, configuración de ejemplo, tests y documentación. `AGENTS.md` orienta a los asistentes de programación; `architecture.md` y `development.md` explican el sistema y cómo reproducir las comprobaciones. Las capturas públicas del diseño NOTE4 y las fixtures son ficticias.

Los originales privados de una incidencia no se convierten en documentación pública. Se extrae la regla técnica, se reconstruye un ejemplo ficticio y se añade una prueba cuando procede.

## Estado operativo

Por defecto `~/.openclaw/nido/`, seleccionado mediante `NIDO_HOME` al configurar. `.local` es el enlace de compatibilidad desde el checkout.

| Ruta dentro del estado                                           | Uso y conservación                                                                                               |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `family.json`                                                    | Configuración particular: miembros, zona, horarios, calendarios y escrituras                                     |
| `family-data/google/`                                            | Preferencias, operaciones, contexto reciente y credenciales de Calendar                                          |
| `family-data/demo/`                                              | Familia ficticia y preferencias de prueba; estado legítimo de la instalación                                     |
| `openclaw/`                                                      | Perfil, autenticación, sesiones, bases de datos y recursos administrados por OpenClaw                            |
| `workspaces/`                                                    | Instrucciones generadas y adjuntos privados de los agentes                                                       |
| `google-client.json`, `telegram-bot-token`                       | Credenciales de las integraciones                                                                                |
| `note4/device.json`, `server-*.pem`, `openssl.cnf`, `generated/` | Configuración y HTTPS del puente; generated conserva cabeceras históricas, ya no usadas por el firmware genérico |
| `family-data/<modo>/note4-maintenance/`                          | Base administrativa de vinculación/OTA y binarios firmados; aislados por dataDir                                 |
| `note4/backups/`                                                 | Respaldo de fábrica y metadatos de verificación; conservar para recuperación                                     |
| `note4/openclaw/`, `note4/family-data/`                          | Gateway y almacenamiento demo NOTE4; permanecen con OpenClaw                                                     |
| `note4/conversation*`, `last-turn.json`, `gateway.log`           | Estado y diagnóstico operativo del simulador                                                                     |
| `note4/uploads/`, logs del puente/dispositivo y PID              | Trabajo temporal y seguimiento de servicios en uso                                                               |
| `trmnl/`                                                         | Proyección particular para ese cliente                                                                           |
| `honcho/`                                                        | Compose, credenciales y datos persistentes del servicio local de memoria opcional                                |

No hay una dependencia entre el funcionamiento de Nido y la aplicación de Codex usada para desarrollarlo. Los archivos creados por un asistente pueden ser configuración del producto, código o resultados de pruebas; su destino depende de su función.

OpenClaw puede haber creado un `codex-home` interno en ejecuciones antiguas con otro runtime. Eso pertenece a esa ejecución de OpenClaw. Solo se archiva cuando la configuración activa usa el runtime OpenClaw y no tiene archivos abiertos; no se trata como el estado de la aplicación de Codex del desarrollador.

## Archivo privado de desarrollo

Los experimentos históricos de la instalación se han separado en un directorio hermano del estado, `<NIDO_HOME>-development/`; con el destino por defecto es `~/.openclaw/nido-development/`.

`archive/<fecha>/` conserva la jerarquía original y un `manifest.json` privado con el origen y el hash de cada traslado. Incluye capturas, audios de pruebas, scripts puntuales, salidas de diagnósticos, comparativas de modelos, snapshots de configuración y notas personales de migración. Puede contener secretos, por lo que tampoco se publica ni se necesita para arrancar una instalación nueva.

La organización inicial conserva los archivos abiertos por procesos. Por eso un log de una prueba antigua puede seguir en el estado operativo mientras lo esté usando un Gateway. Los scripts archivados son evidencias, no herramientas ejecutables mantenidas. Sus procedimientos útiles están recogidos en el repo.

Para diagnósticos privados futuros autorizados, crea una carpeta fechada en este archivo externo y guarda allí los resultados. No añadas nuevas pruebas sueltas al directorio operativo. Mantén permisos privados y no subas el archivo a GitHub.

## Cachés y resultados regenerables

- `.cache/` del checkout: cachés de instalación/empaquetado y resultados ficticios de desarrollo.
- `.cache/note4/firmware-preview/`: imágenes y ejecutables generados por las pruebas nativas actuales. No necesita acceso a la familia real.
- `.runtime/`: herramientas y dependencias instaladas para desarrollar o ejecutar; ignoradas por Git.
- `openclaw/cache/`, `openclaw/npm/`, `openclaw/tmp/` y equivalentes del perfil demo: recursos que administra OpenClaw. Se identifican como regenerables, pero se mantienen bajo su control para no romper rutas, dependencias o procesos activos.

Una base SQLite y sus archivos WAL/SHM no son caché aunque estén junto a ella. Tampoco lo son las preferencias, conversaciones, credenciales o respaldos del dispositivo. No elimines directorios completos de OpenClaw basándote solo en su tamaño.

## Copia y restauración

Una migración de Nido debe conservar el estado operativo de las familias que quieras trasladar, incluido el respaldo del dispositivo si se conserva ese hardware. Detén los procesos antes de copiar bases de datos. El archivo de desarrollo es opcional y las herramientas/cachés se pueden reinstalar.

Aún no hay un exportador/restaurador automático: hay que revisar enlaces, rutas, autenticación y dirección/certificado del puente. Esta organización permite distinguir lo que habría que incluir sin mezclarlo con los experimentos de desarrollo.
