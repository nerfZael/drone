# Wake Word Options Without Keys Or Cloud

Goal: reliable local trigger for a short keyword such as `hey` in the Android app, without a cloud API, API key, paid license, or license-key activation.

## Summary Recommendation

Use **Vosk grammar-mode recognition** as the next implementation path.

It is not a DSP-level always-on hotword engine, but it is the best practical no-key option for this project because it:

- runs fully offline on Android;
- is Apache-2.0 licensed;
- has an Android integration path and small English models;
- can constrain recognition to a tiny grammar such as `["hey", "[unk]"]`;
- can share the app's existing `AudioRecord` PCM pipeline instead of competing with `SpeechRecognizer` for the microphone;
- avoids app/API-key licensing problems.

The recommended implementation is a foreground service with one `AudioRecord` loop. While inactive, feed PCM to Vosk only. When `hey` is detected, start sending the same 16 kHz PCM stream to `/audio`. While streaming, continue feeding a copy of the same PCM frames to Vosk so a second `hey` can stop streaming without opening a second microphone client.

## Android Native APIs

### SpeechRecognizer / On-device SpeechRecognizer

- License/key: no app key required.
- Local/offline: `createOnDeviceSpeechRecognizer` exists, and `EXTRA_PREFER_OFFLINE` can be requested, but availability depends on device services.
- Android complexity: low; already implemented.
- Accuracy/latency: designed for speech recognition sessions, not always-on hotwording. It often stops and restarts, and short words like `hey` are not a robust wake-word model.
- Battery: Android docs warn normal `SpeechRecognizer` may stream remotely and is not intended for continuous recognition.
- Keyword customization: arbitrary spoken text can be matched after recognition, but there is no wake-word confidence score.
- Mic sharing: poor. It may conflict with `AudioRecord` while streaming.
- Verdict: acceptable fallback/prototype only.

Sources:

- https://developer.android.com/reference/android/speech/SpeechRecognizer

### VoiceInteractionService / AlwaysOnHotwordDetector / SoundTrigger

- License/key: no third-party API key, but gated by Android assistant/voice-interaction system role and device support.
- Local/offline: can use low-power hardware hotword support when available.
- Android complexity: high and role-constrained. The app must be the active `VoiceInteractionService`; normal apps cannot just use this as an arbitrary background keyword detector.
- Accuracy/latency: best native path when available because it uses enrolled keyphrases and SoundTrigger hardware.
- Battery: best, because it can use low-power DSP/sensor hub.
- Keyword customization: depends on enrolled keyphrase/sound model support.
- Mic sharing: system-controlled.
- Verdict: not feasible for this personal app unless it becomes the device assistant / active voice interaction service.

Sources:

- https://developer.android.com/reference/android/service/voice/VoiceInteractionService
- https://source.android.com/docs/automotive/voice/voice_interaction_guide/app_development
- https://source.android.com/docs/automotive/voice/voice_interaction_guide/integration_flows

## Open-source Local Options

### Vosk / Kaldi Grammar Mode

- License/key: Apache-2.0, no key.
- Local/offline: yes.
- Android complexity: medium. Add Vosk Android dependency/AAR, bundle a small model in assets or download it on first run, initialize a `Recognizer` with a constrained grammar.
- Accuracy/latency: good enough for command/keyword spotting when grammar is constrained. More robust than generic `SpeechRecognizer` for a tiny phrase set, but not as optimized as a dedicated wake-word neural model.
- Battery: moderate. It runs CPU inference continuously in the foreground service. More expensive than SoundTrigger DSP, but acceptable for a personal foreground-service app if tuned.
- Model size/build: small English models are usually tens of MB. This increases APK size unless model download is added.
- Keyword customization: easy for words in the model vocabulary; use grammar mode for `hey`.
- Mic sharing: good. It can consume the same `AudioRecord` PCM stream the app already uses.
- Verdict: best next step.

Sources:

- https://alphacephei.com/vosk/android
- https://github.com/alphacep/vosk-api
- https://pypi.org/project/vosk/

### openWakeWord

