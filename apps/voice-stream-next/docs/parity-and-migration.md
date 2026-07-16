# Parity And Migration Plan

## Strategy

Maintain Voice Stream as a standalone product. Move shared contracts into packages only when doing so reduces duplication without coupling Voice Stream to Drone Hub.

## Feature Parity Matrix

| Area | Current System | Voice Stream Next Target | First Target |
| --- | --- | --- | --- |
| Android app | Voice Stream Android client | Maintained Android client | Yes |
| Desktop voice | Voice Stream Electron client | Maintained Electron client | Yes |
| Voice server | Voice Stream Fastify backend | Maintained Fastify backend | Yes |
| Web dashboard | Voice Stream Vite dashboard | Maintained Vite dashboard | Yes |
| Pairing QR | Exists | Versioned pairing payload | Yes |
| Pairing token | Exists | Per-device token model | Yes |
| Wake phrase | Exists | Android and desktop behavior aligned | Yes |
| Locked/sleeping/recording modes | Exists | Shared mode model | Yes |
| Approval code | Exists | Shared command model | Yes |
| Status cue | Exists | Shared status behavior | Yes |
| STT | Exists through Groq | Provider-shaped service interface | Yes |
| TTS | Exists for approval/speech | Provider-shaped service interface | Yes |
| Login | Not current local model | Clerk login on Android and desktop | Yes |
| User profiles | Not current local model | SQLite-backed profile per Clerk user | Yes |
| Hosted persistence | Not current local model | SQLite on Railway persistent volume after local setup | Yes |
| Android diagnostics | Exists | Keep and improve | Yes |
| Desktop diagnostics | Exists through Hub | Move into desktop client | Yes |
| Admin monitor | Not current standalone model | Admin-only connected-device monitor | Yes |
| Assistant threads | Exists in Hub | New assistant module in Voice Stream Next backend | Yes |
| Assistant rich-thread parity | Exists in Hub | Runtime, streaming, tools, approvals, prompts, artifacts, model controls, and spoken replies without Drone Hub dependencies | Yes |
| Drone Hub control | Exists in Hub | Future Drone Hub adapter | No |

## Phase 0: Docs And Contracts

Deliverables:

- product spec
- architecture spec
- parity matrix
- open questions
- draft protocol events
- Clerk auth/profile baseline
- SQLite/Railway persistence baseline

No runtime behavior changes.

## Phase 1: Standalone Skeleton

Deliverables:

- `apps/voice-stream-next/server`
- `apps/voice-stream-next/web`
- `apps/voice-stream-next/desktop`
- `apps/voice-stream-next/android`
- Clerk login spike for Android and desktop
- SQLite database in configurable server data directory
- local run docs
- no Drone Hub dependency
- admin flag support on user profiles

Acceptance:

- Voice Stream Next remains independent of Drone Hub
- new server can start independently
- Vite web dashboard can start independently
- server creates or opens its SQLite database
- signed-in users resolve to profiles
- desktop and Android clients can connect to a local server in basic form
- desktop client starts as an Electron app
- admin users can access the connected-device monitor
- non-admin users cannot access the connected-device monitor

## Phase 2: Protocol And Pairing

Deliverables:

- versioned pairing payload
- user-scoped pairing sessions
- per-device pairing tokens
- client registration
- authenticated `/audio` and `/control` channels
- status event stream
- basic monitor page or CLI monitor

Acceptance:

- pairing is scoped to the signed-in user
- each paired device gets its own token
- Android and desktop clients report status with the same schema
- invalid tokens are rejected
- pairing does not expose secrets on public pages

## Phase 3: Voice Behavior Parity

Deliverables:

- shared mode transition tests or fixtures
- wake/sleep/status behavior
- approval-code behavior
- local cues
- pre-roll and connection buffering where supported
- legacy-equivalent phrases and mode transitions
- per-user lock, unlock, and off code settings

Acceptance:

- Android and desktop clients follow the same mode model
- behavior remains consistent across Voice Stream clients unless intentionally changed
- approval codes work without starting full audio streaming
- per-user lock/unlock/off codes are seeded with defaults and editable in web settings
- wake starts a recording/streaming session
- sleep returns to listening mode

## Phase 4: STT/TTS Parity

Deliverables:

- transcription provider interface
- TTS provider interface
- transcript event stream
- final transcript events
- speech/audio response event

Acceptance:

- service can produce final transcripts from both client types
- service can send spoken output to both client types
- provider failures surface clearly without breaking client mode state
- transcript history is stored for user-visible history
- client logs are stored as database rows

## Phase 5: Assistant Module

Deliverables:

- assistant module inside the Voice Stream Next backend
- web dashboard assistant thread UI
- submit final transcript as assistant message
- receive assistant response text/audio
- handle approval requests
- rich thread runtime, streaming events, run lifecycle, queued prompts, and stop/cancel support
- generic tool registry and per-thread tool controls
- system approval workflow for non-drone tool calls
- per-thread model controls
- global and per-thread system prompts
- assistant artifacts
- spoken replies for voice threads

Acceptance:

- no direct Drone Hub dependency
- text side panel and voice clients can target the same assistant thread model later
- voice devices reuse the user's latest voice thread in v1
- assistant module generates spoken assistant responses when speech output is requested
- assistant tool calls and approvals work without any Drone Hub or Docker dependency
- assistant artifacts are stored as thread-scoped data, not local repo files

Detailed non-drone assistant parity work is tracked in [Assistant Parity Roadmap](assistant-parity-roadmap.md).

## Phase 6: Drone Hub Adapter

Deliverables:

- narrow Drone Hub client
- list drones
- send drone/chat prompt
- read status/transcripts
- approval path

Acceptance:

- assistant controls drones through explicit permissions
- no voice client talks directly to Drone Hub internals

## Running Both Systems During Migration

Rules:

- keep root Voice Stream scripts pointed at `apps/voice-stream-next`
- keep Voice Stream release scripts independent of Drone Hub launch behavior

## Cutover Decision

The legacy Drone Hub-bundled Voice Stream app has been removed. Voice Stream Next is the standalone product and Drone Hub retains only manual Groq transcription flows.

## Current Decisions

- Internal monorepo name: `voice-stream-next`.
- User-facing product name: Voice Stream.
- Product directory is `apps/voice-stream-next`.
- Desktop app starts as Electron.
- Electron app starts with a normal app window only.
- Web dashboard is part of the product.
- Web dashboard does not need browser voice recognition in v1.
- Initial web dashboard includes an admin-only connected-device monitor.
- Backend uses Fastify.
- Web dashboard uses Vite.
- Voice and assistant are the same app/service.
- Voice behavior should match the current stack first.
- Clerk auth is implemented locally before Railway hosting.
- Railway hosting comes after auth and local persistence are working.
- Pairing tokens are per device.
- Client logs upload by default.
- Android should use Clerk's native Android SDK if it fits the target stack; otherwise use browser-based auth.
- Protocol schemas can live in a TypeScript package first.
- Approval codes stay numeric.
- Lock, unlock, and off codes are per-user settings from the start.
- No log deletion controls or export flows in v1.
- Client logs are stored as database rows.
- Voice sessions reuse the user's latest voice thread in v1.
- Spoken assistant responses are generated by the assistant module.
