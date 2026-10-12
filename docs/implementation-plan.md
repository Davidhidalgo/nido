# Nido: plan del MVP

Estado: implementación local iniciada el 17 de septiembre de 2026. OpenClaw 2026.9.4, agentes y extensión preparados en modo demo; conexiones reales y validación familiar pendientes. Este documento sustituye el plan anterior de aplicación propia con Nx y un agente construido sobre un SDK.

La instalación actual y sus límites están en [la guía de inicio](getting-started.md); las pruebas realizadas, en [verificación](verification.md). Los hitos siguientes siguen siendo criterios de aceptación, no una afirmación de que todo esté completado.

## 1. Objetivo y decisiones acordadas

Validar que Nido resulta útil a la familia para organizar el menú y los eventos familiares antes de invertir en interfaces, hardware o mantenimiento adicional.

- Nido es un único asistente de cara a la familia, con agentes especializados internamente.
- Usar OpenClaw como base, sin mantener un fork. Reutilizar sus conversaciones, herramientas y canales.
- Interfaz del MVP: chat web de OpenClaw o bot de Telegram. No desarrollar una web propia. Empezar por el chat web es una recomendación, no una elección definitiva del usuario.
- Google Calendar es la fuente de verdad del menú y la agenda. No replicar esos datos ni implementar un respaldo adicional de Calendar, por decisión del usuario.
- Generar el menú escribe directamente en Calendar; no hay una fase obligatoria de propuesta y aprobación. Se permiten rectificaciones posteriores.
- El agente puede preguntar antes de ejecutar cuando falte información relevante y continuar con la respuesta del usuario.
- Guardar preferencias familiares cuando el usuario lo solicite explícitamente, para mejorar peticiones futuras.
- Proveedor de modelos inicial: OpenAI. Mantener la elección de proveedor configurable mediante las capacidades de OpenClaw.
- Self-hosted first; Mac mini como destino doméstico posible. El equipo inicial sigue pendiente. Cloudflare Workers deja de ser un requisito del MVP.
- Nombre del proyecto: Nido. No hace falta publicar ni crear un repositorio remoto.
- Copias de seguridad: solo planificadas. No implementarlas ni activarlas durante esta fase de validación.

## 2. Casos de uso

### Menú

Consultar, generar y rectificar comidas y cenas para un día o un período. Consultar preferencias y agenda familiar para detectar situaciones relevantes.

Ejemplo: «Organiza las cenas de esta semana». Si aparece un cumpleaños el sábado, preguntar si cenaremos allí cuando afecte a la planificación. Guardar el menú directamente cuando la información sea suficiente y comunicar el resultado real.

La convención propuesta es un calendario dedicado y un evento por comida o cena, con títulos legibles como `Cena · Tortilla`. Los horarios se configurarán con la familia.

Propuesta pendiente de validar: completar huecos conservando comidas existentes por defecto; sustituirlas si se pide rehacer el menú. Resolver destinos ocupados sin eliminar eventos implícitamente.

### Agenda familiar

Consultar, crear, modificar y eliminar eventos familiares en los calendarios autorizados. Leer antes de editar y conservar los campos ajenos a la petición. Preguntar ante fechas, personas o coincidencias ambiguas.

Primer corte propuesto: eventos puntuales; consultar recurrentes sin modificar series y dejar invitaciones a terceros para después. Antes de habilitar borrados, concretar su confirmación específica; no trasladar esa confirmación a todas las escrituras del menú.

### Preferencias

- «Recuerda que preferimos cenas ligeras» permite persistir una preferencia.
- «Esta semana queremos cenas ligeras» tiene alcance temporal.
- «Hoy cambia la tortilla por sopa» rectifica el menú sin deducir una preferencia permanente.
- Permitir consultar, corregir y eliminar preferencias mediante herramientas limitadas.
- Preguntar a quién se refiere una preferencia personal si no resulta claro. No asumir reconocimiento de hablantes.

## 3. Agentes y permisos

