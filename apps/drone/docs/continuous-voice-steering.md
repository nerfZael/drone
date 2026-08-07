# Continuous voice steering

Status: implemented for desktop and mobile, including screen-lock capture and interruption recovery; physical-device validation pending

Last updated: 2026-08-07

## Goal

Drone Hub desktop and mobile provide a second microphone mode that keeps listening across multiple messages. When the user finishes a thought, Drone Hub transcribes that thought and delivers it to the chat without stopping audio capture.

This mode is specific to Drone Hub. The existing single-shot microphone remains available and retains its current record, pause, stop, cancel, and insert/send behavior.

## Product decisions

- Continuous voice is an explicit toggle beside the existing microphone button.
- Capture, endpoint detection, transcription, and delivery are independent stages. Capture never waits for network work.
- A segment is sent with `deliveryMode: "asap"` when the target supports send-while-running. Otherwise it is queued.
- A continuous session is pinned to the chat where it started. Speech must never silently move to another chat.
- Voice messages are independent of the typed composer draft and its attachments.
- Cancel discards only work that has not already been accepted by the Hub. It cannot retract a delivered steering message.
- Raw audio is held only as long as needed for segmentation and transcription and is not retained by Drone Hub afterward.
- Desktop and mobile use the same endpoint policy and sequencing semantics even when their capture implementations differ.

## Default endpoint policy

The end of speech and the end of a thought are related but distinct signals. The first implementation combines a shared adaptive acoustic endpointer with a deliberately patient silence timer. It continuously estimates the non-speech noise floor and applies separate activation/release thresholds to avoid flicker. A model-backed VAD such as Silero remains a compatible future replacement if field measurements show that acoustic endpoint quality is insufficient.

- Audio format: mono, 16 kHz, signed PCM16.
- Analysis frame: approximately 20-32 ms.
- Pre-roll: 300 ms.
- Trailing audio: 400 ms.
- Minimum speech: 300 ms.
- End-thought silence: 2,500 ms by default.
- Hard thought checkpoint: 60 seconds.
- Empty, silent, and very short segments are never submitted.
- Speech resuming during the silence timer cancels the pending endpoint.

User-facing endpoint presets are:

| Preset | End-thought silence |
| --- | ---: |
| Quick | 1,500 ms |
| Balanced (default) | 2,500 ms |
| Patient | 4,000 ms |
| Custom | 1,000-10,000 ms |

Noise handling is presented as `Auto`, `Quiet room`, or `Noisy environment`, rather than as a raw microphone-volume threshold. The implementation may expose advanced VAD controls later, but absolute volume is not a reliable cross-device signal.

## Pipeline

```text
microphone
  -> continuous PCM capture
  -> voice activity and endpoint policy
  -> immutable session/sequence segment
  -> bounded segment queue
  -> serial transcription and ordered delivery
  -> ASAP steering or queued fallback
```

Every segment has a stable session ID, sequence number, and delivery ID. Capture continues while the queue is transcribed and delivered in strict sequence. A manual Resume after a transient failure retries the head segment with the same delivery ID. Backlogs are bounded; the UI pauses and reports a problem rather than consuming memory indefinitely.

## Codex ASAP delivery

Codex chats use the Codex App Server instead of launching a separate `codex exec` process for every message. The drone daemon owns one persistent App Server connection and Codex thread per stable Drone Hub chat.

- A normal message starts a new turn with `turn/start`.
- An ASAP message sent during an active turn uses `turn/steer` with the current thread ID and expected turn ID.
- Multiple ASAP messages are offered to the active turn individually and in queue order. They are not collapsed into one prompt and do not wait for an arbitrary tool boundary in Drone Hub.
- If Codex rejects same-turn steering because the turn ended or is in a non-steerable operation, the durable message remains queued and starts the next turn. It is never silently dropped.
- Each request uses the Drone Hub prompt ID as Codex's `clientUserMessageId`, preserving idempotent delivery across Hub retries.
- The daemon continues consuming events and servicing steering requests while Codex reasons, runs tools, or streams output.
- Stop maps to `turn/interrupt`. A daemon restart fails the interrupted durable jobs explicitly so Hub recovery can retry safely instead of assuming the old in-memory App Server still exists.
- Idle App Server processes are retired after 15 minutes. The next prompt resumes the durable Codex thread in a fresh process, preventing one permanent child process per chat.

A steered Codex turn can contain several user messages but only one final assistant response. Drone Hub therefore records the initial and intermediate accepted inputs as user-only transcript entries, then associates the final response with the last accepted input. Desktop, remote desktop, and mobile render those entries without fabricated empty assistant bubbles.

This App Server transport is currently Codex-only. Other built-in agents retain their existing delivery behavior until their native steering contracts are implemented and verified separately.

