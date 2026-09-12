# Companion Live voice

Desktop Companion has an optional **Live voice** toggle beside **Auto-approve proposals**, also available in **Settings → Companion** before starting a recording. It defaults off. The Hub remembers it across Companion sessions and restarts using the canonical settings repository (SQLite in the normal Hub runtime).

**Settings → Companion → GPT-Live system prompt** edits the conversation instructions supplied as `session.instructions`. This prompt controls voice personality, speaking style, tone, and other conversational behavior. It is saved independently from the delegated backend Companion system prompt. Saving it never changes an active session; end and start Live voice to apply the new value. Restoring the default changes the editor first and requires **Save Live prompt**.

When off, the existing record → transcribe → Companion flow remains in use. When on, **Start voice** or the Companion microphone shortcut opens a GPT-Live 1 conversation with **client delegation**. Enabling the preference alone never starts the microphone. There is no managed Responses delegation mode.

Configure an **OpenAI API key** in Hub Settings for the voice model. The backend continues to use the provider, model, reasoning level, tools, and instructions selected in **Companion settings**. For example, a Codex-backed Sol agent can remain the backend while the OpenAI API key pays for Live voice separately. Actual Live availability and quota depend on the OpenAI project. If the initial preference load fails, Companion asks you to retry instead of silently choosing the old recording mode.

## Using it

- Live captions show both sides of the conversation. The existing backend reply, tool activity, tool details, and proposal controls remain available. The Live panel also shows currently running tools.
- **Mute mic** disables input while preserving the conversation and spoken output. A **Play voice audio** button appears if the browser blocks playback.
- **End voice** closes audio and discards voice requests that have not yet been submitted. A backend task already submitted continues and can finish in the UI.
- **Stop Companion turn** cancels the backend and also ends voice so a pending voice request cannot restart the cancelled task. **Close Companion** closes both, subject to the existing protection against closing during proposal execution.
- Turning the preference off ends voice. Typed submissions also end voice and use the normal backend path; typing is still rejected while Companion is busy.
- A voice session captures its workspace at startup. Its panel shows that target. Navigation does not redirect tools; start a new voice session to capture a different workspace.

**Settings → Companion → Follow-up delivery** selects **ASAP** (default) or **Queue** for both Live and record-and-transcribe mode. Use the normal **Save** button; the preference persists in Hub settings and applies when a new backend run starts. An active run keeps its delivery setting. Queue runs follow-ups in order after the current request finishes. With ASAP, follow-ups steer the running agent. The running backend receives the correction without waiting for the entire task to finish and incorporates it at its next processing point. This does not interrupt an active model response or undo a tool action already underway. Requests arriving during startup are buffered until steering is available; requests arriving after the agent loop has finished start a new run. New speech paired with a pending delegation suppresses an older spoken result, but does not undo operations. A repeated notification alone does not hide the answer. Use the explicit stop control for urgent cancellation.

## Mobile

Mobile also supports Live with client delegation. **Settings → Built-in → Companion Live voice** contains the toggle; the compact Companion overlay keeps only conversation controls. Select the Hub if more than one is connected. The toggle saves immediately to that Hub and shares the desktop preference. The phone rereads it before starting voice. With Live off, the existing recording and transcription path remains available.

