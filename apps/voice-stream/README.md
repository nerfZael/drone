# Voice Stream

Native Android app plus a Node.js/TypeScript WebSocket server for testing near-real-time PCM audio round trips.

## Layout

- `android/app`: Kotlin Android app.
- `server`: Node.js TypeScript WebSocket server.

## Audio Protocol

- WebSocket endpoint: `/audio`
- Browser monitor WebSocket endpoint: `/monitor`
- Binary frames only
- Format: 16 kHz mono signed 16-bit little-endian PCM
- Android sends microphone chunks, currently 20 ms per frame.
- Server does not echo placeholder audio on `/audio`; generated tone playback has been removed.
- Server also broadcasts each Android microphone PCM chunk to connected `/monitor` browser clients.

## Android Speech Trigger

The Android app has a user-controlled speech trigger mode:

- `Off`: before pressing `Start`, the foreground service and microphone are stopped.
- `Locked`: after pressing `Start`, the foreground service and local microphone recognizer are running, but normal local commands are ignored. Say `approval code one two three four` to enter `Asleep`, or `approval code zero zero zero zero` to turn Off.
- `Asleep`: local commands are enabled, and the app listens locally for `hey sebastian` without streaming audio to the server. Say `approval code four three two one` to return to `Locked`.
- `Awake`: after `hey sebastian`, the app streams microphone PCM to the server until the server detects the sleep phrase or the user presses Stop.
- The same primary button changes to `Stop Listening` while the foreground service is active.
- While waiting, the app uses a bundled local Vosk/Kaldi small English model with grammar mode for `hey sebastian`.
- The app does not stream microphone PCM to the server until `hey sebastian` is detected.
- While waiting, the app keeps about 1.5 seconds of local PCM pre-roll. When `hey sebastian` is detected, it opens the `/audio` WebSocket and sends that buffered audio first, then live 16 kHz mono signed 16-bit little-endian PCM.
- While the WebSocket is connecting, the app buffers up to about 5 seconds of microphone audio locally so speech immediately after `hey sebastian` is not dropped.
- While streaming, the app keeps sending microphone PCM to the server. Local Vosk no longer listens for the sleep phrase.
- If server-side transcription detects `that's it`, the server sends a control message to the Android app, which stops streaming and returns to wake-listening mode.
- Local cue sounds play when `hey sebastian` starts streaming and when the server tells the app to sleep.
- `hey sebastian` is ignored while already streaming.
- Saying `status`, `state us`, or `check status` while Asleep plays a third local cue without starting the stream. Saying those while Locked or Awake does nothing.
- Saying `approval code` followed by 4-8 spoken digits while Asleep or Awake sends that code to the server without opening the audio stream. Example: `approval code one one five nine`. The app requires the two-word phrase first, then waits briefly for the digit sequence to stabilize before uploading it. While Locked, `approval code one two three four` enters Asleep and `approval code zero zero zero zero` turns Off; all other approval codes are ignored. While Asleep or Awake, `approval code four three two one` returns to Locked instead of uploading, including while Awake.

This is not Android DSP/native arbitrary hotwording. Normal apps cannot use the low-power SoundTrigger hotword path directly, so the app runs Vosk locally in the foreground service. The debug APK bundles `vosk-model-small-en-us-0.15` from Alpha Cephei, which is Apache-2.0 licensed and about 68 MB unpacked. Vosk uses more CPU/battery than hardware hotwording, but it avoids cloud services, API keys, and microphone contention with Android `SpeechRecognizer`.

## Run The Server

From the repo root:

```bash
bun run voice-stream
```

The normal Drone workflow starts this server with the Hub:

```bash
bun run drone hub
```

By default the Hub starts Voice Stream on port `3199`. Use `drone hub start --voice-stream-port 3200` to pick a different port, or `drone hub start --no-voice-stream` to run only the Hub. When the Hub launches Voice Stream, it passes the GROQ API key saved in Drone Hub settings to the Voice Stream process and restarts Voice Stream when that key is saved or cleared.

You can also run only Voice Stream from this app directory:

```bash
bun run dev
```

When run standalone with `bun run dev`, the server listens on `ws://0.0.0.0:3000/audio` by default for audio streaming and serves a browser download page at `http://0.0.0.0:3000/`. When launched by `drone hub`, it uses the Hub Voice Stream port, which defaults to `3199`.

