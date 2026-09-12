# Companion Live voice

Desktop Companion has an optional **Live voice** toggle beside **Auto-approve proposals**, also available in **Settings → Companion** before starting a recording. It defaults off. The Hub remembers it across Companion sessions and restarts using the canonical settings repository (SQLite in the normal Hub runtime).

**Settings → Companion → GPT-Live system prompt** edits the conversation instructions supplied as `session.instructions`. This prompt controls voice personality, speaking style, tone, and other conversational behavior. It is saved independently from the delegated backend Companion system prompt. Saving it never changes an active session; end and start Live voice to apply the new value. Restoring the default changes the editor first and requires **Save Live prompt**.

When off, the existing record → transcribe → Companion flow remains in use. When on, **Start voice** or the Companion microphone shortcut opens a GPT-Live 1 conversation with **client delegation**. Enabling the preference alone never starts the microphone. There is no managed Responses delegation mode.

Configure an **OpenAI API key** in Hub Settings for the voice model. The backend continues to use the provider, model, reasoning level, tools, and instructions selected in **Companion settings**. For example, a Codex-backed Sol agent can remain the backend while the OpenAI API key pays for Live voice separately. Actual Live availability and quota depend on the OpenAI project. If the initial preference load fails, Companion asks you to retry instead of silently choosing the old recording mode.

## Using it

Both apps capture microphone audio while Live connects. Once the session is ready,
they send the buffered opening speech in order and continue using the same recorder.
The panel shows **Recording · connecting** after the first audio frame arrives.
Microphone permission, native audio setup, and voice-mode selection still precede
capture; captions require a connected session. Mute is available during connection
and discards unsent speech. End voice, errors, and timeout discard the local buffer.
The in-memory input queue is capped at 40 seconds (1.92 MB of PCM); overflow ends the
session with an error rather than silently losing the beginning of an utterance.


- Live captions show both sides of the conversation. The existing backend reply, tool activity, tool details, and proposal controls remain available. The Live panel also shows currently running tools.
- **Mute mic** disables input while preserving the conversation and spoken output. A **Play voice audio** button appears if the browser blocks playback.
- **End voice** closes audio and discards voice requests that have not yet been submitted. A backend task already submitted continues and can finish in the UI.
- **Stop Companion turn** cancels the backend and also ends voice so a pending voice request cannot restart the cancelled task. **Close Companion** closes both, subject to the existing protection against closing during proposal execution.
- Turning the preference off ends voice. Typed submissions also end voice and use the normal backend path; typing is still rejected while Companion is busy.
- A voice session captures its workspace at startup. Its panel shows that target. Navigation does not redirect tools; start a new voice session to capture a different workspace.

**Settings → Companion → Follow-up delivery** selects **ASAP** (default) or **Queue** for both Live and record-and-transcribe mode. Use the normal **Save** button; the preference persists in Hub settings and applies when a new backend run starts. An active run keeps its delivery setting. Queue runs follow-ups in order after the current request finishes. With ASAP, follow-ups steer the running agent. The running backend receives the correction without waiting for the entire task to finish and incorporates it at its next processing point. This does not interrupt an active model response or undo a tool action already underway. Requests arriving during startup are buffered until steering is available; requests arriving after the agent loop has finished start a new run. New speech paired with a pending delegation suppresses an older spoken result, but does not undo operations. A repeated notification alone does not hide the answer. Use the explicit stop control for urgent cancellation.

## Mobile

Mobile also supports Live with client delegation. **Settings → Built-in → Companion Live voice** contains the toggle; the compact Companion overlay keeps only conversation controls. Select the Hub if more than one is connected. The toggle saves immediately to that Hub and shares the desktop preference. The phone rereads it before starting voice. With Live off, the existing recording and transcription path remains available.

Install an updated native app containing the `DroneLiveVoice` PCM capture/playback
module and update the Hub together. This requires a native build, not Expo Go or a
JavaScript-only update. Android uses voice-communication capture, hardware echo
cancellation/noise suppression when available, continuous PCM playback, and the
existing foreground service. The iOS module uses a voice-processing audio engine.
Expo continues to own recording permissions and the app's audio-mode/routing setup.
An older native installation gets an update-required error instead of a silent
fallback that loses startup speech.

