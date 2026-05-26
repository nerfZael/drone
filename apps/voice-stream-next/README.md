# Voice Stream Next

Voice Stream Next is the planned parallel voice and assistant product for Drone. It is intentionally separate from the current `apps/voice-stream` implementation so the existing Android voice, desktop voice, assistant side panel, and Drone Hub workflow can keep working while the new product is designed and built.

This directory is the parallel Voice Stream product. It should not affect the current monorepo build, Hub launch flow, or legacy Android APK.

Internal monorepo name: `voice-stream-next`.

User-facing product name: Voice Stream.

## Goal

Build a standalone voice product with:

- an Android voice client
- an Electron desktop voice client
- a Vite web dashboard
- a Fastify backend
- assistant threads and settings
- Clerk login on Android and desktop
- per-user profiles
- starter SQLite persistence in the server data directory
- a clean protocol between clients and the service
- no required Drone Hub integration during the first development phase

Drone Hub integration should come later through explicit adapters, after the new product reaches enough feature parity to replace or coexist with the current voice stack.

## Current Baseline

The existing working system remains:

```text
apps/voice-stream       # current Android app and voice server
apps/drone              # current Hub API, assistant runtime, desktop voice service
apps/drone-hub          # current React UI and assistant side panel
```

Voice Stream Next should not import implementation code from `apps/voice-stream` directly. Code that is truly shared should move into stable `packages/*` modules or shared test fixtures.

## Docs

- [Product Spec](docs/product-spec.md)
- [Architecture](docs/architecture.md)
- [Parity And Migration Plan](docs/parity-and-migration.md)
- [Assistant Parity Roadmap](docs/assistant-parity-roadmap.md)
- [Open Questions](docs/open-questions.md)

## Development

```bash
bun run voice-stream-next
bun run voice-stream-next:desktop
bun run voice-stream-next:apk
```

The server defaults to `http://127.0.0.1:3299`, the web dashboard defaults to `http://127.0.0.1:5185`, and the Android emulator defaults to `http://10.0.2.2:3299`.

Clerk-backed server auth is enabled when `CLERK_SECRET_KEY` is set. Local development can use the built-in dev headers. Android initializes the Clerk SDK when `VOICE_STREAM_NEXT_ANDROID_CLERK_PUBLISHABLE_KEY` is present at build time.

Voice speech runtime is server-side. Local wake detection runs on-device with Vosk, speech-to-text and TTS use Groq from the server (`GROQ_API_KEY`, optionally `GROQ_STT_API_KEY` / `GROQ_TTS_API_KEY`). Assistant OpenAI and Exa keys are stored per user from the dashboard and encrypted with `VOICE_STREAM_NEXT_SECRETS_KEY`.
