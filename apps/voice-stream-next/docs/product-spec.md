# Voice Stream Next Product Spec

## Summary

Voice Stream Next is a standalone voice and assistant product for Drone. It should support Android and Electron desktop voice clients, plus a web dashboard for assistant threads, settings, logs, profiles, and account state. The first version should be useful without Drone Hub integration. Later, the same backend can add a Drone Hub adapter.

The product should treat voice clients as input/output integrations. The assistant runtime lives in the same Voice Stream Next backend.

```text
Android Voice Client   \
Electron Voice Client  ---> Voice Stream Next backend ---> future Drone Hub adapter
Web Dashboard          /
```

## Non-Goals For The First Phase

- Do not replace the current `apps/voice-stream` app.
- Do not remove or rewrite current desktop voice inside Drone Hub.
- Do not require Drone Hub to run.
- Do not require Docker, dvm, tmux, repo access, or terminal access.
- Do not build a custom auth system. Use Clerk for user login and identity.
- Do not build web microphone/voice recognition in the first web dashboard.

## Users

Primary user:

- A developer/operator who wants hands-free control from Android or desktop.

Near-term usage:

- Sign in on Android or desktop.
- Use a personal profile tied to the signed-in user.
- Pair a device.
- Start listening.
- Use wake, sleep, lock, status, and approval-code flows.
- Open the web dashboard.
- Chat with assistant threads from the web dashboard.
- Manage assistant and voice settings from the web dashboard.
- Admin users can open a lightweight connected-device monitor.
- View logs and copy log text when needed.
- See live session state and transcripts.
- Test Android and desktop clients against the same server behavior.

Later usage:

- Send voice prompts to assistant threads in the Voice Stream Next backend.
- Approve assistant or Drone Hub actions by voice.
- Control drones through an authenticated integration.

## Product Principles

- Current voice stack must keep working.
- New product can evolve independently.
- Android and desktop should share behavior where practical.
- Shared behavior should be captured as protocol, fixtures, and tests before shared implementation.
- Drone Hub integration should be an adapter, not a core dependency.
- Local privacy should be explicit: no microphone streaming before wake/recording state.
- State should be visible and debuggable.
- User identity should be explicit: Android and desktop clients authenticate with Clerk.
- Starter persistence should stay simple: SQLite in the server data directory.
- Voice and assistant should ship as one service first, not separate deployed services.
- The web dashboard is for assistant, settings, logs, and account UX. It does not need web voice recognition in v1.

## Client Responsibilities

### Android Voice Client

Owns:

- Clerk login
- microphone capture
- foreground service behavior
- local wake/lock/status/approval detection where possible
- pairing flow
- local cue playback
- upload of diagnostic logs when enabled
- audio stream transport to the voice service
- playback of service-provided speech/audio responses

Does not own:

- Drone Hub concepts
- drone creation or chat routing
- tool approval policy

### Electron Desktop Voice Client

Owns:

- Clerk login
- Electron app shell
- host microphone capture
- local wake/lock/status/approval detection where possible
- the same main listening behavior as the current voice stack
- local cue playback
- optional tray/menu-bar UX later
- audio stream transport to the voice service
- playback of service-provided speech/audio responses

Does not own:

- Drone Hub concepts
- drone execution
- repo or terminal access

### Web Dashboard

Owns:

- Clerk login
- assistant thread UI
- assistant settings
- voice settings
- per-user voice code settings
- admin-only connected-device monitor
- profile/account UI
- transcript and log viewing
- copy-to-clipboard affordances for logs/transcripts

Does not own in v1:

- web microphone capture
- web wake-word recognition
- Drone Hub concepts

### Voice Stream Next Backend

Owns:

- Clerk token verification
- user profile records
- device records tied to users
- assistant threads
- assistant settings
- client pairing
- session state
- audio WebSocket endpoints
- transcript generation
- sleep/wake command detection from transcripts when local detection is unavailable
- status/event broadcasting
- optional TTS response generation
- protocol version checks
- diagnostics

Does not own in phase one:

- Drone Hub execution
- permanent workflow state beyond local/dev runtime needs

## Auth And Profiles

Voice Stream Next should use Clerk for login on both Android and desktop.

Baseline auth model:

- Android signs in with Clerk.
- Desktop signs in with Clerk.
- Clients send Clerk-issued auth to the Voice Stream Service.
- The service verifies the auth and resolves a local user profile.
- Devices belong to a user profile.
- Voice sessions belong to a user profile.