Tap the Companion microphone to connect. The Live panel shows captions and the backend model; normal backend activity, replies, and proposals remain below it. Internal delegation instructions stay hidden from the transcript bubble. While a proposal is being applied, new Live delegations are rejected with a request to ask again after it finishes. Mute preserves playback. End voice stops audio while submitted backend work continues; Stop Companion turn cancels work and ends voice. Live supports background audio and headset media controls on Android and iOS. Android retains its foreground notification, including Pause/Start and End voice actions. Start Live once in the foreground to grant permission and register headset controls. Other recording features cannot take the microphone until Live releases it, including cleanup after a late permission response.

Switching to another Hub ends the session. Changing chat/file context cannot redirect an existing Live request's phone tools: those calls fail with a request to start a new conversation. Start a new voice session after changing workspaces.

Mobile uses device-mesh operations `live.start`, `live.event`, `live.ping`, and `live.close`, plus `live.settings.get`/`live.settings.update` for the mode flag and `live.prompt.get`/`live.prompt.update` for the GPT-Live prompt, with device/session-scoped `live.event` notifications. Live controls and writes require explicit device grants. Existing `run.start` access permits reading only the non-secret mode flag, so old backend permissions continue to work when Live is off without exposing the prompt. Enabling Live without granting its controls produces an actionable error.

The mobile **Companion Live voice** settings card edits the same Hub-owned prompt as desktop. Hubs that predate the prompt operations still expose the mode toggle; mobile asks for a Hub update instead of treating the old response as editable prompt data.

`CompanionLiveMeshSessions` reuses the Hub's `CompanionLiveSocket` entry point, client-only delegation, event validation, and heartbeat expiry. OpenAI credentials stay on the Hub. PCM microphone/speaker audio, delegation, and backend work travel through the paired-device mesh. The Hub relays audio through a primary Live WebSocket; it does not send audio through a WebRTC sideband. The shared `CompanionLiveConversation` and `waitForCompanionReply` live in `@drone/assistant-chat`, so desktop and mobile share result correlation and stale-answer suppression. The selected backend and ASAP/Queue choice still come from normal Companion settings.

## Headset and lock-screen controls (mobile)

Start Live once with the app open. Bluetooth play/pause and the system media controls
then operate that Companion conversation while the phone is locked. Pause closes the
GPT-Live session, stops the microphone and speaker, and discards unsent audio. The
media controls remain registered. Play opens a fresh recording, buffers its opening
speech, and connects a new Live session. It does not reuse the previous voice context.
Backend tasks already submitted continue independently.

A recording cue sounds only after the first captured audio frame; speech is already
buffering when it sounds. A distinct stopped cue plays after capture has stopped.
Cues are generated locally and do not use GPT-Live. Microphone permission and hardware
startup still take time: the recording cue confirms when it is safe to speak. Rapid
presses wait for previous audio cleanup, and End voice cancels pending restarts.

Use **Pause** to keep headset controls available, and **End voice** to release them.
Ending Companion, switching Hubs, native startup failures, and lost workspace access
also disarm controls. An app that takes media ownership can receive subsequent headset
commands instead; the app is not restarted after force-stop or reboot. Android keeps
its foreground service available while paused, but has no microphone capture or active
Live connection. iOS uses Remote Command Center, Now Playing, and the audio background
mode; paused background resumption still needs physical-device verification.

