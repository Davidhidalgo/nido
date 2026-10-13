# Nido

Nido is a family assistant built on OpenClaw for meal planning and shared calendars. You talk to Nido; it delegates to meal and agenda specialists with separate permissions. Start with demo calendars or connect Google Calendar. Telegram, TRMNL and NOTE4 are optional interfaces.

Project documentation is written in English. The product interface and family-agent interactions currently use Spanish.

## Features

<!-- Supported capabilities from integrations/nido-family/src/core.ts, integrations/nido-family/src/setup.ts, integrations/nido-family/src/meal-settings.ts, agents/nido/AGENTS.md, firmware/note4/README.md and integrations/trmnl/README.md -->

- **Conversational meal planning:** plan lunches and dinners, consult the menu, and save family food preferences for future suggestions.
- **Shared agenda:** find appointments and create, edit or delete individual events in authorized calendars. Keep meal planning and agenda permissions separate.
- **Multiple calendars:** choose default calendars, include additional calendars in the agenda, and configure read/write access for each specialist.
- **PDF attachments:** ask Nido to read a document through OpenClaw's PDF tool and use its contents in a meal-planning or agenda request.
- **Demo mode:** try the assistant with fictitious calendars, keeping demo events and preferences separate from Google data.
- **Native setup and settings:** configure agents, model selection, time zone, meal times and calendar permissions from the OpenClaw dashboard.
- **NOTE4 voice and e-paper interface (optional):** talk using the front button, answer on-screen questions, and browse meals and upcoming events. Configure meal dimming and install signed firmware updates.
- **Other optional integrations:** chat through Telegram, display calendar and meal views on TRMNL, or add conversational memory with Honcho.