Starter profile fields:

- user id from Clerk
- display name
- primary email when available
- admin flag
- created timestamp
- last seen timestamp
- per-user voice settings
- per-user lock, unlock, and off codes

Do not invent local passwords or a separate account system.

## Persistence

The first backend database should be SQLite.

Default storage:

```text
server/data/voice-stream-next.sqlite
```

The server should allow the data directory to be configured with an environment variable, for example:

```text
VOICE_STREAM_NEXT_DATA_DIR=/data
```

For Railway hosting, the SQLite file should live on a connected persistent volume mounted into that data directory. The app should not rely on Railway's ephemeral filesystem for durable data.

Initial tables should cover:

- users
- devices
- pairing sessions
- voice sessions
- transcripts
- approval codes
- assistant threads
- assistant messages
- assistant settings
- client status snapshots or event log
- client logs

Transcript history should be stored because the product needs to show users what was heard and what happened. There is no time-based retention by default. Later, users can get explicit deletion/export controls.

Client logs should be stored as database rows so the web dashboard can show them without reading log files from disk.

SQLite is the starter choice. The schema should avoid assumptions that make a later move to Postgres painful.

## Modes

The product should keep a small, shared mode model:

- `off`: microphone service is stopped.
- `locked`: local listener is active, but normal wake/prompt commands are ignored.
- `sleeping`: local listener is active and can wake into recording.
- `recording`: client is streaming or submitting audio.
- `transcribing`: service is finalizing text.
- `error`: client or service hit a recoverable error.

The current product uses similar behavior. Voice Stream Next should document the mode transitions first, then implement them consistently across Android and desktop.

## Core Voice Commands

Initial command set:

- wake phrase: `hey sebastian`
- finish phrase: `that's it`
- sleep phrase: `go to sleep`
- status phrase: `status`, `check status`, and close variants
- approval trigger phrase: `approval code`
- sleep unlock phrase: `wake up now`
- shutdown phrase: `shut down completely`
- sleep lock code: `4321`

Approval codes remain numeric for assistant approvals. Sleep unlock and shutdown use spoken phrases. The sleep lock code still uses the approval-code digit flow to enter sleep from awake. Phrases and the lock code are per-user settings with the values above as defaults. Users can edit them from web settings.

Behavior should match the current voice stack unless a later spec calls out a deliberate change. Do not add a new push-to-talk-first interaction model in the initial product.

## Audio Requirements

Initial baseline:

- 16 kHz
- mono
- signed 16-bit little-endian PCM
- small streaming frames, around 20 ms when live streaming
- local pre-roll before wake when available
- bounded connection-time buffering so speech after wake is not dropped

The service should treat the audio format as part of the protocol and reject unsupported clients clearly.

## Pairing Requirements

Phase one pairing should support:

- a pairing URL or QR payload
- server URL
- per-device pairing token
- minimum client version
- optional display name
- optional device type: `android` or `desktop`

The pairing payload should be versioned from the start.

A pairing payload is the small data bundle encoded in a QR code or link. Instead of asking the user to manually type a server URL, token, and version details, the app scans or opens one payload and configures itself.

Example contents:

- server URL
- WebSocket URLs
- per-device pairing token
- minimum supported app version
- device type
- protocol version

The fields are the individual values inside that QR/link payload. Android and desktop may use the same shared fields, and Electron can add desktop-specific callback fields later if needed.

## Diagnostics

Minimum diagnostics:

- client mode
- selected microphone
- connection state
- last error
- server transcript status
- protocol version
- app version/build number
- optional client log upload

Client log upload should be enabled by default so early Android and desktop issues are easier to debug. Logs must avoid full secrets and should be user-visible in settings later.

No log deletion controls or export flows are needed in v1. Users should be able to view logs and copy relevant text to the clipboard.

Diagnostics must not require Drone Hub.

## Success Criteria For First Usable Version

- Android client can pair with Voice Stream Next service.
- Desktop client can pair with Voice Stream Next service.
- Both clients expose the same mode model.
- Both clients can stream or submit audio.
- Service can transcribe audio and broadcast transcript events.
- Service can send sleep/status/control events back to clients.
- Approval-code flow works on both clients.
- Web dashboard supports login, assistant threads, settings, transcripts, and log viewing.
- Admin users can view connected devices in the lightweight monitor.
- Existing `apps/voice-stream`, Drone Hub desktop voice, and assistant side panel keep working unchanged.