Mute remains separate: it preserves the Live session and its charges. Active Live
session duration includes silence and muted periods, so Pause uses `live.close` /
`session.close`, not mute ([OpenAI cost documentation](https://developers.openai.com/api/docs/guides/voice-latency-cost?api=live)).
The stop cue confirms local capture has stopped, not receipt of final usage from
OpenAI. Closure needs a working connection; existing Hub heartbeat expiry remains the
fallback after a network failure. Already submitted backend work can still incur its
own charges while voice is paused.

Native checks cover Android compilation; hook tests simulate lock-screen commands,
rapid presses, cancellation, cue order, and cleanup. Before release, verify real
Bluetooth Play/Pause on both platforms, lock-screen controls after a long pause,
audio focus changes, incoming calls, headset disconnects, cue routing and volume,
initial-word transcription, and final Live usage. iOS compilation requires Xcode.

## Implementation

`GET` and `PUT /api/settings/companion/live-voice` read and patch the independent `companion-live-voice` settings record. The response contains `enabled`, `systemPrompt`, `defaultSystemPrompt`, and `maxSystemPromptChars`. Writes accept `enabled`, `systemPrompt`, or both and preserve omitted values. Existing records containing only `enabled` receive the default prompt when read. This avoids overwriting either the prompt or backend model settings when the toggle changes.

A dedicated connection to the authenticated `/api/companion/stream` WebSocket
carries `live_start` with `transport: "pcm"`, `live_ready`, `live_event`, `live_ping`,
and `live_close`. Mobile uses the equivalent device-scoped mesh operations. The
client opens its recorder first and buffers audio before starting the network
session. `CompanionPcmLiveSocket` opens `wss://api.openai.com/v1/live/sessions` and
sends `session.start` with `gpt-live-1`, client delegation, `store: false`, and mono
PCM16LE at 24 kHz. Only after `session.started` does it report `live_ready` and accept
validated `session.input_audio.append` events. Each chunk is at most 500 ms; the
clients normally emit roughly 85–100 ms. Audio chunks drain in capture order, with
one input send in flight at a time on mobile, so continuing capture cannot overtake
the startup buffer. Muted frames contain silence to keep Live's audio clock running.

`session.output_audio.delta` drives scheduled PCM playback, independently from
captions and backend work. Local input/output queues and Hub transport queues have
bounds; slow or disconnected sessions fail rather than accumulating indefinitely.
Closing stops local capture/playback immediately, drops unsent audio, and sends
`session.close`; the primary socket is terminated if finalization does not arrive
within five seconds. The project key remains on the Hub and audio is not written
to local recording files by this path.

The legacy SDP/WebRTC path remains available on the Hub for older clients. Its
sideband setup and HTTP hangup fallback remain unchanged. New buffered clients
require the new PCM-aware Hub.

Both PCM and legacy WebRTC sessions use the saved prompt. At session creation it sends the saved GPT-Live prompt verbatim as `session.instructions`, without wrappers or appended instructions. The fully editable default includes personality, backchannel, interruption, delegation, verified-result, follow-up, and cancellation guidance. An explicitly saved empty prompt is sent as an empty string; only an absent setting uses the default. Previously saved prompts are preserved; Restore default loads the complete current default into the editor. Tool permissions and execution checks remain enforced in code. The backend Companion prompt is not copied into `session.instructions`.


`CompanionLiveConversation` accumulates bounded conversation context and holds delegation notifications until transcript text arrives. It deduplicates delegation IDs, coalesces pending notifications into the current accumulated request, and dispatches new requests even while the backend is working. Only the latest dispatched request can supply a spoken result. Results return with the original client delegation ID. Appends stay below 400 UTF-8 bytes each. Answers requiring more than four appends are referred to the UI in full rather than cut off mid-answer; the UI keeps the backend's complete reply. Original audio is not automatically supplied to the backend.

Backend execution uses the existing `CompanionClientController` and Companion WebSocket transport. Browser tools keep their captured workspace bindings, and the runtime reads its normal saved model settings. The voice-session panel reports the backend selected at startup; ASAP follow-ups keep the running agent's model and settings. Saved model and delivery setting changes apply when the next fresh backend run starts. The active run's tool activity, compaction status, and timer remain visible during steering. In Queue mode, activity continues updating for whichever request is running, including intermediate requests while later follow-ups wait. Its timer and activity reset when the next queued run starts; the latest submitted request still owns the visible reply.

The runtime stops accepting ASAP steering as soon as the agent loop ends, before final event listeners and state saving finish, so late follow-ups start a fresh run. Mobile sends spoken-result appends through the mesh in order and discards unsent appends when voice ends.

The integration keeps the OpenAI project key on the Hub and does not forward private reasoning or raw tool payloads as voice instructions. The backend's user-facing answer becomes speakable context. Live can paraphrase it and speak independently; its words are not guaranteed to match the exact backend reply.

Protocol references: [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation), [WebRTC setup](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live), [server-side controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live), [HTTP hangup](https://developers.openai.com/api/reference/python/resources/live/subresources/sessions/methods/hangup), and [session lifecycle](https://developers.openai.com/api/docs/guides/live-conversations). See the [primer](gpt-live-1-primer.md) for the architectural and latency comparison.

## Startup latency

The PCM path eliminates the client's ICE gathering, SDP exchange, and separate
sideband attachment. Microphone setup, Hub/mesh connectivity, and OpenAI session
startup still take time; buffering protects speech captured during the network
portion. No real-device latency improvement has been measured yet.

Live requires microphone audio on its primary transport. The sideband explicitly
rejects audio appends ([server controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live)).
The supported [primary WebSocket audio flow](https://developers.openai.com/api/docs/guides/voice-websockets?api=live)
is used here because the mobile WebRTC library does not expose replay of captured
PCM into its microphone track. This changes the network path: audio now passes
through the Hub and mobile device mesh, so poor Hub connectivity can affect speech
latency and playback. Real-device verification must include initial backlog
handling, echo cancellation, interruption, Bluetooth/headset routing, and network
changes.

## Validation

Focused tests cover mode persistence and failed saves, unchanged model settings, the disabled recording path, captured workspaces, delegation arriving before text, duplicate notifications, continued transcripts during backend work, stale spoken results, ending voice during a task, API-key isolation, and microphone/session cleanup. OpenAI/mesh events are simulated; a Chrome smoke test also exercises actual Web Audio capture and playback using a synthetic microphone. Android native module compilation is checked. iOS compilation requires a macOS/Xcode environment. These checks do not establish live API access or real audio quality.

Prompt tests additionally cover migration from the boolean-only setting, partial writes that preserve the other field, validation, the desktop and mobile settings hooks, separate mobile prompt permissions, and verbatim delivery of custom and empty prompts to new sessions.

Manual checks before release:

1. Start with the toggle off and verify normal recording, transcription, tool calls, and proposals. Enable it, close Companion, reopen, and restart the Hub; confirm the preference survives. Save distinct Live prompts from desktop and mobile and confirm both editors show the same Hub-owned value. Verify an already-open Live session is unchanged and the next session uses the saved style while still delegating backend work.
2. With an authorized API key, start Live. Verify audible two-way speech, captions, interruption, mute/unmute, speaker echo handling, and browser autoplay recovery. Check missing credentials, denied mic permission, and unsupported/project-restricted API access.
3. In each voice mode, send a correction while the backend is working and verify ASAP reaches the running agent before the task finishes, and Queue waits until it finishes. Save a delivery change, start a fresh run, and verify the new setting persists across Companion sessions. Ask the chosen backend to run a lookup and prepare a proposal while continuing to speak. Verify current tool activity remains visible, exact results render, and manual/automatic proposal execution keeps its existing behavior.
4. Switch UI workspaces during speech. Confirm tools stay bound to the displayed voice target. Change the backend setting and verify a follow-up to the active run keeps its current model, then confirm the next fresh run uses the saved model.
5. End voice during work and verify the task finishes in the UI. Then test Stop Companion turn, Close Companion, toggling off, network loss, tab closure, and cancellation during microphone permission/startup. Confirm the microphone releases and no pending voice request restarts cancelled work.
6. On an updated Android app, verify the mobile settings toggle, separate Live grants, microphone permission denial/delayed approval, speaker and Bluetooth routing, echo/interruption, mute, background/screen-lock cleanup, app force-stop, and phone network changes. Verify normal recording can reclaim the microphone after Live ends. Repeat ASAP and Queue checks on mobile.
7. Inspect actual session usage and billing. Compare useful-answer latency against the old flow; voice connection time and backend wait time both contribute to the experience.

Known limits: mobile Live and headset controls require a native app update; no automatic voice reconnection, ASAP steering waits for the next agent processing point, and no measured latency improvement yet. An ended voice session starts fresh on reconnect; backend state remains governed by Companion's existing session lifecycle. Audio and API behavior require real-device verification.

Buffer regression checks: run the `live-audio-buffer`, desktop/mobile
`companion-live-connection`, `companion-pcm-live`, mobile native-audio/lifecycle,
and mesh tests. `bun apps/drone-hub/scripts/smoke-live-pcm.ts` runs the synthetic
Chrome microphone check without contacting OpenAI. Before release, say a distinctive
phrase immediately after **Recording · connecting** appears on each app, throttle
the Hub connection, continue speaking through readiness, and confirm every word
appears once. Repeat with Mute and End voice before readiness, permission denial,
startup failure, and reconnecting into a fresh session.