Install an updated native app containing `react-native-webrtc`; this is not an Expo Go or JavaScript-only update. The checked-in Android project autolinks the module and includes microphone/audio routing permissions and WebRTC ProGuard rules. Native audio setup uses Expo audio permissions and speaker routing. [React Native WebRTC installation](https://github.com/react-native-webrtc/react-native-webrtc), [Android requirements](https://github.com/react-native-webrtc/react-native-webrtc/blob/master/Documentation/AndroidInstallation.md).

Tap the Companion microphone to connect. The Live panel shows captions and the backend model; normal backend activity, replies, and proposals remain below it. Internal delegation instructions stay hidden from the transcript bubble. While a proposal is being applied, new Live delegations are rejected with a request to ask again after it finishes. Mute preserves playback. End voice stops audio while submitted backend work continues; Stop Companion turn cancels work and ends voice. Backgrounding the app or locking the screen ends voice. Reopen and tap the microphone to start a fresh voice session. Other recording features cannot take the microphone until Live releases it, including cleanup after a late permission response.

Switching to another Hub ends the session. Changing chat/file context cannot redirect an existing Live request's phone tools: those calls fail with a request to start a new conversation. Start a new voice session after changing workspaces.

Mobile uses device-mesh operations `live.start`, `live.event`, `live.ping`, and `live.close`, plus `live.settings.get`/`live.settings.update` for the mode flag and `live.prompt.get`/`live.prompt.update` for the GPT-Live prompt, with device/session-scoped `live.event` notifications. Live controls and writes require explicit device grants. Existing `run.start` access permits reading only the non-secret mode flag, so old backend permissions continue to work when Live is off without exposing the prompt. Enabling Live without granting its controls produces an actionable error.

The mobile **Companion Live voice** settings card edits the same Hub-owned prompt as desktop. Hubs that predate the prompt operations still expose the mode toggle; mobile asks for a Hub update instead of treating the old response as editable prompt data.

`CompanionLiveMeshSessions` reuses the Hub's `CompanionLiveSocket` session creation, client-only delegation, event validation, heartbeat expiry, and HTTP hangup fallback. OpenAI credentials stay on the Hub. Native microphone/speaker audio travels directly to OpenAI over WebRTC; delegation and backend work travel through the paired-device mesh. The shared `CompanionLiveConversation` and `waitForCompanionReply` live in `@drone/assistant-chat`, so desktop and mobile share result correlation and stale-answer suppression. The selected backend and ASAP/Queue choice still come from normal Companion settings.

## Implementation

`GET` and `PUT /api/settings/companion/live-voice` read and patch the independent `companion-live-voice` settings record. The response contains `enabled`, `systemPrompt`, `defaultSystemPrompt`, and `maxSystemPromptChars`. Writes accept `enabled`, `systemPrompt`, or both and preserve omitted values. Existing records containing only `enabled` receive the default prompt when read. This avoids overwriting either the prompt or backend model settings when the toggle changes.

A dedicated connection to the existing authenticated `/api/companion/stream` WebSocket carries `live_start`, `live_ready`, `live_event`, `live_ping`, and `live_close` messages. It owns one OpenAI Live session. `CompanionLiveSocket` fixes the voice model to `gpt-live-1`, client delegation, and `store: false`; it keeps the project API key on the Hub. At session creation it sends the saved GPT-Live prompt verbatim as `session.instructions`, without wrappers or appended instructions. The fully editable default includes personality, backchannel, interruption, delegation, verified-result, follow-up, and cancellation guidance. An explicitly saved empty prompt is sent as an empty string; only an absent setting uses the default. Previously saved prompts are preserved; Restore default loads the complete current default into the editor. Tool permissions and execution checks remain enforced in code. The backend Companion prompt is not copied into `session.instructions`. The browser exchanges SDP through this socket and carries audio directly over WebRTC. The Hub sideband receives transcript/delegation events and returns speakable results. It also requests session closure on browser disconnect or missing heartbeats and waits briefly for finalization. Ending voice releases the microphone immediately while WebRTC and the control channel drain final events. The Hub uses the HTTP hangup endpoint if creation finishes after the browser leaves, attachment fails, or graceful closure times out; it logs unconfirmed final usage when no final event arrives.

`CompanionLiveConversation` accumulates bounded conversation context and holds delegation notifications until transcript text arrives. It deduplicates delegation IDs, coalesces pending notifications into the current accumulated request, and dispatches new requests even while the backend is working. Only the latest dispatched request can supply a spoken result. Results return with the original client delegation ID. Appends stay below 400 UTF-8 bytes each. Answers requiring more than four appends are referred to the UI in full rather than cut off mid-answer; the UI keeps the backend's complete reply. Original audio is not automatically supplied to the backend.

Backend execution uses the existing `CompanionClientController` and Companion WebSocket transport. Browser tools keep their captured workspace bindings, and the runtime reads its normal saved model settings. The voice-session panel reports the backend selected at startup; ASAP follow-ups keep the running agent's model and settings. Saved model and delivery setting changes apply when the next fresh backend run starts. The active run's tool activity, compaction status, and timer remain visible during steering. In Queue mode, activity continues updating for whichever request is running, including intermediate requests while later follow-ups wait. Its timer and activity reset when the next queued run starts; the latest submitted request still owns the visible reply.

The runtime stops accepting ASAP steering as soon as the agent loop ends, before final event listeners and state saving finish, so late follow-ups start a fresh run. Mobile sends spoken-result appends through the mesh in order and discards unsent appends when voice ends.

The integration keeps the OpenAI project key on the Hub and does not forward private reasoning or raw tool payloads as voice instructions. The backend's user-facing answer becomes speakable context. Live can paraphrase it and speak independently; its words are not guaranteed to match the exact backend reply.

Protocol references: [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation), [WebRTC setup](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live), [server-side controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live), [HTTP hangup](https://developers.openai.com/api/reference/python/resources/live/subresources/sessions/methods/hangup), and [session lifecycle](https://developers.openai.com/api/docs/guides/live-conversations). See the [primer](gpt-live-1-primer.md) for the architectural and latency comparison.

## Startup latency

Desktop opens the Hub WebSocket while gathering ICE candidates. After OpenAI creates a
session, the Hub sends `live_answer` immediately so both desktop and mobile can apply
the SDP and negotiate media while the sideband attaches. The existing `live_ready`
message still follows sideband attachment. Clients enable microphone delivery only
after both control readiness and `session.started`, preserving transcript/delegation
observation from the start. Older clients ignore `live_answer` and continue to use
`live_ready`; new clients also accept Hubs that only send `live_ready`.

These changes overlap network steps; they do not establish a measured reduction on
real devices. Microphone permission/setup, ICE, OpenAI session creation, and media
negotiation still contribute to startup time. Startup microphone buffering has not
been implemented. The current tracks remain disabled until the session is ready.

Live WebRTC audio must use the negotiated media track. The sideband explicitly does
not accept `session.input_audio.append` ([official transport guidance](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live)).
Preserving opening speech therefore needs a capture/replay pipeline in the browser
and native mobile audio layer, or a change to the primary WebSocket audio transport.
Replay must preserve the order of ongoing speech; sending current microphone audio
alongside the backlog would overlap or duplicate it. Capturing early does not make
recognition available before connection, and device permission still gates capture.

## Validation

Focused tests cover mode persistence and failed saves, unchanged model settings, the disabled recording path, captured workspaces, delegation arriving before text, duplicate notifications, continued transcripts during backend work, stale spoken results, ending voice during a task, API-key isolation, and microphone/session cleanup. WebRTC and OpenAI events are simulated; these tests do not establish live API access or real audio quality.

Prompt tests additionally cover migration from the boolean-only setting, partial writes that preserve the other field, validation, the desktop and mobile settings hooks, separate mobile prompt permissions, and verbatim delivery of custom and empty prompts to new sessions.

Manual checks before release:

1. Start with the toggle off and verify normal recording, transcription, tool calls, and proposals. Enable it, close Companion, reopen, and restart the Hub; confirm the preference survives. Save distinct Live prompts from desktop and mobile and confirm both editors show the same Hub-owned value. Verify an already-open Live session is unchanged and the next session uses the saved style while still delegating backend work.
2. With an authorized API key, start Live. Verify audible two-way speech, captions, interruption, mute/unmute, speaker echo handling, and browser autoplay recovery. Check missing credentials, denied mic permission, and unsupported/project-restricted API access.
3. In each voice mode, send a correction while the backend is working and verify ASAP reaches the running agent before the task finishes, and Queue waits until it finishes. Save a delivery change, start a fresh run, and verify the new setting persists across Companion sessions. Ask the chosen backend to run a lookup and prepare a proposal while continuing to speak. Verify current tool activity remains visible, exact results render, and manual/automatic proposal execution keeps its existing behavior.
4. Switch UI workspaces during speech. Confirm tools stay bound to the displayed voice target. Change the backend setting and verify a follow-up to the active run keeps its current model, then confirm the next fresh run uses the saved model.
5. End voice during work and verify the task finishes in the UI. Then test Stop Companion turn, Close Companion, toggling off, network loss, tab closure, and cancellation during microphone permission/startup. Confirm the microphone releases and no pending voice request restarts cancelled work.
6. On an updated Android app, verify the mobile settings toggle, separate Live grants, microphone permission denial/delayed approval, speaker and Bluetooth routing, echo/interruption, mute, background/screen-lock cleanup, app force-stop, and phone network changes. Verify normal recording can reclaim the microphone after Live ends. Repeat ASAP and Queue checks on mobile.
7. Inspect actual session usage and billing. Compare useful-answer latency against the old flow; voice connection time and backend wait time both contribute to the experience.

Known limits: mobile Live ends in the background and requires a native app update; no automatic voice reconnection, ASAP steering waits for the next agent processing point, and no measured latency improvement yet. An ended voice session starts fresh on reconnect; backend state remains governed by Companion's existing session lifecycle. Audio and API behavior require real-device verification.
