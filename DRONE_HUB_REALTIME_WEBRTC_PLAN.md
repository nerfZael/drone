# DroneHub Realtime WebRTC Migration Plan

## Objective

Move DroneHub realtime voice from a backend WebSocket PCM/WAV pipeline to the proper browser WebRTC architecture, while keeping DroneHub tool execution and private application logic on the backend.

Target outcome:

- Browser owns microphone capture and assistant audio playback through WebRTC media tracks.
- DroneHub backend owns OpenAI credentials, session creation, instructions, tool configuration, tool execution, and session lifecycle.
- OpenAI Realtime owns live audio buffering, barge-in behavior, and automatic truncation of unplayed audio for WebRTC sessions.
- The current backend WebSocket implementation remains available as a fallback until WebRTC has been tested enough to remove it.

## Source Guidance

OpenAI documentation used for this plan:

- Realtime WebRTC guide: `https://developers.openai.com/api/docs/guides/realtime-webrtc`
- Realtime server-side controls / sideband guide: `https://developers.openai.com/api/docs/guides/realtime-server-controls`
- Realtime tools guide: `https://developers.openai.com/api/docs/guides/realtime-mcp`
- Realtime interruption and truncation guide: `https://developers.openai.com/api/docs/guides/realtime-conversations#interruption-and-truncation`

Key points from the docs:

- Browser or mobile clients that capture/play audio directly should use WebRTC for more consistent realtime performance.
- The unified WebRTC flow lets the browser send an SDP offer to our backend, and the backend creates the OpenAI Realtime call with a standard server-side API key.
- The OpenAI `/v1/realtime/calls` response includes a `Location` header containing the call ID.
- The backend can use that call ID to open a sideband WebSocket to the same Realtime session.
- The sideband connection is intended for server-side instructions, monitoring, business logic, and tool-call responses.
- Function tools are the right tool type when DroneHub owns private application logic and returns `function_call_output`.
- WebRTC/SIP sessions let the server manage output audio buffering/truncation; WebSocket clients must manage playback and truncation themselves.

## Target Architecture

```text
DroneHub browser
  - RTCPeerConnection
  - mic track to OpenAI
  - remote assistant audio track from OpenAI
  - oai-events data channel available for future client-local events
        |
        | SDP offer
        v
DroneHub backend
  - validates OpenAI API key/settings
  - builds Realtime session config
  - POST /v1/realtime/calls with SDP + session config
  - returns SDP answer to browser
  - extracts call_id from Location header
  - opens sideband WS: wss://api.openai.com/v1/realtime?call_id=...
  - applies/refreshes instructions and tools
  - executes DroneHub function tools
        |
        v
OpenAI Realtime
  - WebRTC media session
  - VAD / interruption
  - assistant audio stream
  - function call events
```

## Session Startup Sequence

1. User turns realtime on and starts desktop voice.
2. Browser creates `RTCPeerConnection`.
3. Browser gets microphone track with `navigator.mediaDevices.getUserMedia({ audio: true })`.
4. Browser attaches local mic track to the peer connection.
5. Browser creates `oai-events` data channel.
6. Browser creates SDP offer and posts it to DroneHub.
7. DroneHub resolves OpenAI settings and assistant realtime tool config.
8. DroneHub sends a multipart request to `https://api.openai.com/v1/realtime/calls` containing:
   - `sdp`: browser offer
   - `session`: Realtime session configuration
9. OpenAI returns SDP answer and a `Location` header with the Realtime `call_id`.
10. DroneHub returns SDP answer to browser immediately.
11. Browser sets the SDP answer as remote description.
12. Browser receives assistant audio as a WebRTC remote audio track.
13. DroneHub opens sideband WebSocket for that `call_id` asynchronously.
14. Backend handles tool calls and session monitoring through sideband.

## Session Configuration

Default Realtime session config should include:

- `type: "realtime"`
- `model: "gpt-realtime-2"` by default, preserving existing model overrides
- Sebastian desktop voice instructions plus assistant realtime tool instructions
- `output_modalities: ["audio"]`
- `audio.input.turn_detection`:
  - `type: "semantic_vad"`
  - `eagerness: "low"`
  - `create_response: true`
  - `interrupt_response: true`
- `audio.input.transcription.delay: "minimal"` for `gpt-realtime-whisper` by default, with env override support for slower/more accurate profiles
- `audio.output.voice` from existing realtime voice override/default
- `tools` from `assistantService.realtimeSessionConfig`
- `tool_choice: "auto"` when tools exist

## Tool Execution

Tool execution remains backend-only.

Backend sideband responsibilities:

- Listen for function-call output items.
- Parse tool call arguments.
- Execute `assistantService.executeRealtimeTool`.
- Preserve/update the realtime thread ID from tool results.
- Send `conversation.item.create` with `function_call_output`.
- Send one `response.create` after all tool outputs for a model turn have been returned.
- Forward useful transcript/status events to the existing desktop voice status/event system.

