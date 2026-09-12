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

The patched application has not been installed on the phone. Physical headset verification of the fixed build remains pending, including stop/start after locking the screen and confirming that explicit Companion close prevents restart.
