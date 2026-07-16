# Voice Stream Next

Voice Stream Next is the standalone voice and assistant product for Drone. It is intentionally separate from Drone Hub and owns its Android, desktop, web, and server voice implementations.

This directory should not affect the Drone Hub launch flow or the DroneHub Android app.

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

Drone Hub integration is provided only through explicit adapters. Drone Hub does not launch or own this product's voice runtime.

## Current Baseline

Voice Stream Next is self-contained under `apps/voice-stream-next`. Code shared with other products belongs in stable `packages/*` modules or shared test fixtures.

## Docs

- [Product Spec](docs/product-spec.md)
- [Architecture](docs/architecture.md)
- [Parity And Migration Plan](docs/parity-and-migration.md)
- [Assistant Parity Roadmap](docs/assistant-parity-roadmap.md)
- [Open Questions](docs/open-questions.md)

## Development

```bash
bun run vsn
bun run vsn:desktop
bun run vsn:apk
```

The server defaults to `http://127.0.0.1:3299`, the web dashboard defaults to `http://127.0.0.1:5185`, and the Android emulator defaults to `http://10.0.2.2:3299`.

Clerk-backed server auth is enabled when `CLERK_SECRET_KEY` is set. Local development can use the built-in dev headers. Android initializes the Clerk SDK when `VOICE_STREAM_NEXT_ANDROID_CLERK_PUBLISHABLE_KEY` is present at build time.

Voice speech runtime is server-side. Local wake detection runs on-device with Vosk. Speech-to-text and TTS use the user's Groq key from dashboard API key settings when configured; otherwise they use server Groq keys (`GROQ_API_KEY`, optionally `GROQ_STT_API_KEY` / `GROQ_TTS_API_KEY`) and platform credits. Assistant OpenAI, Exa, and Groq keys are stored per user from the dashboard and encrypted with `VOICE_STREAM_NEXT_SECRETS_KEY`.

## Desktop Computer Audio Recording

The Electron desktop app can record microphone plus computer audio and save it to the Voice Stream Next server. It uses `ffmpeg` from the desktop machine, streams 16 kHz mono PCM chunks to the server while recording, and the server keeps a downloadable WAV plus a live Groq transcript in recording history. Transcription runs in rolling windows with overlap so long recordings do not need to stop before text appears. The web app and desktop history link both use `/settings/recordings`, where transcripts can be downloaded as `.txt` files.

Linux defaults to Pulse/PipeWire sources:

```bash
VOICE_STREAM_NEXT_CALL_RECORDER_MIC_SOURCE=pulse:default
VOICE_STREAM_NEXT_CALL_RECORDER_SYSTEM_SOURCE=pulse:@DEFAULT_MONITOR@
```

macOS and Windows usually need a virtual loopback device for system audio. Set `VOICE_STREAM_NEXT_CALL_RECORDER_SYSTEM_SOURCE` to an ffmpeg input spec such as `avfoundation:<device>` on macOS, `dshow:<device>` on Windows, or `wasapi:<device>` when your ffmpeg build supports it. Set `VOICE_STREAM_NEXT_CALL_RECORDER_FFMPEG` when `ffmpeg` is not on `PATH`.
