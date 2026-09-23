# GROQ silence hallucination investigation — 2026-09-23

Confirmed against the live GROQ API: digitally silent audio transcribes as “Thank you.” with `whisper-large-v3-turbo`. This is independent of the FLAC timestamp failure investigated earlier. The same hallucination occurs with fresh zero-based WAV, FLAC, and WebM inputs.

Recommendation: detect absence of speech from the audio before transcription. Start with a conservative exact-silence check, then evaluate a dedicated voice activity detector (VAD) for room noise and silent sections. The experiments do not support solving this by banning phrases, switching between the two Whisper models, prompting, or relying solely on provider confidence metadata.

This change set contains investigation artifacts only. No production transcription behavior was changed or deployed during this investigation.

## Reproduction

21 live requests used generated audio only, temperature 0, and the configured GROQ credential. Nine Turbo cases and four large-v3 comparisons used 16 kHz mono PCM WAV and `verbose_json`. Eight follow-up requests varied format, language, response format, or prompt. The controls use local FFmpeg/libflite speech synthesis. No personal recording was uploaded.

| Input | Model | Returned text | `no_speech_prob` |
| --- | --- | --- | --- |
| Exactly silent, 1 second | Turbo | Thank you. | 0 |
| Exactly silent, 5 seconds | Turbo | Thank you. | 0 |
| Exactly silent, 30 seconds | Turbo | Thank you. | 0 |
| White noise, 30 seconds, RMS −40 dBFS | Turbo | Thank you. | 0 |
| White noise, 5 seconds, RMS −55 dBFS | Turbo | . | 0 |
| 60 Hz hum, 5 seconds, RMS −45 dBFS | Turbo | . | 0 |
| Spoken “Thank you.” | Turbo | Thank you. | 0 |
| Same speech attenuated by 40 dB | Turbo | Thank you. | 0 |
| Spoken sentence followed by silence | Turbo | Correct sentence | 0 |
| Exactly silent, 5 and 30 seconds | large-v3 | you | 0.7006836 |
| Quiet white noise, 5 seconds | large-v3 | . | 0.1829834 |
| Spoken “Thank you.” | large-v3 | Thank you. | 0.044006348 |

For Turbo, the silent clips received `avg_logprob = -0.2933`, compared with `-0.6270` for ordinary spoken “Thank you.” and `-0.5513` for the quiet spoken control. A simple confidence cutoff cannot separate these examples safely. The provider reported zero `no_speech_prob` across all Turbo cases, including silence; this does not establish whether the field is a genuine calibrated score for this backend.

The silent 1- and 5-second Turbo clips also received a segment ending at 29.98 seconds, beyond their actual length. Duration validation is useful for diagnostics, but would not catch the 30-second silent example.

Follow-ups on five seconds of exact silence:

| Variation | Returned text |
| --- | --- |
| `response_format=json`, matching ordinary dictation | Thank you. |
| Explicit English language | Thank you. |
| Prompt: “Voice dictation transcript.” | Thank you. |
| Prompt: “Transcribe only audible speech. If there is silence, return no text.” | If there is silence, return no text. |
| Prompt containing a recent spoken sentence | Thank you. |
| Explicit Croatian language | Hvala što pratite kanal. |
| FLAC encoding | Thank you. |
| WebM encoding | Thank you. |

An offline FFmpeg decode check found an exact PCM peak of zero for the silent WAV, FLAC, and WebM samples. The quiet spoken control had peak 220 in signed 16-bit PCM and RMS −62.22 dBFS; the noise example that produced “Thank you” was louder at RMS −40 dBFS. A global volume threshold that rejects that noise would also reject the quieter valid speech.

These are small, synthetic tests, with one request per configuration. They establish a reproducible failure and counterexamples to several proposed filters, not a general error rate or a validated VAD threshold for real microphones.

## Relevant code today