Authenticated Android clients can also POST approval codes to `http://0.0.0.0:3000/approvals`. The browser page shows recent approval codes near the transcript and broadcasts new codes over `/monitor`. When Groq TTS is configured, the endpoint responds to Android with WAV audio saying the approval code back in English.

The `/audio` WebSocket requires a pairing token. The server uses `VOICE_STREAM_PAIRING_TOKEN` when set; otherwise it creates and persists a random token at:

```text
server/.runtime/pairing-token
```

The `.runtime` directory is ignored by Git.

The pairing QR is not shown on the public download page. Open `/pair` and enter the pairing admin password to show it. Set the password with:

```bash
DRONE_PAIR_PASSWORD='change-me' bun run dev
```

If `DRONE_PAIR_PASSWORD` is not set, `/pair` is disabled and no pairing QR is shown.

Pairing QR codes include the APK download URL and a minimum Android app `versionCode`. The debug APK build stores its version in `android/version.properties`. Gradle hashes Android-relevant inputs such as `android/app/src`, Android Gradle files, and the Gradle wrapper; if that hash changes, it increments `versionCode` and writes the new hash back to `android/version.properties`. Server-only changes and docs-only changes do not bump the APK. Commit `android/version.properties` with Android behavior changes so other checkouts use the same version state.

By default, the server reads the `versionCode` from the built debug APK metadata. If the APK is missing or cannot be inspected, it falls back to `android/app/build.gradle.kts`. Override it only when needed:

```bash
DRONE_ANDROID_MIN_VERSION_CODE=3 bun run dev
```

Apps that support this check prompt the user to download the new APK instead of pairing when their installed build is too old. APKs built before this feature cannot show that custom prompt because they do not understand the QR version field.

The browser monitor WebSocket route is:

```text
ws://0.0.0.0:3000/monitor
```

The APK download route is:

```text
http://0.0.0.0:3000/download/app-debug.apk
```

To use a different standalone port:

```bash
PORT=9000 bun run dev
```

The HTTP server expects the APK at:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

relative to `apps/voice-stream`. You can override this with an absolute or relative path:

```bash
APK_PATH=/dvm-data/home/android/app/build/outputs/apk/debug/app-debug.apk bun run dev
```

## Groq Speech-To-Text

Server-side transcription is optional. The server and site still work without a key, but the transcript panel shows transcription as disabled.

To enable Groq transcription:

```bash
GROQ_API_KEY=your_groq_key bun run dev
```

Optional configuration:

```bash
GROQ_STT_MODEL=whisper-large-v3-turbo
GROQ_STT_LANGUAGE=en
GROQ_STT_RESPONSE_FORMAT=verbose_json
GROQ_STT_PROMPT="Names, jargon, and formatting hints."
GROQ_STT_CONTEXT_CHARS=700
GROQ_STT_MAX_PROMPT_CHARS=896
GROQ_TRANSCRIBE_INTERVAL_MS=500
GROQ_TRANSCRIBE_MIN_SPEECH_MS=180
GROQ_TRANSCRIBE_MIN_SUBMIT_MS=1000
GROQ_TRANSCRIBE_SILENCE_MS=650
GROQ_TRANSCRIBE_SHORT_UTTERANCE_SILENCE_MS=1000
GROQ_TRANSCRIBE_MAX_SEGMENT_MS=10000
GROQ_TRANSCRIBE_OVERLAP_MS=500
GROQ_TRANSCRIBE_SILENCE_THRESHOLD=0.025
GROQ_STT_DEBUG_VAD=false
GROQ_STT_DEBUG_SEGMENTS=true
GROQ_STT_LOG_TEXT_CHARS=500
```

Defaults:

- Endpoint: `https://api.groq.com/openai/v1/audio/transcriptions`
- Model: `whisper-large-v3-turbo`
- Input sent to Groq: silence-delimited WAV segments converted from the Android 16 kHz mono PCM stream
- Segmentation: local RMS voice activity detection waits for end-of-utterance silence, uses overlap between segments, pads short utterances before upload, and includes recent transcript text as a Groq `prompt` for context. Very short utterances below `GROQ_TRANSCRIBE_MIN_SPEECH_MS` are still finalized after `GROQ_TRANSCRIBE_SHORT_UTTERANCE_SILENCE_MS` of quiet instead of being merged into the next phrase.
- Prompt length: Groq currently rejects transcription prompts over 896 characters, so the server caps the combined `GROQ_STT_PROMPT` plus recent transcript context with `GROQ_STT_MAX_PROMPT_CHARS`
- Transcript delivery: JSON messages over `/monitor`, alongside binary PCM audio monitor frames
- Command cleanup: the server removes `hey sebastian`/`hay sebastian` and `that's it`/`thats it`/`that is it` from transcript segments before displaying them. When a sleep phrase is detected, the server sends `{"type":"sleep"}` to connected Android `/audio` clients.
- Diagnostics: `GROQ_STT_DEBUG_SEGMENTS=true` logs one line when each segment is queued and one line when Groq returns, including segment reason, speech/silence timing, prompt length, raw transcript, cleaned transcript, and whether a wake/sleep command matched. Set it to `false` to reduce logs. `GROQ_STT_LOG_TEXT_CHARS` caps transcript text in logs.

For short commands or single numbers, keep `GROQ_TRANSCRIBE_MIN_SPEECH_MS` low and `GROQ_TRANSCRIBE_SHORT_UTTERANCE_SILENCE_MS` around `800`-`1200`. If segments never finalize even in a quiet room and the server logs show `reason=max_segment` with `trailingSilenceMs=0`, raise `GROQ_TRANSCRIBE_SILENCE_THRESHOLD` so room noise is treated as silence. If sleep commands feel too slow when silence is not detected, lower `GROQ_TRANSCRIBE_MAX_SEGMENT_MS`. Set `GROQ_STT_DEBUG_VAD=true` to log speech start, silence, and finalize events.

## Groq Approval Code TTS

Approval code echo is optional and uses the English Groq TTS model by default. Set `GROQ_API_KEY` or `GROQ_TTS_API_KEY` before starting the server:

```bash
GROQ_API_KEY=your_groq_key bun run dev
```

Defaults:

- Endpoint: `https://api.groq.com/openai/v1/audio/speech`
- Model: `canopylabs/orpheus-v1-english`
- Voice: `austin`
- Output: WAV audio returned from `POST /approvals`

Override with `GROQ_TTS_ENDPOINT`, `GROQ_TTS_MODEL`, and `GROQ_TTS_VOICE`. If TTS is not configured or synthesis fails, `/approvals` still accepts the code and returns JSON without playback audio.

## Expose With Ngrok

In another terminal:

```bash
ngrok http 3000
```

Copy the HTTPS forwarding hostname and convert it to WebSocket form:

```text
https://example.ngrok-free.app  ->  wss://example.ngrok-free.app/audio
```

Open the HTTPS forwarding URL in a browser to download the APK:

```text
https://example.ngrok-free.app/
```

Enter that `wss://.../audio` URL in the Android app and tap `Save URL`. The browser monitor on the page automatically uses `wss://example.ngrok-free.app/monitor`.

## Build The APK

This app has a Gradle wrapper. Use your local Android SDK by setting `ANDROID_HOME` when needed.

```bash
ANDROID_HOME=/path/to/android-sdk bun run apk
```

The debug APK is produced at:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Install The APK

From a browser, open the server page and tap the download button. With `drone hub`, the default URL is:

```text
http://127.0.0.1:3199/
```

With standalone `bun run dev`, the default URL is:

```text
http://127.0.0.1:3000/
```

With ngrok, use:

```text
https://YOUR-NGROK-HOST/
```

With a phone connected and USB debugging enabled:

```bash
$ANDROID_HOME/platform-tools/adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

On first launch, grant microphone permission. On Android 13+, grant notification permission too so the foreground service notification is visible. Camera permission is requested only when scanning a pairing QR code.

For Bluetooth headset microphones, Android 12+ also asks for nearby/Bluetooth device permission. When listening starts, the app prefers available microphones in this order: Bluetooth headset, wired headset, USB headset, then the phone microphone. The selected microphone is shown near the QR shortcut. Bluetooth headsets such as Shokz OpenRun usually switch into hands-free/call mode while their microphone is active, so playback quality may be lower than normal music mode.

The Android app also writes a small diagnostic log named `drone-debug.log` in its app external files directory. The Settings panel shows the exact path. With ADB, it is typically pullable from:

```bash
$ANDROID_HOME/platform-tools/adb pull /sdcard/Android/data/com.example.voicestream/files/drone-debug.log
```

When the app is paired, it also uploads this diagnostic log to the server on launch, when listening starts/stops, and about every 15 seconds while listening. Uploads go to:

```text
POST /logs/android?token=PAIRING_TOKEN
```

The server appends them to:

```text
server/.runtime/android-logs/drone-android.log
```

The upload endpoint uses the same pairing token as `/audio`; unauthenticated uploads are rejected.

## Pair The Android App

1. Start the server.
2. Open the server page in a browser.
3. Install/open the Android app.
4. Open `/pair` in the browser, enter the pairing admin password, and unlock the QR code.
5. Tap the QR camera shortcut in the Android app and scan the QR code.
6. The app saves the authenticated `/audio?token=...` WebSocket URL and pairing token.
7. Use `Start Listening`.

If camera scanning is unavailable or permission is denied, paste the `voicestream://pair?...` QR payload or the authenticated `wss://.../audio?token=...` URL into the pairing text field and tap `Apply Pairing Text`.

Unauthorized `/audio` WebSocket clients are rejected with `401 Unauthorized`. The download page remains public so the APK can be installed. The pairing QR contains the pairing token, so keep `/pair` password-protected and change `DRONE_PAIR_PASSWORD` for real use.

## Expected Behavior

1. Start the server.
2. Expose it with ngrok if the phone is not on the same network as the server.
3. Install and open the Android app.
4. Enter the server WebSocket URL, for example `wss://example.ngrok-free.app/audio`.
5. Open the server page in a desktop browser or another phone browser, for example `https://example.ngrok-free.app/`.
6. Click `Start Monitor` on the web page.
7. Tap `Start Listening` in the Android app.
8. Say `approval code one two three four` to move from Locked to Asleep.
9. Say `hey sebastian` near the phone to start streaming.
10. Say `that's it` to stop streaming and return to Asleep. This requires server-side transcription to be configured with `GROQ_API_KEY`.
11. Say `status` while Asleep to confirm the app is not Awake; the app plays a local status cue only when not streaming.
12. Say a local approval code such as `approval code one one five nine`; it should appear in the Approval codes list on the web page.
13. Say `approval code four three two one` to return to Locked. This also works while Awake and does not upload the code.
14. While Locked, say `approval code zero zero zero zero` to turn Off and hear the distinct off cue.
15. The app records microphone PCM only while streaming and sends it over `/audio`; approval-code speech playback is returned by `POST /approvals` when Groq TTS is configured.
16. The browser monitor receives the same raw microphone PCM chunks over `/monitor`, converts them to Web Audio buffers, and plays them in near real time.
17. If `GROQ_API_KEY` is configured, the server sends short WAV chunks to Groq, removes wake/sleep command phrases from transcript text, and the transcript panel updates as segments return.
18. Locking the phone or backgrounding the app should keep the Android foreground service alive while Android allows it to run.
19. Tap `Stop Listening` in the app or `Stop` in the notification to end the service.

## Browser Monitor Test

1. Run the server on port 3000.
2. Install the APK.
3. Configure the app WebSocket URL to `ws://YOUR-LAN-HOST:3000/audio` for local testing or `wss://YOUR-NGROK-HOST/audio` for ngrok.
4. Open `http://YOUR-LAN-HOST:3000/` or `https://YOUR-NGROK-HOST/` in a browser.
5. Click `Start Monitor`.
6. Start the Android voice session and speak near the phone.
7. Watch the monitor counters increase and listen for the phone microphone audio in the browser.
8. Use the monitor volume slider to adjust playback gain. It defaults to `4x` and ranges from mute to `20x`.

## Notes

- The app sets `usesCleartextTraffic=true`, so `ws://` URLs are usable for local LAN testing. Prefer `wss://` for ngrok.
- Some Android vendors aggressively limit background work. If streaming stops after locking the phone, disable battery optimization for the app in system settings.
- The `/audio` WebSocket is now microphone upload plus server command transport; approval-code speech playback is returned from `POST /approvals` when Groq TTS is configured.