The current Groq transcription endpoint remains the initial provider. It should accept the preferred language and recent confirmed text as optional transcription context. `whisper-large-v3-turbo` is the default, with `whisper-large-v3` as the accuracy-oriented option.

## Platform implementation

### Desktop

Desktop captures PCM continuously using Web Audio. The current implementation uses a smaller-buffer `ScriptProcessorNode` to share the proven recorder conversion path while leaving capture open across requests. Moving capture to `AudioWorklet` remains a performance hardening task; it does not change the segmenter or delivery contracts.

Browser-provided echo cancellation, noise suppression, and automatic gain control are requested where supported. Hub speech playback must not trivially feed back into voice steering.

### Mobile

Mobile continuous mode consumes real-time PCM16 buffers from Expo AudioStream. The existing file-based Expo AudioRecorder remains the single-shot recorder.

Continuous capture remains active when the app is backgrounded or the screen is locked. While a session is active, mobile also keeps its paired-device mesh transport connected so transcription results can reach a remote Drone Hub before unlock; the ordinary background-suspension policy resumes when the session finishes. On Android, the real-time PCM stream is registered with a microphone foreground service and displays the required persistent recording notification. On iOS, the app declares the audio background mode and the real-time stream keeps its recording audio session active.

Calls, media-service resets, and temporary input-route loss create an explicit interruption boundary. Any valid speech captured before the interruption is finalized, and transcription and delivery continue independently. Android keeps its foreground capture registered, observes the operating system's client-silenced signal, and resumes when the system restores input. iOS rebuilds its audio engine with bounded exponential retry until the microphone is available again. The UI reports `reconnecting` instead of claiming that it is listening during the gap. A user stop from Android's foreground-service notification is treated as a real stop and is not automatically undone.

## Settings

The new Voice input settings are separate from the existing speech-output/TTS settings.

Required settings:

- End-thought preset and custom duration.
- Noise handling preset.
- Preferred transcription language (`Auto` by default).
- Transcription quality (`Fast` by default, or `Accurate`).
- Desktop currently follows the browser/operating-system default input. An explicit input-device selector can be added without changing the capture contract.
- Mobile screen-lock listening is always part of continuous mode; it is not a separate toggle that can accidentally leave the UI claiming support while native capture is disabled.
- Optional send confirmation sound/haptic.

Hardware-dependent preferences are device-local. Defaults and portable semantic preferences may be represented in Hub settings where desktop needs them; mobile stores its own effective settings locally.

## State and UI

The continuous control and status surface distinguish:

- starting
- listening
- speech detected
- waiting for end-of-thought silence
- listening/transcribing, including backlog count
- paused
- microphone interrupted/reconnecting
- stopping/flushing
- recoverable error

Stopping flushes the current valid speech segment, waits for accepted queued work, then closes the microphone. Cancel closes the microphone and discards unsent work. Authentication and network failures pause submission and remain visible; Resume retries the retained head segment without producing a duplicate message.

## Safety and edge cases

The implementation and tests cover:

- Initial or indefinite silence without transcription requests.
- Coughs, clicks, typing, and short noises.
- Fans and steady ambient noise.
- Music, television, other speakers, and Hub audio playback.
- Long pauses inside unfinished thoughts.
- Speech resuming during the endpoint countdown.
- Speech continuing while prior segments transcribe and send.
- Forced checkpoints for uninterrupted monologues.
- Out-of-order transcription completion and send retries.
- Empty or hallucinated near-silence transcripts.
- Offline state, API authentication, rate limits, and bounded backlog.
- Permission revocation, microphone disconnection, Bluetooth route changes, calls, sleep, backgrounding, and app termination.
- Chat switches, deleted/offline drones, completed agents, and approval waits.
- Concurrent typed drafts and attachments.
- Only one continuous microphone owner per app instance.
- Accessible labels, toggle state, and non-color status feedback.

The primary quality metric is false sends per listening hour. Supporting metrics are missed thoughts, premature endpoint rate, endpoint-to-Hub latency, duplicate/lost deliveries, queue depth, transcription accuracy, CPU, and battery use.

## Verification and rollout

1. Unit-test the deterministic endpoint state machine with synthetic PCM/activity timelines.
2. Test delayed, failed, retried, and out-of-order transcription and delivery.
3. Exercise a golden audio set covering quiet rooms, fans, cafés, keyboards, soft speech, accents, long pauses, incomplete sentences, and speaker echo.
4. Roll out desktop internally, initially with an optional observe-only mode if endpoint quality needs tuning.
5. Roll out mobile foreground capture.
6. Validate mobile background, screen-lock, phone-call, and audio-route recovery behavior on physical devices before release sign-off.
7. Evaluate semantic endpointing only if measured acoustic endpoint quality is insufficient.