The browser should not execute DroneHub tools. It may listen to Realtime events over the data channel for local status display, but sideband is the authority for tool handling.

## Thread Transcript Integration

Realtime assistant threads are user-facing `Realtime` threads in the UI and continue to use the existing stored `voiceEnabled` flag for compatibility with older data.

Realtime messages are persisted directly into the assistant thread:

- Transcript/audio/text deltas update a non-persistent streaming chat row immediately.
- Completed user audio transcripts append as normal `user` messages.
- Typed Realtime text sent through the WebRTC data channel appends as normal `user` messages when the sideband receives the Realtime conversation item.
- Completed assistant audio/text transcripts append as normal `assistant` messages.
- Realtime tool calls append the same assistant `toolCall` message plus `toolResult` message shape used by standard assistant runs, so the existing chat renderer shows tool activity without a separate Realtime-only renderer.

Streaming transcript rows are intentionally ephemeral. They make the UI feel live, then disappear when the final transcript is appended to durable thread history. This avoids saving partial transcription guesses while still showing the user and assistant text as early as the Realtime sideband emits deltas.

Streaming rows are role-aware. A user partial transcript and an assistant partial transcript can be visible at the same time, which better represents overlapping speech, barge-in, and assistant responses that begin immediately after user speech ends.

The chat input in a Realtime thread does not submit to the standard assistant queue. It is enabled only when a live Realtime WebRTC data channel is open, and sends `conversation.item.create` plus `response.create` to the current Realtime conversation.

## Browser Responsibilities

WebRTC mode browser responsibilities:

- Own `RTCPeerConnection` lifecycle.
- Own mic permission request and local mic track.
- Own remote audio element.
- Own `oai-events` data channel creation.
- POST SDP offer to DroneHub backend.
- Set SDP answer as remote description.
- Surface connection state to existing desktop voice UI.
- Stop local tracks and close the peer connection on stop/sleep/off.
- Report setup failures clearly and stop the attempted realtime recording instead of repeatedly restarting.

## Backend Responsibilities

Backend responsibilities:

- Provide a WebRTC SDP endpoint for desktop voice realtime.
- Keep standard OpenAI API keys server-side only.
- Set the OpenAI safety identifier from backend, not browser.
- Create sideband sessions and clean them up.
- Guard backend sideband creation against stop/sleep/off races while SDP setup is still in flight.
- Preserve SDP offer/answer bytes exactly; only use trimming for emptiness checks.
- Use a per-start WebRTC browser session id so stale tabs cannot attach to or cancel a newer recording.
- Avoid accepting wake/command recognizer actions while realtime recording is active.
- Continue supporting non-realtime GROQ transcription and WebSocket realtime fallback.

## Implementation Phases

- [x] Document the target architecture and plan.
- [x] Refactor shared Realtime session config helpers in `openai-realtime-assistant.ts`.
- [x] Add backend unified WebRTC call creation helper.
- [x] Add backend sideband session helper for `call_id`.
- [x] Add DroneHub API endpoint for browser SDP offer -> OpenAI SDP answer.
- [x] Add desktop voice service WebRTC lifecycle callbacks/events.
- [x] Add frontend WebRTC controller in `desktop-assistant-voice.ts`.
- [x] Wire realtime mode to prefer WebRTC and keep existing WebSocket path as server-side fallback.
- [x] Add focused unit tests for config, call-ID parsing, and desktop voice WebRTC lifecycle behavior.
- [x] Persist Realtime user/assistant transcript turns and tool call/result rows into the assistant thread.
- [x] Stream Realtime transcript deltas into non-persistent assistant chat rows before final transcript completion.
- [x] Add typed Realtime text sending through the WebRTC data channel.
- [x] Run focused DroneHub backend tests.
- [x] Run DroneHub backend build.
- [x] Run DroneHub frontend typecheck/build.
- [x] Update this plan with final implementation notes and any deviations.

## Validation Checklist

Manual validation after build:

- Realtime toggle still appears near Start Voice.
- Starting realtime voice asks for mic permission in the browser when needed.
- Assistant speaks through WebRTC remote audio, not `desktop_voice_speak_audio` WAV events.
- User can interrupt while assistant is speaking.
- Saying stop/similar no longer causes repeated "I will stop" loops.
- DroneHub tools still work from spoken requests.
- Sleep/off/stop closes mic tracks, peer connection, data channel, and backend sideband.
- Failed WebRTC setup reports a useful error without repeatedly restarting.
- Stopping during browser or backend WebRTC setup cancels the late setup instead of leaving an orphaned peer connection or sideband session.
- Existing non-realtime voice transcription still works.
- Realtime user/assistant turns appear in chat as normal messages.
- Realtime user/assistant transcript deltas appear as streaming chat rows before the final message is persisted.
- Realtime tool calls/results appear in chat using the standard tool UI.
- Typed text in a live Realtime thread goes to the Realtime conversation, not the standard queued prompt path.

## Open Questions / Risks

