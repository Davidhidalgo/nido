# Privacidad y publicación

El checkout contiene código, plantillas genéricas y ejemplos ficticios. La configuración y el estado de cada familia se guardan físicamente fuera de él: por defecto `~/.openclaw/nido/`. `.local` es un enlace de compatibilidad ignorado por Git. El destino se elige con `NIDO_HOME` durante `pnpm run setup`; una segunda instalación debe usar otro destino.

Los agentes usan `.local/workspaces/`, por lo que sus adjuntos y archivos de contexto ya no se generan en las plantillas públicas. Las preferencias persistentes están en SQLite, separadas entre demo y Google. Los horarios y miembros están en `family.json` y se incorporan a las instrucciones privadas al preparar el perfil. No guardes nombres ni restricciones alimentarias en las plantillas del repo.

Las reglas de `.gitignore` cubren estado, adjuntos antiguos, bases de datos, claves, runtime, compilaciones y paquetes generados. Los binarios del NOTE4 pueden contener Wi-Fi y tokens; no publiques el contenido de `firmware/*/build/` ni respaldos del dispositivo. Las capturas de `docs/assets/note4-design/` usan datos ficticios.

Los diagnósticos históricos están en un archivo de desarrollo externo separado del estado operativo; también pueden contener secretos. Las familias demo permanecen con OpenClaw. Consulta [la organización de datos](data-layout.md) para distinguir estado, archivo y cachés.

## Antes del primer push

```sh
pnpm run release:check
git add .
pnpm run release:check
git diff --cached --stat
git diff --cached
```

El comprobador revisa los archivos publicables, el índice y el historial de Git que puede publicarse, incluidos mensajes de commits y etiquetas e identidades de autor. Busca patrones de secretos, correos fuera de dominios de ejemplo o `noreply`, rutas de usuario y archivos privados. Rechaza enlaces simbólicos (también rotos o en directorios intermedios), submódulos y binarios sin revisión. Una copia limpia en disco no oculta lo que ya está en el índice o en un commit anterior. No abre `.local`, `NIDO_HOME` ni archivos ignorados, y no imprime los valores detectados.

Los snapshots internos de la aplicación bajo `refs/codex/*` se excluyen del control de publicación: no se envían con un push normal de una rama o etiqueta. `pnpm run release:check -- --all-refs` permite auditarlos aparte. No uses `git push --mirror` ni compartas la carpeta `.git`. El resto de referencias, incluidas ramas y etiquetas antiguas, se revisa siempre.

Ningún patrón detecta todos los nombres, direcciones, números de teléfono o datos personales escritos en texto libre. Revisa ejemplos, comentarios, documentación y nombres de archivo. Los ejemplos deben reconstruirse con datos ficticios, sin copiar conversaciones reales ni sustituir únicamente sus nombres.

Comprueba el nombre y correo de autor y committer antes de crear el commit (`git var GIT_AUTHOR_IDENT` y `git var GIT_COMMITTER_IDENT`). Para evitar datos personales usa un alias público y el correo `noreply` que te proporciona GitHub en los ajustes de tu cuenta. Configúralos para este repositorio con `git config --local user.name` y `git config --local user.email`, seguidos de los valores elegidos. No basta con cambiarlos después: la identidad queda grabada en cada commit. El escáner detecta correos personales en commits existentes, pero no puede decidir si un nombre es real o un alias.

Después del commit puedes añadir el remoto y hacer push. Repite `release:check` antes del push. No uses `git add -f` para incluir archivos privados ni subas un ZIP de toda la carpeta local. El paquete `plugin:pack` se construye con una lista explícita de código y plantillas; los adjuntos y preferencias no forman parte de él.

Si un secreto llega a un commit publicado, eliminar el archivo del último commit no lo retira del historial: revócalo y limpia el historial correspondiente. Los objetos sueltos sin referencias no se envían con un push ordinario; una copia completa de `.git` es otro tipo de transferencia.

## Imágenes y sonidos públicos

`config/public-assets.json` registra la ruta, SHA-256 y motivo de revisión de cada recurso binario. El escáner exige que los bytes del archivo y del índice coincidan con ese registro; un archivo nuevo o modificado requiere volver a revisar su contenido y metadatos antes de actualizar el hash. Conserva los hashes de versiones anteriores ya revisadas en la lista opcional `previousSha256` para reconocerlas en el historial; esa lista no autoriza versiones antiguas en el archivo actual ni en el índice. No actualices la lista automáticamente para silenciar un fallo.

Las cinco pantallas NOTE4 proceden de ejemplos ficticios presentes en las pruebas del renderer; no son capturas de calendarios familiares. El logo es una ilustración y conserva metadatos C2PA de procedencia de OpenAI, sin identidad familiar. Los cuatro WAV son avisos electrónicos de 120–350 ms y coinciden con el PCM de `firmware/note4/main/nido_sounds.h`, sin voz grabada. No se incluyen fotografías, transcripciones ni grabaciones familiares.

## Comprobación reproducible

