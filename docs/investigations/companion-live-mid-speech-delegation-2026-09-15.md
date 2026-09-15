# GPT-Live delegation during continuous speech — 15 September 2026

## Result

The user's observation reproduced in real API calls. Across eight continuous-speech runs with four system prompts, **every first client delegation arrived after speech ended**. Adding a two-second pause immediately after the same complete command caused all four prompts to delegate during that pause. More forceful early-delegation prompting did not change that pattern.

This supports treating a speech pause as necessary for reliable delegation in this tested configuration. It does **not** establish an undocumented architectural restriction or prove that no possible prompt, voice, or utterance can produce a mid-speech delegation. The earlier architectural interpretation was too optimistic as practical guidance for Companion.

The desired product constraint remains: GPT-Live decides when the user's intent is sufficiently specified. Automatically starting backend work from transcript fragments would change that behavior and is not the proposed solution.

## Method

- Made 16 fresh `gpt-live-1` sessions over `wss://api.openai.com/v1/live/sessions`, using `delegation: { type: "client" }`, `store: false`, and mono PCM16LE at 24 kHz. Used the Hub's configured OpenAI API credential without changing settings.
- Generated three speech clips with OpenAI `gpt-4o-mini-tts`, voice `cedar`: a complete composer command, a continuing explanation, and a dictation-only negative control. Reused the exact same audio bytes across prompt variants.
- Trimmed edge silence and capped interior quiet runs at 100 ms using 10 ms RMS frames at -42 dBFS. Independent FFmpeg `silencedetect` found no quiet intervals of 150 ms or longer in the continuous or dictation recordings. The paused control had a 2.00033-second quiet interval from 6.45967 to 8.46 seconds.
- Sent 100 ms audio chunks at their recorded rate, rather than uploading audio as fast as possible. The maximum observed interval between sends was 129 ms across all runs. Continued sending eight seconds of silence after each recording, then requested `session.close` and collected final usage.
- Recorded raw server events, transcript deltas, delegation IDs and `offset_ms`, client receipt times relative to audio streaming, and audio-send positions. Saved synthesized inputs and generated assistant audio. Delegations were never sent to a real backend and no completion result was injected.
- Bypassed the Companion adapter to measure the upstream event itself. This isolates GPT-Live from the adapter's 450 ms debounce and backend/model execution latency. No transcript-triggered delegation or tool execution was added.

### Speech conditions

The complete command was:

> Please edit the current chat composer now so the first line contains the digit one and the second line contains the digit two.

It ended at **6.46 seconds**. The continuing explanation began with “While you do that I will keep talking about why this is useful…” and added no new edit requirements.

1. **Continuous:** command immediately followed by the explanation; speech ended at **25.62 seconds**. Two runs per prompt.
2. **Paused:** identical audio with two seconds of silence after the command; explanation resumed at **8.46 seconds**, and speech ended at **27.62 seconds**. One run per prompt.
3. **Dictation:** 20.70 seconds of thinking aloud about possible numbered lines, explicitly saying not to edit or delegate because no action had been decided. One run per prompt. Observed for eight seconds after speech ended as well.

### Prompts

1. **Saved:** actual Hub Live prompt at test time. It already said to delegate once the action was clear and sufficiently specified, and that continued speech alone was not a reason to wait.
2. **Stronger early delegation:** preserved the saved voice/listening instructions but replaced the delegation policy with explicit instructions not to wait for silence, sentence completion, or turn completion. Listed composer editing as a backend capability; preserved the dictation/incomplete-request exclusions.
3. **Wait:** preserved the same non-delegation instructions, but explicitly required waiting for the user to finish their thought and pause.
4. **Minimal early delegation:** removed the saved persona, backchannel, and interruption rules. Explicitly permitted delegation while the user continued explaining an already authorized action; retained the exclusions for dictation and unfinished requirements.

Exact prompt snapshots and source speech text are in the local artifact directory below.

## Measurements

All times are **client receipt seconds from the start of paced audio streaming**, not tool execution or speaker playback times. First delegation only:

| Prompt | Continuous, run 1 | Continuous, run 2 | With two-second pause | Dictation delegation count |
| --- | ---: | ---: | ---: | ---: |
| Saved | 26.495 | 26.638 | 7.322 | 0 |
| Stronger early delegation | 26.186 | 26.585 | 7.294 | 0 |
| Wait | 26.769 | 26.296 | 7.313 | 0 |
| Minimal early delegation | 26.476 | 26.445 | 7.293 | 0 |

