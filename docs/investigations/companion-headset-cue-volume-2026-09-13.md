# Companion headset stop cue and volume

The user reports that stopping Companion plays its cue on the phone, and Shokz OpenRun Pro volume buttons announce battery even while Companion is audibly speaking.

## Evidence and routing decision

Read-only diagnostics from the connected Samsung phone show the voice PCM output pausing at 14:16:15.507, a separate ToneGenerator starting at 14:16:15.616, and Bluetooth route teardown only at 14:16:16.108. Teardown ordering alone does not explain the reported phone cue: the stop sound used a new output instead of the established speech track.

The media session advertised USAGE_MEDIA while PCM used USAGE_VOICE_COMMUNICATION. Bluetooth's AVRCP state already reported PLAYING, and the retained logs contained no incoming volume commands. The user confirmed the battery announcement occurs during audible speech. [Shokz documents battery announcements for idle volume-button presses](https://uk.shokz.com/pages/openrun-pro-faq), so the working hypothesis is that voice-recognition SCO leaves this headset's firmware in its idle control mode.

The user chose to prioritize working headset volume and test standard call audio, accepting that it may restore the roughly five-second post-call resume suppression documented in the previous headset investigation. This is a compatibility change to test on physical hardware, not proof that firmware volume behavior is fixed.

## Implementation

- Stop capture and flush assistant speech immediately. Retain the existing PCM output for a local 300 ms descending stop cue, then release it after the playback head consumes the cue. No separate ToneGenerator is opened.
- Restart retained output silently and verify the headset route before submitting audible PCM. Android [reports no routed device on paused tracks](https://developer.android.com/reference/android/media/AudioTrack#getRoutedDevice()), so a paused track's null route must not be mistaken for a disconnect or permission to play on the phone.
- Early HFP/SCO disconnect, track route loss, resume, close, and a bounded timeout cancel the cue and resolve pending completion callbacks. If the headset hangs up its audio connection, suppress the cue rather than spilling onto the phone.
- Use standard communication-device call routing instead of BluetoothHeadset.startVoiceRecognition. Retain device identification, refusal to disturb an existing headset session, startup cancellation, and awaited teardown.
- Advertise the voice stream for active Companion volume controls and the media stream while idle, using [MediaSession.setPlaybackToLocal](https://developer.android.com/reference/android/media/session/MediaSession#setPlaybackToLocal(android.media.AudioAttributes)).

## Validation

All three native JVM suites pass, covering original playback/capture behavior and the new retained cue, paused null route, duplicate cue requests, playback completion, route-loss cancellation, timeout, resume, close, and call routing. The 26 targeted JavaScript lifecycle/audio/control tests pass in separate Bun processes; batching those files exposes existing shared-mock interference. Android Kotlin compilation passes. Physical cue audibility, firmware volume control, and post-call resume timing require checking the installed build.

The release APK built successfully and was installed on the connected Samsung phone at 14:30:24 on September 13. Drone Hub was reopened successfully for the physical headset test.

## Follow-up: volume confirmed; physical hangup suppresses the stop cue

The user confirms headset volume works, but reports no stop cue. Logs show successive headset volume changes at 14:32:24–14:32:36. At 14:32:38.585, 14:32:54.313, and 14:33:09.944, the headset itself disconnects call audio. No stop media key precedes those disconnections. The native no-speaker-spill path then deliberately skips the retained voice-track cue; it cannot play through a call connection the headset has already closed.

The follow-up retains standard call audio and its confirmed working volume controls. After a remote hangup, it waits for call-route teardown, then opens an output-only media cue targeted to the same headset's A2DP address. It waits for normal audio mode, device availability, actual track routing, and media-volume settling while sending silence. It never opens a microphone. An absent/different headset, timeout, route loss, close, or queued resume cancels the cue. Ordinary media-key stops can still use the retained voice output.

Native regressions cover the physical-hangup path, delayed A2DP availability, initial speaker routing with silence, exact headset matching, completion after rendering, no additional capture, route loss, resume, close, and timeout. The Bluetooth-route test verifies the media cue's callback runs only after route teardown and normal-mode restoration. Hardware audibility still needs checking the follow-up build; the cue follows the Bluetooth mode switch and can therefore have a short delay.

All three native suites and the release build passed. The follow-up APK was installed at 14:40:50 and Drone Hub was reopened for testing.

The user subsequently requested a slightly louder stop sound. Its shared PCM amplitude was raised from 3500 to 5000 (about +3 dB) for both headset output paths, retaining the 300 ms duration and smooth fades. The native suites and release build passed.