- License/key: code is Apache-2.0, no key required.
- Local/offline: yes.
- Android complexity: medium-high. Android is not the main reference path; would likely require ONNX Runtime Mobile or a native wrapper, feature extraction, model asset packaging, and tuning.
- Accuracy/latency: strong for trained wake-word models, but quality depends heavily on the model and training data.
- Battery: potentially good with a small ONNX model, but depends on feature extraction/inference cadence.
- Model size/build: small model possible. Pretrained bundled models are not ideal here because included pretrained models are CC BY-NC-SA and do not include arbitrary `hey`.
- Keyword customization: possible by training a custom model. For this project, `hey` would need a custom model trained locally with positive/negative samples or synthetic data.
- Mic sharing: good if integrated into the single `AudioRecord` pipeline.
- Verdict: promising long-term if a custom `hey` model is trained and validated, but higher risk than Vosk for the next step.

Sources:

- https://github.com/dscripka/openWakeWord
- https://pypi.org/project/openwakeword/

### PocketSphinx

- License/key: open source, no key.
- Local/offline: yes.
- Android complexity: medium, but Android packaging/library freshness is a concern.
- Accuracy/latency: historically used for keyword spotting, but generally weaker than modern Vosk/openWakeWord options.
- Battery: moderate CPU use.
- Model size/build: small.
- Keyword customization: supports keyphrase spotting.
- Mic sharing: good if wired to `AudioRecord`.
- Verdict: fallback only. It is older and likely lower accuracy for this use case.

Source:

- https://cmusphinx.github.io/

### TensorFlow Lite Custom Keyword Spotting

- License/key: no key; TensorFlow/TFLite tooling is open source.
- Local/offline: yes.
- Android complexity: high. Need model training, feature extraction, threshold calibration, false-positive testing, and an Android inference loop.
- Accuracy/latency: can be excellent with a good dataset/model. A single syllable keyword like `hey` is hard and may false-trigger without careful negative data.
- Battery: can be good with a tiny model.
- Model size/build: small model possible.
- Keyword customization: full control, but training data and evaluation are the work.
- Mic sharing: good if wired to `AudioRecord`.
- Verdict: best custom-production path if time is available to train/test a model; too much for a quick safe replacement.

Sources:

- https://www.tensorflow.org/lite/android/tutorials/audio_classification
- https://android.googlesource.com/platform/external/tensorflow/+/e5213e91eb9/tensorflow/lite/micro/examples/micro_speech/README.md

### Porcupine

- License/key: requires Picovoice account and AccessKey.
- Local/offline: inference is local after setup.
- Android complexity: low.
- Accuracy/latency: strong.
- Battery: good.
- Keyword customization: good through Picovoice Console, but requires key/account.
- Mic sharing: possible through low-level API.
- Verdict: excluded by the no-key/no-license-key constraint.

Sources:

- https://picovoice.ai/docs/quick-start/porcupine-android/
- https://picovoice.ai/docs/api/porcupine-android/

## Proposed Vosk Implementation Plan

1. Add Vosk dependency/AAR and model asset handling.
2. Add a `WakeWordDetector` interface:
   - `start(sampleRateHz)`
   - `acceptPcm(frame: ByteArray, length: Int): Boolean`
   - `stop()`
   - `release()`
3. Implement `VoskWakeWordDetector` using a constrained grammar, likely `["hey", "[unk]"]`.
4. Refactor `VoiceSessionService` to use one `AudioRecord` loop in both states:
   - waiting: feed PCM to Vosk only;
   - streaming: send PCM to `/audio` and also feed a copy to Vosk for stop trigger.
5. Add status labels for model loading and detector confidence/results.
6. Add tuning constants:
   - detection cooldown/debounce;
   - optional required consecutive detections;
   - Vosk grammar alternatives such as `["hey", "hay", "[unk]"]`.
7. Keep manual controls as fallback.

## Main Tradeoff

Vosk is larger and uses more CPU than a tiny wake-word neural model, but it is dramatically lower-risk for this project because it is no-key, offline, Android-capable, and can be integrated into the existing PCM path. It also avoids the current `SpeechRecognizer` problem where wake listening and raw streaming compete for microphone ownership.

## Implemented Phase 1 Notes

The app now bundles `vosk-model-small-en-us-0.15` under Android assets as `model-en-us` and loads it with Vosk Android `StorageService`. The model is from Alpha Cephei's public Vosk model downloads and is Apache-2.0 licensed. It is about 68 MB unpacked and increases the debug APK size.

The foreground service now uses one `AudioRecord` loop:

- waiting: PCM goes to Vosk only;
- streaming: PCM goes to `/audio` and also to Vosk;
- saying `hey` toggles streaming on/off;
- manual streaming controls remain as fallback.