Continuous-speech delegations arrived **0.566–1.149 seconds after the recording ended**, despite the command being complete about 19 seconds earlier. Paused delegations arrived **0.833–0.862 seconds after the pause began**, before the explanation resumed.

Server delegation offsets were 25,600–26,200 ms for the continuous runs and 6,600 ms for every paused run. These are session-timeline timestamps, not client receipt times. The 25,600 ms value is only 20 ms before the continuous recording's nominal endpoint and does not show a useful early handoff; the corresponding notification arrived after the recording finished. No run provided a delegation during the long explanation before that endpoint.

The saved and stronger-early paused runs also emitted a second delegation after the explanation ended. No backend acknowledgment or result was returned in this experiment, so these repeats should not be interpreted as evidence of duplicate real application actions.

All 16 sessions finalized normally, with no API error events. Final reported voice usage totaled **516 seconds**: approximately **$0.43 at $0.05/minute**, plus speech synthesis. This is an estimate from reported duration and the published voice rate, not an invoice. See [voice cost documentation](https://developers.openai.com/api/docs/guides/voice-latency-cost?api=live).

## Interpretation and limits

For this composer request, the client-delegation notification follows a pause despite materially different delegation instructions. The absence of an early event is upstream of Companion's debounce and backend. A prompt-only change did not produce the desired incremental execution during uninterrupted speech. Keep Live as the delegation decision-maker, but do not promise mid-speech task startup based on the architectural description.

This is a small, controlled test with one synthesized English voice, one positive command, one negative dictation script, and the primary WebSocket transport. Silence compression changes speech rhythm; acoustic quiet detection is not a semantic turn detector. The test does not identify Live's internal trigger, prove a fixed silence threshold, or generalize to every voice, language, task, or transport. Client receipt includes network and service processing delays. No real backend was attached, so the experiment measures initial delegation rather than editing speed or correction handling.

The public architecture description says interaction decisions can include tool invocation during continuous processing ([Introducing GPT-Live](https://openai.com/index/introducing-gpt-live/)). The API announcement describes Live as not turn-based ([API announcement](https://openai.com/index/introducing-gpt-live-1-in-the-api/)). These broad claims do not guarantee early `session.delegation.created` timing. The measured client-event behavior here is the more useful evidence for this specific feature.

## Reproduction and evidence

The opt-in, paid harness is [evaluate-live-delegation.ts](../../apps/drone/scripts/evaluate-live-delegation.ts). It reads the credential through an environment variable or the local Hub SQLite setting and never prints it. `prepare` snapshots the currently saved Live prompt, so exact reproduction of this experiment should reuse the existing artifacts.

```bash
bun apps/drone/scripts/evaluate-live-delegation.ts prepare /tmp/companion-live-delegation-20260915
bun apps/drone/scripts/evaluate-live-delegation.ts run /tmp/companion-live-delegation-20260915 continuous saved 1
```

`run` accepts scenarios `continuous`, `paused`, and `dictation`; prompts `saved`, `early`, `wait`, and `minimal`; and a repetition label. It refuses to overwrite an existing run. A full rerun needs a new output directory or new repetition labels. The harness was build-checked with Bun and exercised by the actual API runs.

Local evidence: `/tmp/companion-live-delegation-20260915/`. Includes `results.json`, `audio-manifest.json`, `prompts.json`, per-run `.jsonl` events and `.summary.json`, input WAV/PCM, original synthesis PCM, and output WAV files. Verified that no configured API key appears in JSON artifacts.

PCM SHA-256 checksums:

- Continuous: `1afab637931f0e2c42cea1f31e682c5eedce39ccc20a9d6fbfd20dad18a4b1a7`
- Paused: `72b12eed5f9d7067deed42e10953d70961eeff1600408b38152a87626d3758a7`
- Dictation: `4915758589aa7478fb4d46c66298b0936c2601c288e820aef92112f29adad34b`

Protocol references: [Live WebSocket streaming](https://developers.openai.com/api/docs/guides/voice-websockets?api=live), [client delegation](https://developers.openai.com/api/docs/guides/live-delegation), and [speech synthesis](https://developers.openai.com/api/docs/guides/text-to-speech).