`tests/release-check.test.ts` crea repositorios temporales con datos ficticios para comprobar secretos en el índice y el historial, archivos privados añadidos por la fuerza, enlaces, metadatos de Git y cambios en binarios. Incluye una barrera que falla si el comprobador intenta abrir `.local`.

Antes de preparar una versión ejecuta las comprobaciones de [desarrollo](development.md), `pnpm run release:check` y `pnpm run plugin:pack`. El paquete usa una lista explícita de archivos; no sustituye la revisión del repositorio que se enviará a GitHub. La revisión de código no confirma el funcionamiento físico del NOTE4.

Revisión del 12 de octubre de 2026: 205 archivos publicables comprobados, incluidos los diez recursos binarios revisados. Pasaron las 188 pruebas de TypeScript, typecheck, lint y formato. En una copia temporal sin estado familiar se comprobaron el índice tras `git add .`, la compilación, el empaquetado y el Gateway aislado con datos ficticios. Los 45 archivos del paquete coincidieron con la lista esperada y superaron un nuevo escaneo después de extraerlos. No se creó un commit ni se publicó el proyecto. Estas cifras describen esa revisión; los cambios posteriores requieren repetirla.

## Inventario de ejemplos publicables · revisión adicional del 12 de octubre de 2026

Esta revisión comprende 222 archivos candidatos obtenidos de Git, sin seguir enlaces ni leer el estado privado. El inventario describe ejemplos presentes en el código y recursos; no acredita su procedencia mediante comparación con una familia real.

| Grupo                            | Datos que quedarían visibles                                                                                                                                                                                         | Ubicación                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Configuración inicial            | Modo demo, calendarios `demo-menu` y `demo-family`, miembros vacíos, Europe/Madrid, comidas a las 13:00 y 19:00 y duración de 60 minutos                                                                             | `config/family.example.json`                                  |
| Personas y calendarios de prueba | Lucía, Álex, Blanca, Persona A/B, Persona ficticia/de prueba, Casa, Familia y Escuela                                                                                                                                | Pruebas de firmware, calendario y resumen; imágenes de diseño |
| Agenda y menús ficticios         | Cumpleaños, reunión del cole/I2, biblioteca, dentista, parque, natación, cine, visita a abuelos; horarios y fechas de septiembre/octubre de 2026; lentejas, arroz, tortilla, sopa, pescado y otros platos de ejemplo | `tests/`, `firmware/note4/tests/`, `scripts/seed-demo.mjs`    |
| Tarjetas de pantalla             | Trece escenarios de listas, fichas, comparaciones, destacados, textos largos y resultados parciales                                                                                                                  | `tests/fixtures/note4-cards.json`                             |
| Credenciales simuladas           | `fake-token`, `fake-access`, `fixture-web-secret`, `fixture-google-refresh`, `fixture-token`, `test-secret`, `password-demo`, código `123456` y tokens de caracteres repetidos                                       | Pruebas OAuth, HTTP, SRP, OTA y Gateway aislado               |
| Red e identificadores simulados  | Loopback, IP privadas de ejemplo, `Nido-A1B2C3`, `note4-demo`, `note4-fixture`, repositorio `example/nido`, IDs y ETags sintéticos, dominios de ejemplo                                                              | Pruebas y documentación                                       |
| Criptografía de pruebas          | Código que genera claves RSA y certificados temporales; firmas y binarios ficticios construidos durante las pruebas. No se incluyen los archivos de claves privadas generados                                        | Pruebas de mantenimiento, GitHub y OTA                        |
| Recursos visuales y sonoros      | Cinco pantallas de ejemplo, un logo ilustrado y cuatro avisos electrónicos de 120–350 ms                                                                                                                             | `docs/assets/`, con hashes en `config/public-assets.json`     |

`pnpm run release:check` superó la revisión del árbol publicable y las referencias de publicación. Una copia temporal de esos mismos archivos pasó otra revisión después de añadirlos únicamente a su índice temporal. El índice original quedó vacío y no se creó ningún commit. Pasaron las doce pruebas del comprobador de publicación.

Una búsqueda adicional de JWT, claves privadas, conexiones de base de datos con contraseña y literales largos de alta entropía no encontró nuevos candidatos. Se revisaron las credenciales simuladas en su contexto de pruebas. Las cinco imágenes de pantallas contienen únicamente chunks PNG IHDR/IDAT/IEND; el logo conserva su bloque de procedencia C2PA ya registrado. Los diez binarios coinciden con los hashes revisados.

No se detectaron secretos reales en este alcance. Se excluyen `.local`, `.runtime`, `.cache`, `.env`, claves y certificados privados, bases de datos, sesiones, respaldos, logs, compilaciones y paquetes generados. Los snapshots internos `refs/codex/*` no forman parte de un push normal y no están certificados por esta revisión. No publicar la carpeta completa ni usar `push --mirror`. Repetir el control sobre el índice y los commits definitivos antes de subirlos: no hay una garantía absoluta basada solo en patrones.
