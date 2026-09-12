# Companion headset stop/resume and speaker fallback

Worktree: `/tmp/drone-companion-headset-toggle`
Branch: `fix/companion-headset-toggle`
Base: `eddae4bd`

## Confirmed device evidence

Read-only Android `dumpsys audio` and `dumpsys media_session` diagnostics from the connected Samsung phone showed the following on September 12 (device-local timestamps):

- At 19:32:30, Drone started a VOICE_COMMUNICATION recorder and AudioTrack, then routed playback to Bluetooth SCO.
- At 19:32:34.034, Android reported the headset SCO audio connection disconnected (state 10).
- At 19:32:34.920, the same Drone AudioTrack changed from the Bluetooth output to the built-in phone output. It remained active until 19:33:10.983.
- The media-session log contained no pause event at that route-loss time. It subsequently recorded a Bluetooth MEDIA_PLAY event at 19:33:03.712.

This confirms the reported fallback while Live kept running. It is consistent with a headset button hanging up its call-audio connection instead of sending a media pause; the logs alone do not prove the physical button caused that disconnection. Raw device diagnostics were kept outside the repository.

Android documents route-change callbacks in [AudioRouting](https://developer.android.com/reference/android/media/AudioRouting), and distinguishes SCO connection states in [BluetoothHeadset](https://developer.android.com/reference/android/bluetooth/BluetoothHeadset).

## Changes

- An active Live AudioTrack observes its actual output route. After a headset has been used, switching to the phone speaker or earpiece pauses Live, stops native capture/playback, and retains headset controls. Initial phone routing during Bluetooth setup and intermediate null routes are ignored; listeners are removed during cleanup.
- Route-loss pauses omit the stopped cue, since its remaining route would be the phone speaker.
- The Companion recording toggle and visible stop button use the resumable pause path. They stop the microphone and Live connection while keeping the Companion open and submitted backend work running.
- Headset MEDIA_STOP follows the same path as MEDIA_PAUSE. MEDIA_PLAY resumes the existing Companion's target after previous audio cleanup, including when the screen is locked.
- Explicit control release, Companion close, and foreground-service termination still disarm controls. Service termination uses a separate `end` event so it cannot be mistaken for a resumable headset stop.

A Live session must first be started in the foreground to obtain permissions and arm background controls. This change does not start an unarmed microphone from the lock screen or restart after the app is killed.

## Validation

- 25 targeted TypeScript tests passed across the Companion context, Live lifecycle, and native-control bridge suites.
- Mobile TypeScript check passed.
- Native JVM regression reproducing Bluetooth-to-speaker routing passed, along with existing PCM playback tests.
- `:live-voice:compileDebugKotlin --offline` passed against the actual Android dependencies.

The first fix was merged in `93bcf52d` and deployed to the connected Samsung phone at 21:21:47. The following findings are from the user testing that installed build.


## Follow-up: brief speaker playback and delayed resume cue

Device diagnostics at 21:23–21:24 confirm the remaining timing problem:

- SCO disconnected at 21:23:59.166; Drone's track reported the phone output at 21:23:59.959 and stopped at 21:23:59.990. Waiting for the track route change left roughly 800 ms before the app reacted. The user reported hearing a brief fragment on the phone.
- On resume at 21:24:09.215 the recorder and track started on the phone. SCO connected at 21:24:09.354; the track reached Bluetooth at 21:24:09.933. The recording cue previously ran immediately after capture started, during this transition.
- The Bluetooth MEDIA_PLAY commands recorded at 21:24:08.938 and 21:24:26.691 both led to a new recorder. These logs do not establish what happened to the reported extra physical press: there is no corresponding ignored play event in the available history.

The follow-up listens for SCO state and communication-device changes, with the original AudioTrack listener retained as a fallback. Android documents the asynchronous connection and its notifications in [AudioManager](https://developer.android.com/reference/android/media/AudioManager#ACTION_SCO_AUDIO_STATE_UPDATED). Native stop mutes, pauses and flushes output before blocking microphone cleanup. Paused media state is published before cleanup; a late JS recording update cannot overwrite it and make the next play look redundant.

When a headset is connected, PCM starts silently and holds speech plus the recording cue until the track actually reports a headset route. Capture sends silence during that transition. Cancellation resolves pending cue requests without playing; a five-second route timeout reports an error while output remains silent. Phone-only Live continues to start immediately.

Follow-up validation: the Android Kotlin build and mobile typecheck passed; all 25 existing targeted TypeScript tests passed. Native JVM regressions exercise early SCO/BLE stop before any AudioTrack speaker callback, one-press resume, stale recording state, repeated/up key events, route-gated speech and cues, startup cancellation/timeout, and output silence before microphone shutdown. These tests simulate Android events; physical headset timing and whether the previously missed press is resolved still require testing the new installed build.


## Follow-up: confirmed Android post-call Play suppression

The user confirmed that the route-gated start cue works, but a resume press roughly three seconds after stop is lost; waiting over five seconds works. Retained Bluetooth logs from the installed `fa18fb46` build establish why:

- At 21:38:21.933 the headset reported HFP audio disconnected. Drone published paused at 21:38:22.714 and returned to normal audio mode at 21:38:23.019.
- At 21:38:25.847 Bluetooth received AVRCP Play (operation 68) and logged `Dropping the Play command received right after call end cmd`. The corresponding release was also dropped. Neither event reached MediaSessionService.
- The next Play at 21:38:31.827 was delivered and resumed Drone. The same dropped-then-delivered sequence occurred at 21:38:48.539 and 21:38:53.658.
- AudioManager's SCO broadcast was announced at 21:38:21.939, but the app still did not pause until 21:38:22.714. Subscribing to that broadcast did not eliminate the device's fallback interval.

Changing JS debounce or accepting duplicate Play cannot recover an event discarded inside Bluetooth. Android's [Bluetooth stack](https://android.googlesource.com/platform/system/bt/+/9ac641d/btif/src/btif_rc.c) implements post-call media-command suppression for device interoperability. The new classic Bluetooth route instead opens the public [BluetoothHeadset.startVoiceRecognition](https://developer.android.com/reference/android/bluetooth/BluetoothHeadset#startVoiceRecognition(android.bluetooth.BluetoothDevice)) audio connection before selecting the communication device. That avoids starting an HFP virtual call. This API selects headset audio; recognition and Companion processing remain in Drone.

The route owns its audio mode and cleanup, so expo-audio does not start a competing virtual call. It waits for AudioService to observe external SCO before selecting the route, retains existing cue gating, and waits for actual disconnection during cleanup before a queued resume begins. It listens directly to HFP audio-state broadcasts for earlier stop. Pending profile binding and connection can be cancelled; timeout, late callbacks, unsupported headsets, and another app already using SCO are handled explicitly.

Android 12+ requires Nearby devices / BLUETOOTH_CONNECT permission for these public headset APIs and broadcasts. Drone requests it during foreground Live preparation only when a classic headset is attached. Denial or a headset without voice-recognition support retains the standard route, including its possible post-call delay. Wired, USB, BLE and phone-only routing continue through the existing path.

Validation: Android Kotlin compilation, mobile typecheck, 19 targeted TypeScript tests (audio ownership/cancellation, permissions, Companion lifecycle), and three native JVM suites passed. Native tests cover external-SCO-before-route ordering, direct hangup, immediate restart, teardown completion, late binding, timeout, unsupported hardware and refusal to disturb another active headset session. The new route still requires a physical headset test after allowing Nearby devices; simulated Bluetooth events do not establish firmware behavior or actual speaker-leak timing.


## Follow-up: Play-only headset button after permission grant

With Nearby devices granted on `87bf4437`, device logs confirm the external headset route connected at 22:04:36.391 and 22:05:20.313. Physical presses now reach Drone as KEYCODE_MEDIA_PLAY down/up pairs even while Live is running (for example 22:04:43.886, 22:04:47.667 and 22:05:28.996). The native handler interpreted each as an idempotent start and ignored it because Live was already playing. The new connection itself was working.

Physical MEDIA_PLAY now toggles using the current native playback state, like PLAY_PAUSE and HEADSETHOOK. Explicit MediaSession onPlay/onPause remain idempotent. Only the first key-down acts; releases and repeats are consumed. Pausing stops and mutes native audio while the headset is still connected, before JS tears down the route.

A regression test reproduced the ignored press before the change. It exercises successive Play-only stop/resume/stop presses without a delay, duplicate/up/repeat handling, explicit transport commands, stale recording acknowledgement, and silence before headset teardown. Physical speaker-spill timing still requires testing the installed build.

Validation: all three native JVM suites passed, including the new Play-only headset regression.


## Follow-up: opening capture and audible microphone cues

The user confirmed `96ede281` cuts speech without a speaker spill and usually resumes immediately. They reported missing opening speech and an inaudible start cue, and requested a slightly longer/louder stop cue.

Device logs show the start cue was requested during microphone startup, rather than on server connection: at 22:15:20.468 native playback was opened, the route became ready at 22:15:20.511, ACK began at 22:15:20.525, and server playback resumed at 22:15:22.398. Similar sequences occur at 22:14:37 and 22:15:29. These logs establish a cue request, not that the user could hear it or that all opening speech was delivered.

Two native issues were addressed:

- Capture replaced every sample with zero until the *output* route became ready. Opening microphone samples now enter the existing 40-second connection buffer independently of playback readiness. Explicit microphone mute still sends silence. A regression using nonzero input reproduced the lost samples before the change.
- A streaming output now receives 100 ms of silent priming data when waiting for a headset. That allows devices which report routing only after a write to release the start-cue gate without waiting for server speech. Assistant audio stays held until the headset route is ready; stop still silences output before microphone and route teardown.

The existing capture callback already requests the cue before connecting Live, so it remains in that location. Android's [ToneGenerator definition](https://developer.android.com/reference/android/media/ToneGenerator#TONE_PROP_ACK) gives ACK two 100 ms bursts separated by 100 ms. The previous 180 ms deadline truncated its second burst. ACK now has a 350 ms window, the stop tone lasts 300 ms, and tone volume is raised from 65 to 80. Cleanup waits for the cue window before releasing the headset route. No cue was added to the network-ready callback.

Validation: all three native JVM suites passed, including nonzero opening capture before output readiness, explicit mute, silent priming without server audio, cancellation and route-loss silence. Targeted connection and lifecycle tests verify buffered speech order and a single capture cue while Live is still connecting. Audible cue clarity and real speech recognition still need a physical test after deployment.