Google Calendar support is implemented, but the shared connection service is not yet publicly configured. See [Google Calendar availability](#google-calendar-availability) before choosing that setup path.

## Install on an existing OpenClaw server

<!-- Installation and setup flow from integrations/nido-family/src/setup-admin.ts, integrations/nido-family/src/control-ui.ts and docs/getting-started.md -->

Nido installs as a plugin and provides a native setup page. The wizard creates the `nido`, `menu` and `agenda` agents, reuses the host's model configuration and stores family data outside the package. This revision has been tested with **OpenClaw 2026.9.8**; its plugin APIs are experimental.

<!-- Package filename matching integrations/nido-family/package.json name and version -->

1. Download the archive and checksum file from the [plugin 0.1.2 release](https://github.com/Davidhidalgo/nido/releases/tag/nido-plugin-0.1.2), then verify the archive's SHA-256.
2. Install it on the machine running OpenClaw:

   ```sh
   openclaw plugins install ./openclaw-plugin-nido-family-0.1.2.tgz
   ```

3. Open the dashboard as an administrator, enable **Settings → Labs → Custom plugin UI**, and open **Nido**.
4. Follow the wizard, review the configuration and save. Demo mode uses fictitious calendars and does not require Google.

See [getting started](docs/getting-started.md) for setup, permissions and recovery from interrupted operations. The [plugin guide](docs/plugin-install.md) covers packaging from source and required capabilities. An [isolated profile](docs/standalone-install.md) is available for development or a separate deployment.

### Google Calendar availability

<!-- Implementation status and limits from docs/getting-started.md, docs/google-oauth-service.md and docs/next-steps.md -->

The setup flow supports authorizing Nido's Google app and selecting calendars by name. Users do not need to create a Google Cloud project or upload a credentials file. However, the shared OAuth service still needs to be deployed and configured before this connection flow can be distributed with Google enabled. Until then, the wizard offers demo mode. Existing installations using the older Desktop credentials flow remain supported.

### Documents and conversational memory

<!-- Document tools from scripts/prepare-local.mjs, integrations/nido-family/src/setup.ts and agents/nido/AGENTS.md; memory isolation from scripts/note4.mjs -->

Nido uses OpenClaw's `pdf` tool to read attachments before delegating. Plugin installations inherit the host's document limits; the isolated profile sets a limit of 10 MB and 20 pages per document.

Optional conversational memory uses Honcho through its OpenClaw plugin. Local preparation preserves its configuration; the NOTE4 simulator disables Honcho to keep demo and family memories separate. See [conversational memory](docs/memory.md).

## NOTE4

<!-- Firmware commands and behavior from package.json, scripts/note4-firmware, firmware/note4/README.md and docs/verification.md -->

The NOTE4 client provides voice interaction and an e-paper view of meals and calendar events. Its generic firmware stores Wi-Fi and pairing details on the device, outside the application partitions.

Hold the front and lower buttons for five seconds to enter maintenance. After Wi-Fi setup, the device displays a six-digit pairing code; pair it through the plugin settings using local discovery or an IP address. Signed firmware updates are available through the plugin, the device's local web page, or directly from GitHub. Direct GitHub updates require acceptance with the upper button. Plugin-side GitHub downloads use `note4Maintenance.github.repository`.

The firmware uses two application partitions with rollback support. The initial USB migration requires a complete, verified backup. Pairing and OTA have been exercised on hardware, and retained-screen startup was confirmed with firmware 0.4.10. Battery/runtime measurements, forced rollback and some display behaviors still need physical verification; consult the dated [verification log](docs/verification.md) for the scope of each result. See the [maintenance and OTA guide](docs/note4-maintenance.md) before working with a device.

<!-- Bridge commands from package.json and scripts/note4-bridge.mjs -->

`pnpm run note4:setup` prepares the HTTPS bridge. With the family Gateway running, `pnpm run note4:bridge` receives audio and serves cards over the local network using Nido's configured calendars. Add `-- --demo` to select the demo Gateway.

<!-- NOTE4 simulation commands and isolation from package.json and scripts/note4.mjs -->

To try the NOTE4 agent and inspect its JSON cards without hardware:

```sh
pnpm run note4:chat -- --message="¿Qué cenamos mañana?"
pnpm run note4:dashboard
```

The simulator uses separate demo calendars even when the family installation uses Google. It can still call the configured model API. See [NOTE4 conversations and card tests](docs/note4-voice.md).

## Development

<!-- Development entry points and priority ownership from AGENTS.md, docs/session-workflow.md and docs/next-steps.md -->

Start with [AGENTS.md](AGENTS.md), the [session workflow](docs/session-workflow.md) and the [current resume point](docs/next-steps.md). Check actual Git state before continuing. The register owns current priorities; technical guides hold implementation details and dated evidence. Development uses fictitious data and requires neither past chats nor private diagnostics.

<!-- Runtime requirements and quality scripts from package.json and docs/development.md -->

Use **Node 24.16+ from the 24.x line** and **pnpm 9.0.5**. Follow the [development guide](docs/development.md) to install the local runtime and dependencies, then run:

```sh
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm run build
```

Additional checks depend on the change:

| Check                                   | Purpose                                                                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run test:gateway:isolated`        | Test permissions and operations against a temporary demo Gateway without reading the family installation.                  |
| `pnpm run test:plugin:isolated`         | Install the packaged plugin in a temporary host with an existing agent and verify setup. Run `pnpm run plugin:pack` first. |
| `pnpm run test:note4-firmware`          | Run native firmware tests and generate fictitious screen previews with the local SDK. Required for screen or C++ changes.  |
| `pnpm run note4:firmware build-generic` | Build the generic connected client without private device configuration. Compilation does not verify physical operation.   |

Firmware builds and tests do not flash a device. Follow the [firmware guide](firmware/note4/README.md) and its backup requirements for hardware work.

### Private data

<!-- Private state layout from scripts/private-state.mjs, scripts/prepare-local.mjs and docs/data-layout.md -->

Plugin installations store data under `<OpenClaw-state>/nido-family/`. The repository's isolated profile uses `~/.openclaw/nido/`, or the `NIDO_HOME` chosen during setup; `.local` is an ignored link to that directory.

Public agent templates contain generic rules only. Family members and schedules belong in private workspaces; food preferences are saved through conversation with the agent. Demo families are persistent installation state, not disposable caches. Private diagnostics belong in the external development archive; regenerable test output belongs in `.cache/`. See [data layout](docs/data-layout.md) before moving or deleting files.

### Preparing a release

<!-- Publication scan and packaging from scripts/release-check.mjs, config/public-assets.json and scripts/pack-plugin.mjs -->

Run `pnpm run release:check` before publication. It scans publishable files, the index and publication history without opening private state. Public binaries must match the reviewed hashes in `config/public-assets.json`; design images and device sounds use fictitious or synthetic content. Also review free-form text and commit identity using the [privacy guide](docs/privacy.md).

`pnpm run plugin:pack` builds an archive in `release/` from an explicit file list. It does not publish to npm or GitHub.

## Documentation

<!-- Documentation entry points that exist in docs/ and integration/firmware directories -->

| Topic                      | Guides                                                                                                                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installation               | [Getting started](docs/getting-started.md), [plugin installation](docs/plugin-install.md), [isolated deployment](docs/standalone-install.md)                                                                                            |
| Design and implementation  | [Architecture](docs/architecture.md), [implementation decisions](docs/implementation-notes.md), [MVP plan and deferred backups](docs/implementation-plan.md)                                                                            |
| Development and continuity | [Development and diagnostics](docs/development.md), [next steps](docs/next-steps.md), [session workflow](docs/session-workflow.md), [verification history](docs/verification.md)                                                        |
| Data and privacy           | [Data layout](docs/data-layout.md), [privacy and publication](docs/privacy.md), [conversational memory](docs/memory.md)                                                                                                                 |
| Services and access        | [Shared Google OAuth service](docs/google-oauth-service.md), [local HTTPS access](docs/local-control-url.md)                                                                                                                            |
| NOTE4                      | [Voice and JSON cards](docs/note4-voice.md), [design system](docs/note4-design-system.md), [firmware](firmware/note4/README.md), [maintenance and OTA](docs/note4-maintenance.md), [GitHub OTA contract](docs/note4-github-ota-spec.md) |
| TRMNL                      | [Integration and previews](integrations/trmnl/README.md)                                                                                                                                                                                |

Some linked guides are still being translated into English. Current priorities and outstanding work, including Siri integration, are tracked in [next steps](docs/next-steps.md).