| Agente | Lectura                                             | Escritura                                                     |
| ------ | --------------------------------------------------- | ------------------------------------------------------------- |
| Menú   | Menú, agenda autorizada y preferencias alimentarias | Calendario del menú y preferencias explícitamente solicitadas |
| Agenda | Agenda autorizada y menú si hace falta              | Calendarios de agenda autorizados                             |

El punto de entrada Nido dirige las peticiones al agente adecuado y mantiene la continuidad de las aclaraciones. No necesita permisos propios de escritura. La selección por intención en un único chat es una integración que hay que validar; no asumir que los bindings de canales la resuelven por sí solos.

- OpenClaw limita las herramientas disponibles por agente.
- La integración Calendar valida el calendario y la operación contra permisos asignados por el sistema. No confiar en un agentId o permiso declarado por el modelo.
- Las herramientas generales pueden compartir implementación, pero su autorización debe ser distinta para cada agente.
- No habilitar terminal, navegador, edición arbitraria de archivos, instalación de herramientas ni cambios de configuración para los agentes familiares.
- Restringir delegación y comunicación entre agentes para impedir que un agente use a otro para ampliar su alcance.
- Leer la agenda no requiere delegar en el agente de agenda.
- Los textos de Calendar se consideran datos, nunca instrucciones que concedan permisos.
- Las preferencias se cambian mediante una herramienta específica, sin acceso general de escritura al repositorio.

## 4. Conversación y trazabilidad

Reutilizar el historial y las sesiones de OpenClaw. Una pregunta termina el turno y la siguiente respuesta continúa la conversación; no desarrollar un protocolo propio antes de comprobar las capacidades del canal elegido.

Validar preguntas de varios turnos y respuestas breves como «sí» o «el sábado». Si una respuesta no permite identificar una pregunta pendiente vigente, pedir aclaración. Inicialmente, tratar el dispositivo o chat compartido como familiar, sin inferir identidades por la voz.

Conservar conversaciones durante el uso ordinario. La persistencia operativa es necesaria para conversar y es distinta de las copias de seguridad, que quedan aplazadas.

Para las escrituras, aprovechar la trazabilidad existente y completar solo lo necesario para vincular conversación, agente, operación, evento y resultado de Google. No interpretar un mensaje de éxito del modelo como prueba de una escritura.

Antes del uso familiar, comprobar permisos, reintentos sin duplicados, cambios concurrentes y fallos parciales. No prometer transacciones entre varios eventos. Un error de lectura no significa que el calendario esté vacío.

## 5. Organización local propuesta

No crear carpetas o repositorios adicionales hasta que los necesite la instalación.

- `~/nido-private/`: Git local privado para instrucciones, configuración sin secretos y preferencias. Workspaces de menú y agenda separados y preferencias compartidas con acceso controlado.
- `~/.openclaw/`: estado operativo según la versión instalada, incluyendo sesiones y credenciales. No añadirlo indiscriminadamente a Git.
- `~/nido/`: código propio solo si hacen falta plugins o clientes; no es un requisito para probar OpenClaw.

Git local permite revisar cambios, pero no constituye una copia en otro dispositivo. No subir datos privados ni crear remotos en esta fase.

Las decisiones previas sobre Nx, pnpm, TypeScript y Oxc quedan como referencia para cuando haya desarrollo propio. No inicializar ese monorepo ni construir un agente alternativo con AI SDK para este MVP. NOTE4 y Siri quedan para una fase posterior.

## 6. Hitos de validación

### H1. Instalación y acceso

Elegir equipo y canal. Usar la versión estable fijada y comprobada de OpenClaw y configurar el proveedor inicial, acceso familiar e identidad Nido. Revisar las capacidades de la versión instalada antes de escribir configuración; no copiar flags supuestos de este plan.

Aceptación: la familia puede conversar desde el chat web o Telegram y continuar una aclaración. No hay tareas proactivas ni herramientas innecesarias habilitadas.

### H2. Menú con lectura de agenda