## Implementation record

This section is updated as the implementation lands.

- 2026-08-07: Investigation completed and initial architecture recorded. No runtime changes had been made before this document was created.
- 2026-08-07: Added the shared `ContinuousVoiceSegmenter`, PCM normalization, WAV encoding, adaptive noise profiles, deterministic sample-driven timing, pre-roll/trailing trim, minimum speech filtering, and 60-second checkpoints.
- 2026-08-07: Added canonical desktop Voice input settings for endpoint preset/custom duration, noise handling, language, Fast/Accurate Groq model selection, and confirmation feedback. Mobile stores the same effective settings locally because they are device-specific.
- 2026-08-07: Added uninterrupted desktop Web Audio capture and mobile Expo AudioStream capture. Both feed bounded transcription queues while the microphone continues recording.
- 2026-08-07: Added separate continuous-voice controls and state feedback to both composers. The ordinary one-shot microphone remains unchanged. Mobile continuous mode is intentionally unavailable in the new-drone composer because there is no stable chat target yet.
- 2026-08-07: Continuous transcripts are independent messages and do not consume or alter the typed draft or attachments.
- 2026-08-07: Every segment uses a safe session/sequence prompt ID. The ID is propagated through desktop native/external routes and the mobile device mesh so Hub retries are idempotent. Delivery uses ASAP when the surface supports send-while-running and queue otherwise.
- 2026-08-07: Sessions retain their original send callback and stop/flush when the selected chat changes, preventing audio from being redirected to the newly selected chat.
- 2026-08-07: Authentication/network/backlog failures pause the session with retained bounded work. Resume retries the same prompt ID. Cancel aborts transcription and discards only unsent local work.
- 2026-08-07: Added unit coverage for silence, short noise, steady ambient noise, resumed speech, endpoint trimming, forced checkpoints, flush semantics, resampling/WAV output, settings validation, Groq context/model selection, and mobile mesh delivery metadata.
- 2026-08-07: Enabled continuous mobile capture through screen lock/background operation. Patched Expo AudioStream so Android real-time PCM capture participates in the microphone foreground service and iOS real-time capture rebuilds its audio engine after calls, route changes, and media-service resets. Added an explicit reconnecting state, interruption-boundary flushing, Android notification permission handling, and foreground-notification stop handling.
- 2026-08-07: Detailed review fixed cancellation/startup races on both clients, abortable desktop uploads, mobile recovery error handling, stale iOS recording-session cleanup, and stable prompt-ID propagation through local, remote, group, Built-in, and mobile delivery paths. Built-in prompt retries now recognize an already accepted durable row before queue limits or ASAP claiming, and retry UI rows are deduplicated.
- 2026-08-07: Lock-screen review added a scoped mobile mesh hold so remote-chat delivery remains available in the background without changing normal battery-saving suspension. Stop-time delivery failures now retain their final segment and Resume completes shutdown instead of reopening a capture session without an endpointer.
- 2026-08-07: Added the desktop transcription metadata headers to the Hub CORS allowlist so Vite/Electron development origins can complete browser preflight requests.
- 2026-08-07: Replaced per-message Codex CLI jobs with a daemon-managed persistent Codex App Server connection. Normal prompts use `turn/start`; every accepted ASAP prompt uses ordered same-turn `turn/steer` with thread/turn preconditions and stable client message IDs. Added queued fallback for steering races, `turn/interrupt` stop behavior, daemon-restart recovery, App Server event translation, image inputs, and user-only transcript entries across desktop and mobile. Native/other built-in agents remain unchanged in this Codex-first phase.
- 2026-08-07: Review hardened Codex live-output ownership, start-time cancellation, plan-event translation, failed-turn thread persistence, callback error handling, and idle App Server retirement. Android notification permission is now optional: the app still asks so controls can appear in the notification drawer, but denial no longer disables foreground-service microphone capture.

## Known validation and follow-up work

- Validate Expo AudioStream buffer cadence, transcription continuity, notification controls, Bluetooth/wired route changes, calls, screen lock, and extended background battery behavior on physical Android and iOS devices. The implementation is enabled, but hardware release sign-off remains pending because simulators cannot prove operating-system microphone behavior.
- Exercise desktop echo cancellation against actual Drone Hub speech playback and move capture to AudioWorklet if profiling shows main-thread audio gaps.
- Build an opt-in audio corpus and measure false sends per listening hour before tuning defaults. The deterministic endpointer can be replaced by Silero or semantic VAD behind the same interface if measured results justify the extra model/runtime dependency.
- Add an explicit desktop input-device selector if users need to override the operating-system default.
- Extend true live steering to non-Codex agents only after their runtime-specific steering, cancellation, and transcript contracts are defined; do not assume Codex App Server semantics apply to them.
