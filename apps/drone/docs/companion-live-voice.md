# Companion Live voice

Desktop Companion has an optional **Live voice** toggle beside **Auto-approve proposals**, also available in **Settings → Companion** before starting a recording. It defaults off. The Hub remembers it across Companion sessions and restarts using the canonical settings repository (SQLite in the normal Hub runtime).

When off, the existing record → transcribe → Companion flow remains in use. When on, **Start voice** or the Companion microphone shortcut opens a GPT-Live 1 conversation with **client delegation**. Enabling the preference alone never starts the microphone. There is no managed Responses delegation mode.

Configure an **OpenAI API key** in Hub Settings for the voice model. The backend continues to use the provider, model, reasoning level, tools, and instructions selected in **Companion settings**. For example, a Codex-backed Sol agent can remain the backend while the OpenAI API key pays for Live voice separately. Actual Live availability and quota depend on the OpenAI project. If the initial preference load fails, Companion asks you to retry instead of silently choosing the old recording mode.

## Using it

- Live captions show both sides of the conversation. The existing backend reply, tool activity, tool details, and proposal controls remain available. The Live panel also shows currently running tools.
- **Mute mic** disables input while preserving the conversation and spoken output. A **Play voice audio** button appears if the browser blocks playback.
- **End voice** closes audio and discards voice requests that have not yet been submitted. A backend task already submitted continues and can finish in the UI.
- **Stop Companion turn** cancels the backend and also ends voice so a pending voice request cannot restart the cancelled task. **Close Companion** closes both, subject to the existing protection against closing during proposal execution.
- Turning the preference off ends voice. Typed submissions also end voice and use the normal backend path; typing is still rejected while Companion is busy.
- A voice session captures its workspace at startup. Its panel shows that target. Navigation does not redirect tools; start a new voice session to capture a different workspace.

Both Live and record-and-transcribe mode send follow-ups using ASAP steering. The running backend receives the correction without waiting for the entire task to finish and incorporates it at its next processing point. This does not interrupt an active model response or undo a tool action already underway. Requests arriving during startup are buffered until steering is available; requests arriving after the agent loop has finished start a new run. New speech paired with a pending delegation suppresses an older spoken result, but does not undo operations. A repeated notification alone does not hide the answer. Use the explicit stop control for urgent cancellation.

This integration uses the desktop/browser WebRTC path. Mobile Companion retains its record-and-transcribe voice input; its shared backend also uses ASAP steering.

## Implementation

`GET` and `PUT /api/settings/companion/live-voice` read/write `{ enabled: boolean }` under the independent `companion-live-voice` settings key. This avoids overwriting model settings when the toggle changes.

A dedicated connection to the existing authenticated `/api/companion/stream` WebSocket carries `live_start`, `live_ready`, `live_event`, `live_ping`, and `live_close` messages. It owns one OpenAI Live session. `CompanionLiveSocket` fixes the voice model to `gpt-live-1`, client delegation, and `store: false`; it keeps the project API key on the Hub. The browser exchanges SDP through this socket and carries audio directly over WebRTC. The Hub sideband receives transcript/delegation events and returns speakable results. It also requests session closure on browser disconnect or missing heartbeats and waits briefly for finalization. Ending voice releases the microphone immediately while WebRTC and the control channel drain final events. The Hub uses the HTTP hangup endpoint if creation finishes after the browser leaves, attachment fails, or graceful closure times out; it logs unconfirmed final usage when no final event arrives.

`CompanionLiveConversation` accumulates bounded conversation context and holds delegation notifications until transcript text arrives. It deduplicates delegation IDs, coalesces pending notifications into the current accumulated request, and dispatches new requests even while the backend is working. Only the latest dispatched request can supply a spoken result. Results return with the original client delegation ID. Appends stay below 400 UTF-8 bytes each. Answers requiring more than four appends are referred to the UI in full rather than cut off mid-answer; the UI keeps the backend's complete reply. Original audio is not automatically supplied to the backend.

Backend execution uses the existing `CompanionClientController` and Companion WebSocket transport. Browser tools keep their captured workspace bindings, and the runtime reads its normal saved model settings. The voice-session panel reports the backend selected at startup; ASAP follow-ups keep the running agent's model and settings. Saved setting changes apply when the next fresh backend run starts. The active run's tool activity, compaction status, and timer remain visible during steering.

The integration keeps the OpenAI project key on the Hub and does not forward private reasoning or raw tool payloads as voice instructions. The backend's user-facing answer becomes speakable context. Live can paraphrase it and speak independently; its words are not guaranteed to match the exact backend reply.

Protocol references: [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation), [WebRTC setup](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live), [server-side controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live), [HTTP hangup](https://developers.openai.com/api/reference/python/resources/live/subresources/sessions/methods/hangup), and [session lifecycle](https://developers.openai.com/api/docs/guides/live-conversations). See the [primer](gpt-live-1-primer.md) for the architectural and latency comparison.

## Validation

Focused tests cover mode persistence and failed saves, unchanged model settings, the disabled recording path, captured workspaces, delegation arriving before text, duplicate notifications, continued transcripts during backend work, stale spoken results, ending voice during a task, API-key isolation, and microphone/session cleanup. WebRTC and OpenAI events are simulated; these tests do not establish live API access or real audio quality.

Manual checks before release:

1. Start with the toggle off and verify normal recording, transcription, tool calls, and proposals. Enable it, close Companion, reopen, and restart the Hub; confirm the preference survives.
2. With an authorized API key, start Live. Verify audible two-way speech, captions, interruption, mute/unmute, speaker echo handling, and browser autoplay recovery. Check missing credentials, denied mic permission, and unsupported/project-restricted API access.
3. In each voice mode, send a correction while the backend is working and confirm it reaches the running agent before the task finishes. Ask the chosen backend to run a lookup and prepare a proposal while continuing to speak. Verify current tool activity remains visible, exact results render, and manual/automatic proposal execution keeps its existing behavior.
4. Switch UI workspaces during speech. Confirm tools stay bound to the displayed voice target. Change the backend setting and verify a follow-up to the active run keeps its current model, then confirm the next fresh run uses the saved model.
5. End voice during work and verify the task finishes in the UI. Then test Stop Companion turn, Close Companion, toggling off, network loss, tab closure, and cancellation during microphone permission/startup. Confirm the microphone releases and no pending voice request restarts cancelled work.
6. Inspect actual session usage and billing. Compare useful-answer latency against the old flow; voice connection time and backend wait time both contribute to the experience.

Known limits: no mobile Live transport, no automatic voice reconnection, ASAP steering waits for the next agent processing point, and no measured latency improvement yet. An ended voice session starts fresh on reconnect; backend state remains governed by Companion's existing session lifecycle. Audio and API behavior require real-device verification.