Configurar el agente de menú, preferencias iniciales, integración Calendar y permisos. Evaluar integraciones existentes antes de desarrollar una propia. Verificar primero con calendarios de prueba y después conectar los calendarios acordados para uso familiar.

Aceptación: consultar menú, planificar cenas, detectar un cumpleaños, preguntar, guardar directamente, rectificar y recordar una preferencia explícita. Una escritura del agente de menú en la agenda se rechaza técnicamente. Repetir un envío no duplica eventos.

### H3. Agenda y entrada unificada

Añadir el agente de agenda y resolver el enrutamiento desde la misma experiencia Nido. Mantener el agente y la sesión correctos durante las aclaraciones y limitar la delegación.

Aceptación: crear y editar una cita, aclarar una coincidencia ambigua y aplicar los permisos distintos de menú y agenda sin que la familia deba conocer la arquitectura interna.

### H4. Uso familiar

Usarlo en situaciones cotidianas y registrar fricciones: preguntas innecesarias, interpretaciones incorrectas, tiempos de respuesta y rectificaciones. Ajustar instrucciones y herramientas antes de ampliar el alcance.

No condicionar esta validación a copias automáticas, NOTE4, Siri, una interfaz propia, publicación del código o alojamiento definitivo.

## 7. Copias de seguridad: fase posterior, sin implementar

Decisión explícita: primero validar que el sistema funciona en la familia. Esta sección conserva el plan futuro; no autoriza crear automatizaciones, copias, carpetas en iCloud ni instalar herramientas de respaldo ahora.

Cuando se retome esta fase:

1. Incluir el repositorio privado con su historial Git, preferencias, configuración y estado de OpenClaw necesario para recuperar conversaciones e instalación.
2. Usar el mecanismo de backup de la versión instalada de OpenClaw para obtener una copia coherente del estado. Comprobar que también se incluyen los workspaces externos y los archivos propios de Nido.
3. Crear y verificar los archivos localmente. Cifrar las copias que contengan credenciales antes de trasladarlas a iCloud Drive; definir dónde recuperar la clave de cifrado.
4. Usar `iCloud Drive/Nido/Backups` como destino propuesto de copias fechadas. Mantener el repositorio activo y las bases de datos operativas fuera de la carpeta sincronizada.
5. Definir frecuencia y retención al implementar; siguen pendientes. No activar un calendario de copias como parte del MVP.
6. Probar una restauración en un directorio aislado, sin sobrescribir la instalación activa. Considerar entonces una copia local adicional o Time Machine.

Si OpenClaw se aloja fuera de un Mac, concretar cómo llegarán las copias a un Mac que sincronice iCloud. No dar por supuesto un cliente de iCloud en el servidor.

Google Calendar queda excluido de este plan de respaldo, por decisión del usuario.

## 8. Datos todavía necesarios

- Equipo donde ejecutar OpenClaw inicialmente y disponibilidad esperada.
- Chat web o Telegram como primer canal y quién tendrá acceso.
- Cuenta Google, IDs de calendarios y permisos autorizados.
- Preferencias familiares iniciales, comensales y horarios del menú.
- Proveedor/modelo accesible y credenciales, introducidas fuera del repositorio.

## Referencias para la implementación

Consultar la documentación correspondiente a la versión instalada; estos enlaces son puntos de entrada y no garantizan que todas las opciones descritas estén presentes en esa versión.

- [OpenClaw: múltiples agentes](https://docs.openclaw.ai/concepts/multi-agent).
- [OpenClaw: permisos de herramientas](https://docs.openclaw.ai/gateway/security/tool-permissions).
- [OpenClaw: workspaces y Git](https://docs.openclaw.ai/agent-workspace).
- [OpenClaw: chat web](https://docs.openclaw.ai/web/webchat).
- [OpenClaw: audio](https://docs.openclaw.ai/nodes/audio).
- [OpenClaw: copias, para la fase posterior](https://docs.openclaw.ai/cli/backup).
