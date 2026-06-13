# Voice Stream Next Architecture

## Proposed Directory Shape

```text
apps/voice-stream-next/
  README.md
  docs/
    product-spec.md
    architecture.md
    parity-and-migration.md
    open-questions.md
  android/          # future Kotlin Android app
  desktop/          # future Electron desktop voice client
  web/              # future Vite web dashboard
  server/           # future Fastify backend
```

The directory is documentation-only at first. Add `package.json`, Gradle files, and workspace wiring only when implementation starts.

## Relationship To Existing Code

Current production path:

```text
apps/voice-stream
apps/drone
apps/drone-hub
```

New parallel path:

```text
apps/voice-stream-next
```

The new path should not break or rename the current path. The current Drone Hub CLI still launches the existing `apps/voice-stream` app.

## Target Runtime Model

```text
Android Voice Client
  connects to
Voice Stream Next Backend

Electron Voice Client
  connects to
Voice Stream Next Backend

Web Dashboard
  connects to
Voice Stream Next Backend

Voice Stream Next Backend
  later connects to
Drone Hub
```

The first milestone includes the Voice Stream Next backend and web dashboard. Assistant is part of this same backend. Drone Hub integration should be an explicit adapter added later.

## Hosted Baseline

The first hosted target is Railway.

Expected hosted pieces:

- Voice Stream Next Fastify backend deployed on Railway
- Vite web dashboard
- Clerk for user login
- SQLite database stored under the server data directory
- Railway persistent volume mounted to that data directory

The service must treat the mounted data directory as the only durable local filesystem location.

Implementation order:

1. Clerk auth in local development.
2. SQLite local persistence.
3. Railway deploy after local auth and persistence are working.

## Boundary Rules

### Voice Clients

Voice clients may know:

- Clerk auth state
- server URL
- per-device pairing token
- protocol version
- device identity
- wake/sleep/approval mode state
- audio capture and playback
- local diagnostic log state

Voice clients should not know:

- drone IDs
- drone groups
- chat internals
- Docker, dvm, tmux, or repo operations

### Web Dashboard

The web dashboard may know:

- Clerk auth state
- assistant threads
- assistant settings
- voice settings
- per-user voice code settings
- profile data
- transcripts
- logs
- connected-device monitor data for admins

The web dashboard does not need browser microphone capture or browser voice recognition in v1.

### Voice Stream Next Backend

The service may know:

- Clerk user id
- user profile
- user devices
- assistant threads
- assistant settings
- connected devices
- active sessions
- audio stream state
- transcript state
- client status
- control messages
- local/dev pairing
- uploaded diagnostic logs

The backend should not directly own Drone Hub execution. Later, it can call an adapter that knows how to talk to Drone Hub.

### Assistant Module

Assistant responsibilities inside the backend:

- store assistant threads and messages
- receive final voice transcripts as assistant messages
- reuse the user's latest voice thread in v1
- route assistant response text/audio back to voice clients
- generate spoken assistant responses when speech output is requested
- handle assistant approval requests
- expose assistant state to the web dashboard

### Drone Hub Adapter

Future adapter responsibilities:

- list drones
- message selected drones/chats
- read transcript/status
- approve or deny actions
- expose a narrow, authenticated control surface

## Shared Code Strategy

Prefer shared contracts over shared implementation at first.

Good shared candidates:

- protocol TypeScript types
- JSON schemas
- pairing payload shape
- status event names
- transcript event names
- mode transition fixtures
- approval phrase test vectors

Risky shared candidates:

- Android wake-word implementation
- desktop microphone implementation
- current Hub-specific assistant routes
- current `apps/voice-stream` server internals

Potential packages:

```text
packages/voice-protocol
packages/voice-fixtures
packages/voice-node
```

Only add these when there is real reuse. Do not create abstractions before both old and new systems need them.

Test fixtures means shared example inputs and expected outputs, not shared runtime code. For example:

- phrase in: `approval code one one five nine`
- expected result: approval code `1159`
- phrase in: `hey sebastian`
- expected mode transition: `sleeping` to `recording`

Fixtures are useful because TypeScript, Kotlin, and Electron can all run their own implementations against the same expected behavior without forcing one shared implementation too early.

