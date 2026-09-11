# Microphone and playback routing

The Expo Audio dependency patch owns Android audio routing for all three mobile capture paths: recorded clips (chat and companion), continuous dictation, and WebRTC live companion. Each path already enables `allowsRecording` before capture and disables it during cleanup.

Upstream Expo Audio 57.0.3 drops `allowsRecording` from the Android JS bridge, has no matching native field, and sets speakerphone on whenever `shouldRouteThroughEarpiece` is false. Consequently, configuring recording did not establish a Bluetooth communication route and could override attached-device playback.

The patch forwards the recording flag and enters communication mode during capture. Android 12+ selects an available external communication device, retaining an existing external route when possible, and falls back to the phone if needed. Older Android uses Bluetooth SCO. Device callbacks update routing when accessories connect or disconnect. Releasing capture clears the communication route and restores the previous audio mode, allowing ordinary media playback to follow the system route. Expo clip and PCM recording use the voice communication source by default so Android's communication input policy applies; explicit recorder input/source choices remain available.

On iOS, Expo already enables Bluetooth headset microphones. The patch also permits A2DP playback in the recording session, allowing playback-only Bluetooth accessories; iOS chooses the compatible input/output route. Browser capture and playback continue to use browser/OS default devices.

## Verification

Run `bun run --filter drone-hub-mobile test:audio-routing` with an Android SDK and Gradle's cached Kotlin compiler. This compiles the actual patched router against the installed Android platform and exercises it on the JVM with simulated audio devices. It covers headset preference, USB, BLE, removal, rejected selections, partial mode updates, cleanup, and legacy SCO. It does not simulate physical audio transport.

After rebuilding the native app, check each capture path with a Bluetooth headset and a wired/USB headset:

- Connect before starting; verify microphone input comes from the headset and live replies play through it.
- Disconnect while capturing; verify the phone takes over. Reconnect and verify the accessory takes over.
- Stop or cancel capture; verify normal media playback and a subsequent recording still work.
- Repeat with no accessory and with a playback-only accessory. A device without a supported microphone must use an available microphone instead.

Bluetooth microphone support depends on the accessory and OS exposing a compatible capture/communication route. JVM tests cannot verify a particular headset or OEM's routing behavior. Native patch changes require a new app binary; a JavaScript reload is insufficient.