- `apps/drone/src/hub/groq-transcription.ts`: ordinary dictation uses `json`, accepts the returned text, and does not request silence metadata. Timestamped recording transcription filters segments only when `no_speech_prob >= 0.8`; both the Turbo zeros and large-v3 silent score above pass that filter. Returned top-level text remains unfiltered even in timestamp mode.
- `apps/drone/src/hub/routes/operational-routes.ts`: `/api/audio/transcriptions` calls the ordinary path and may supply recent transcript context as a prompt.
- `packages/assistant-chat/src/continuous-voice.ts`: continuous voice has an adaptive volume gate. It is useful for segmentation, but it does not independently classify whether a sound is speech. Manual recordings and desktop chunks also need protection.
- Ordinary transcription currently treats an empty result as an error. A deliberate no-speech result should be handled as a normal outcome, without inserting or sending a fabricated message.

## Recommended implementation

1. Decode once to mono PCM and skip uploads containing exact digital silence. Return an explicit no-speech outcome. This is a narrow, testable safeguard for muted inputs; it will not handle room noise.
2. Evaluate a dedicated speech detector, such as Silero VAD, on microphone silence, fans, keyboard noise, music, soft speech, short acknowledgements, and supported languages. Initially skip only whole clips confidently classified as containing no speech. Keep uncertain clips and retain padding around detected speech.
3. For longer recordings, segment around speech with padding and preserve natural pauses. Maintain the mapping to original recording time when returning segment timestamps; deleting silence without that mapping would misalign microphone and desktop tracks.
4. Keep provider metadata as diagnostics. Record speech-detection outcome, audio duration, model, and provider request ID, with content logging off by default. Evaluate false rejections before enabling broader filtering.

Silero was researched but not installed or benchmarked in this investigation. No specific speech probability, duration, or energy threshold is established by these tests. Changing the application to use VAD requires evaluation beyond the synthetic reproduction.

Deleting every “thank you” would fail the spoken controls. Increasing the current silence-score filter would miss Turbo's zero scores. The prompt experiments also show that anti-hallucination instructions can become invented transcript text.

## Online resources

- [OpenWhispr issue #462](https://github.com/OpenWhispr/openwhispr/issues/462), opened March 18, 2026: a direct user report of GROQ Turbo producing video-outro phrases during silence. It proposes VAD and a style prompt. Our tests reproduced the symptom but did not reproduce the proposed style prompt's benefit.
- [Whisper discussion #679](https://github.com/openai/whisper/discussions/679): community experiments with context conditioning, short chunks, and VAD. These are reports and hypotheses, not guarantees for GROQ's hosted implementation.
- [Whisper discussion #1873](https://github.com/openai/whisper/discussions/1873): shared audio samples that trigger hallucinations, including non-speech sounds and repeated “thank you” outputs.
- [Whisper model card](https://github.com/openai/whisper/blob/main/model-card.md): the model authors explicitly describe invented text as a limitation of training with noisy paired audio and text. The frequent subtitle/outro explanation in forums is plausible but does not prove the origin of a particular prediction.
- [GROQ speech-to-text documentation](https://console.groq.com/docs/speech-to-text): documents segment metadata and explains that prompts guide style/context rather than act as chat instructions. The documented API parameters do not include local Whisper's `no_speech_threshold` or `condition_on_previous_text` controls.
- [Silero VAD](https://github.com/snakers4/silero-vad): primary project documentation for a dedicated speech detector supporting 8/16 kHz audio and ONNX deployment.

## Artifacts and rerun

Raw response summaries retain synthetic text, segment metadata, and provider request IDs, but no credentials:

- [Baseline/model comparison results](groq-silence-2026-09-23/results.json)
- [Prompt/format/language results](groq-silence-2026-09-23/variants-results.json)

The scripts require the built Hub settings module, a configured GROQ key, Node with fetch/FormData, and FFmpeg with libflite. They make 13 and 8 billable API calls respectively, and write generated fixtures/results to the specified directory. They are manual experiments, not automated test-suite entries.

```bash
node docs/investigations/groq-silence-2026-09-23/probe.cjs /tmp/groq-silence-rerun
node docs/investigations/groq-silence-2026-09-23/variants.cjs /tmp/groq-silence-rerun
```