TTS means text-to-speech: generating spoken audio from text. STT means speech-to-text: turning microphone audio into transcript text.

The current legacy app has `apps/voice-stream/server/src/stt.ts` and `apps/voice-stream/server/src/tts.ts`. Those files contain the current server-side speech-to-text and text-to-speech provider logic. We can either extract parts of them later into shared packages, or let the new Fastify service start fresh and only copy ideas. Starting fresh is likely simpler until the new backend shape is clear.

Protocol schemas should live in a TypeScript package first, then Kotlin models can be generated or manually mirrored once the shapes settle.

Recommended first shared package:

```text
packages/voice-protocol
```

## Protocol Draft

Pairing payload:

```json
{
  "version": 1,
  "serverUrl": "https://example.test",
  "audioUrl": "wss://example.test/audio",
  "controlUrl": "wss://example.test/control",
  "token": "per-device-pairing-token",
  "minClientVersion": 1,
  "deviceType": "android"
}
```

Client status event:

```json
{
  "type": "client_status",
  "deviceId": "device-id",
  "deviceType": "android",
  "mode": "sleeping",
  "microphone": "Built-in microphone",
  "reportedAt": "2026-05-21T00:00:00.000Z"
}
```

Transcript event:

```json
{
  "type": "transcript_segment",
  "sessionId": "session-id",
  "text": "create a reviewer drone",
  "final": true,
  "source": "android",
  "createdAt": "2026-05-21T00:00:00.000Z"
}
```

Control event:

```json
{
  "type": "control",
  "command": "sleep",
  "reason": "sleep_phrase"
}
```

Approval event:

```json
{
  "type": "approval_code",
  "code": "1159",
  "source": "android",
  "detectedAt": "2026-05-21T00:00:00.000Z"
}
```

These are drafts. The exact schema should be tightened before implementation.

## Security Model

Phase one auth and security:

- Clerk login required for normal Android and desktop clients
- backend verifies client auth before exposing user data
- user data is scoped by Clerk user id
- per-device pairing token required for client WebSockets
- pairing QR protected by an admin password or local-only access
- public download page may exist, but must not expose pairing tokens
- logs must not include full secrets

Future hosted security:

- per-device tokens
- token rotation
- device revocation
- scoped assistant/Drone Hub permissions
- audit log for assistant and drone-control actions

## Persistence Model

Starter persistence:

```text
VOICE_STREAM_NEXT_DATA_DIR=/data
/data/voice-stream-next.sqlite
```

Local development can default to:

```text
apps/voice-stream-next/server/data/voice-stream-next.sqlite
```

Railway deployment should mount a persistent volume at the configured data directory. The service should fail clearly if it is configured for hosted mode but the data directory is not writable.

Suggested initial schema:

```text
users
  id
  clerk_user_id
  display_name
  email
  admin
  created_at
  updated_at
  last_seen_at

devices
  id
  user_id
  device_type
  display_name
  pairing_id
  last_seen_at
  created_at

pairing_sessions
  id
  user_id
  token_hash
  device_type
  expires_at
  used_at
  created_at

voice_sessions
  id
  user_id
  device_id
  mode
  started_at
  ended_at

transcripts
  id
  voice_session_id
  user_id
  text
  final
  created_at

client_logs
  id
  user_id
  device_id
  level
  message
  details_json
  created_at

voice_settings
  id
  user_id
  unlock_code
  lock_code
  off_code
  updated_at

approval_codes
  id
  voice_session_id
  user_id
  code
  source
  created_at
```

Transcript history has no time-based retention by default.

## Unified Backend Shape

Voice Stream Next will use one deployable backend for voice and assistant.

### Chosen Shape: One deployable service with separate modules

```text
Voice Stream Next backend
  auth module
  devices and pairing module
  voice session module
  transcript module
  logs module
  assistant module
  future Drone Hub adapter module
```

Reasons:

- simpler Railway deployment
- one Clerk integration
- one SQLite database
- easier user profiles and transcript history
- fewer network hops between voice and assistant state
- easier early development
- still keeps a clean path to split modules later if needed

## Compatibility Rule

The existing app remains the source of truth until Voice Stream Next reaches parity. No current Hub launch path should depend on this directory.