- Whether the sideband WebSocket should be opened before returning the SDP answer or immediately after. Implemented: return the SDP answer first and open sideband asynchronously. Live testing showed waiting for sideband before returning the answer can deadlock or produce sideband 404s because the browser cannot complete the peer connection.
- Whether both browser data channel and sideband receive the same function-call events. Implemented: sideband handles calls and browser ignores data-channel events for now.
- Whether OpenAI accepts the full tool config in the initial `/v1/realtime/calls` session payload with all current DroneHub tools. Implemented: send the full config in call creation and send the same config again through sideband `session.update`.
- How much status duplication to expose from browser data channel vs backend sideband. Implemented: backend sideband status remains authoritative.
- Automatic fallback after a browser WebRTC setup failure is intentionally not silent. The current implementation stops the attempted realtime recording and reports the WebRTC error, while preserving the old WebSocket implementation as a server-side fallback path when WebRTC is not enabled/available.
- Review fix: multi-tool Realtime turns now send all `function_call_output` items before requesting one follow-up audio response.
- Review fix: browser and backend WebRTC startup paths now use generation guards so stop/sleep/off during setup cannot install a stale session afterward.
- Live-test fix: SDP strings are preserved exactly on browser -> DroneHub -> OpenAI and OpenAI -> DroneHub -> browser. Trimming SDP caused invalid/EOF parser failures.
- Live-test fix: WebRTC startup uses a session id carried over SSE and required on SDP/cancel requests, preventing stale open tabs from cancelling the current recording.
- Live-test fix: CORS allows `x-drone-desktop-voice-webrtc-session-id` for Vite/browser API calls.
- Thread integration fix: Realtime transcripts and tool calls now persist as normal assistant thread messages, and Realtime text input is routed through the WebRTC data channel only while connected.
- Latency fix: Realtime input and assistant transcript deltas now update the visible thread immediately as ephemeral streaming messages; final transcript events still write the durable messages.
- Latency fix: Realtime transcription now defaults `gpt-realtime-whisper` to `delay: "minimal"` so trailing words are less likely to be held until final turn completion. Set `DRONE_HUB_OPENAI_REALTIME_TRANSCRIPTION_DELAY=low|medium|high|xhigh|default` if accuracy/stability needs to win over latency.
- Stop-command fix: final Realtime user transcripts containing `that's it` / `that is it` stop the active WebRTC recording without submitting a prompt. Command-only stop transcripts are not saved as chat messages; if there is useful dictated content before the command, only the cleaned content is persisted.
- Stop-command fix: partial Realtime transcript deltas now use the same command stripping policy as final transcripts, so command-only `that's it` deltas clear the streaming row instead of briefly appearing as chat text.
- Transcript cleanup fix: command stripping now removes dangling punctuation before stop/abort commands, so `list my drones, that's it` persists as `list my drones`.
- Review fix: WebRTC transcript, assistant, and tool callbacks are guarded by the per-session generation so late sideband events after stop/off/new-session do not mutate the thread.
- Thread integration fix: Realtime streaming state is role-aware and exposes `streamingMessages` while keeping the legacy `streamingMessage` field for compatibility.
- Recovery fix: pending WebRTC browser session ids are included in desktop voice status, and the browser starts WebRTC from status as well as from the one-shot SSE event. This prevents a missed `desktop_voice_webrtc_start` event from leaving the backend in recording mode without an OpenAI WebRTC call.
- UX fix: the assistant sidebar now has a direct "start recording now" control in addition to the wake phrase. The wake phrase path remains unchanged, but users can enter assistant recording manually from off, sleeping, or awake states.

## Current Status

Implementation complete for DroneHub. Backend WebRTC call creation, sideband tool handling, desktop voice lifecycle events, browser WebRTC setup, Realtime thread transcript persistence, role-aware streaming transcript delta display, typed Realtime data-channel messages, stop-command filtering, stale callback guards, and focused tests are in place. VoiceStreamNext is intentionally not migrated yet.

Verification completed:

- `bun test apps/drone/tests/openai-realtime-assistant.test.ts apps/drone/tests/desktop-voice-service.test.ts`
- `bun test apps/drone/tests/assistant-thread-isolation.test.ts apps/drone/tests/openai-realtime-assistant.test.ts`
- `bun run build` in `apps/drone`
- `bun run typecheck` in `apps/drone-hub`
- `bun run build` in `apps/drone-hub`
- `git diff --check`

Additional live validation completed with synthetic Groq wake audio:

- Generated `Hey Sebastian.` WAV/raw audio and used it as a deterministic desktop voice capture source.
- Verified Vosk wake recognition triggers WebRTC recording.
- Verified browser receives `desktop_voice_webrtc_start`, gets mic, creates an SDP offer, posts it with the matching session id, and reaches `webrtc-connected`.
- Verified OpenAI `/v1/realtime/calls` returns a call id using the unified multipart flow with exact SDP preservation.
- Verified stale/no-session-id browser requests can no longer cancel the active recording.
