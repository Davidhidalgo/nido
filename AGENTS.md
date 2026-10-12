# Trabajar en Nido

Nido es un asistente familiar sobre OpenClaw. Esta guía es para desarrollar el proyecto; `agents/*/AGENTS.md` son plantillas del producto para los agentes familiares. Al editarlas, conserva sus reglas de comportamiento y permisos.

## Contexto suficiente dentro del repo

English is the official language for project documentation, including specifications, development guides, and GitHub release titles and notes. Write new documentation in English; translate existing documentation when it is explicitly requested or directly revised. Nido's user-facing interface and agent interactions remain in Spanish for now. Configurable product languages are planned for later; do not change runtime text as part of documentation translation.

Lee [arquitectura](docs/architecture.md), [desarrollo y diagnóstico](docs/development.md) y [organización de datos](docs/data-layout.md). [Inicio](docs/getting-started.md) describe la instalación; [decisiones](docs/implementation-notes.md) explica el diseño; [verificación](docs/verification.md) es un registro histórico, no el estado actual de un dispositivo.

El código, las pruebas y estas guías deben permitir trabajar sin acceder a la familia real ni a conversaciones de Codex anteriores. Cuando descubras algo útil, consérvalo como una prueba con datos ficticios o una explicación genérica en el repo. No dependas de scripts privados sueltos para verificar el proyecto.

## Datos y entornos

- `.local` apunta a estado privado externo de OpenClaw/Nido. Contiene familias real y demo, credenciales, historial y adjuntos. No es un lugar para experimentos de desarrollo.
- No leas ni copies datos familiares para orientarte en el código. Inspeccionar o modificar una instalación real requiere una petición del usuario que lo justifique. Trabaja con fixtures y entornos temporales por defecto.
- Las pruebas nativas generan vistas ficticias en `.cache/note4/firmware-preview/`. Usa `.cache/` para resultados regenerables sin datos personales. Los resultados privados de un diagnóstico autorizado se guardan fuera del checkout, en el archivo privado de desarrollo descrito en `docs/data-layout.md`.
- Conserva en el repo solo conclusiones genéricas de diagnósticos. No copies logs, transcripciones, audio familiar, IDs, direcciones de red, números de serie ni claves. La revisión de publicación no sustituye este criterio.
- No borres sesiones, SQLite, archivos WAL/SHM ni respaldos de fábrica como si fueran caché. La demo es estado legítimo de OpenClaw y no se elimina al ordenar experimentos.

## Invariantes

- La autorización se aplica en el plugin usando la identidad del runtime. El coordinador delega; `menu` y `agenda` tienen permisos distintos. Las instrucciones del modelo no conceden permisos.
- Una escritura incierta se reconcilia mediante lectura; no se repite ciegamente. Conserva ETags, control de versión de preferencias, deduplicación y separación demo/Google.
- Las instrucciones públicas son genéricas. Miembros, horarios y zona horaria se configuran por instalación; las preferencias se guardan con las herramientas del agente. No introduzcas datos familiares en las plantillas.
- No ejecutes `prepare:local`, cambies autenticación o reinicies procesos de una instalación real para una prueba rutinaria. Usa el recorrido aislado de `docs/development.md`.
- No flashees hardware como parte de una prueba de código. Para cambios en firmware, sigue `firmware/note4/AGENTS.md`, la guía del firmware y las reglas de respaldo/verificación existentes.

## Comprobaciones

Node 24.16+ de la rama 24 y pnpm 9.0.5. `pnpm test`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check` y `pnpm run build` son las comprobaciones del plugin. `pnpm run test:gateway:isolated` arranca un Gateway temporal con datos ficticios, comprueba permisos y lo detiene. Requiere permiso para abrir localhost; un error EPERM de red no demuestra un fallo funcional.

Ejecuta las pruebas pertinentes al cambio. Cambios en pantallas o C++ requieren además `pnpm run test:note4-firmware` con el SDK instalado. No confundas compilar, renderizar y cargar firmware con verificar su funcionamiento físico.

Actualiza las secciones de README vinculadas mediante comentarios HTML a lo que cambies. Antes de preparar una publicación ejecuta `pnpm run release:check`; empaqueta el plugin con `pnpm run plugin:pack`. No publiques ni hagas push sin que forme parte de la petición del usuario.
