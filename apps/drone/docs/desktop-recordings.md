# Desktop audio recordings

Open **Recordings** in the desktop sidebar header, enter an optional title, and choose **Record desktop + mic**. Stop from the same dialog. The header shows a red timer while recording; collapsing the sidebar keeps a floating stop control visible. When viewing another device, these controls still record the local desktop. A configurable **Record desktop audio and microphone** action is available in shortcut settings, initially unbound. It uses the existing shortcut infrastructure, including its existing global-shortcut availability checks.

Requires Linux, FFmpeg (with PulseAudio, FLAC and libmp3lame support), ffprobe, pactl, a running PipeWire/PulseAudio session, and configured GROQ and OpenAI API keys. Fully quit and reopen the desktop after updating it, since a renderer reload cannot install the new main-process handlers.

Microphone and desktop audio are captured independently in one FFmpeg process. Pulse timestamps, `-isync`, and resampling put both on a common timeline. Capture pins the default input and output chosen at start. It does not automatically move to newly selected audio devices. Thirty-second FLAC segments are written to disk. A helper process stops FFmpeg when the desktop control pipe closes, including on a desktop crash. It also stops capture after 30 seconds without a successful Hub heartbeat, before the Hub permits recovery actions. Closing just the recordings dialog or reloading the renderer continues recording; quitting the desktop stops capture. Processing can continue in the Hub daemon after desktop exit.

## Transcription and files

The optional live preview sends completed microphone and system chunks to GROQ, labeled **You** and **Desktop**. After stop, microphone segments retain **You**; OpenAI `gpt-4o-transcribe-diarize` assigns anonymous speaker numbers to the system track. Concurrent speech is preserved when the timestamped segments are merged. Successful chunk results are cached for retries. Speaker numbers reset for each recording; no voiceprints or enrolled identities are stored.

Original capture is staged outside Companion home. On stop, a bundle is published under the existing Companion home:

```text
transcripts/YYYY/MM/<timestamp>-<uuid>/
  transcript.json
  transcript.md
  microphone.flac  # when retained
  system.flac      # when retained
```

`transcript.json` is canonical and includes schema version, stable ID, title, timing, status, provider/model information, segment source/speaker IDs, errors and retention state. Markdown is the readable Companion view. Renaming changes metadata, preserving file references. There is no separate recordings database. Small capture manifests can remain in the bundle; capture chunks and provider caches are removed after successful processing.

Audio is retained on capture or processing failure even with **Keep original audio** off. The complete transcript is committed before retention removes audio. Stop is acknowledged after saving a durable completion record; slow live preview requests can delay processing but do not delay that acknowledgement. After an interrupted session, **Retry processing** becomes available once its capture heartbeat is stale (about one minute), or immediately if a saved completion record establishes that capture stopped. A crashed capture may lose the last unfinalized segment. Processing interrupted by a Hub restart can also be retried. Failed capture is never silently represented as a complete recording: its interruption notice remains in the resulting transcript.

The recordings view supports reading and renaming transcripts, asking Companion, opening HomeFiles, retrying, exporting a `.tar.gz` bundle, deleting audio, and deleting the recording. Export requires `tar` and streams without buffering the audio in the browser. A recording survives clearing Companion sessions. Companion's ordinary HomeFiles tools can read/search transcripts; direct writes, patches, moves, deletions and transfer destinations overlapping `transcripts/` are blocked. Other home files keep their existing write access. Explicitly granted additional workspaces retain their own existing policies.

## Limits

- Audio leaves the device: microphone transcription uses GROQ and system diarization uses OpenAI. Live preview additionally sends system audio to GROQ. Turning preview off avoids that additional processing.
- Separate tracks do not remove acoustic echo or application sidetone. Use headphones and disable microphone monitoring. There is no automatic echo removal or heuristic deletion of similar utterances, since it could remove real overlapping speech.
- Muting inside Discord/Meet leaves the recorder's microphone active. Muting the system input affects the recorder too. Routing a silent microphone to other applications was a later-stage proposal and is not included.
- Each system-audio request covers up to 90 minutes as a 32 kb/s mono MP3, below the provider upload limit. Longer recordings get explicit warnings: anonymous speaker numbers are independently assigned per part, so a person can receive another number later. These are approximate model labels, not verified identities.
- Final microphone transcription reuses 30-second chunks; sentences crossing a boundary may be less accurate. Live preview is provisional and can lag when the provider is slow.
- Local diarization, other desktop operating systems, and automatic audio-device switching are not included.

Provider format references: [OpenAI diarized transcription](https://developers.openai.com/api/docs/guides/speech-to-text) and [GROQ timestamped transcription](https://console.groq.com/docs/speech-to-text). Capture synchronization follows the [FFmpeg input synchronization documentation](https://ffmpeg.org/ffmpeg.html#Main-options).

## Verification

Focused tests cover real FFmpeg segmentation/combination with generated audio and mocked provider responses, both-track transcript merging, provider failure/retry caching, interrupted cache recovery, retention, stable bundle paths, traversal/symlink rejection, Companion write restrictions, IPC ownership, duplicate starts and capture termination when its control pipe disappears. Additional lifecycle tests cover lease expiry, broken logging pipes, stop acknowledgement during slow preview, restart recovery and replaying stop after deletion. UI tests cover provisional labels, final speakers, spoken markup, processing, empty and error states, and keeping Stop available during unrelated requests. These tests do not establish real hardware behavior or provider quality.

Manual checks on the Linux desktop:

1. Record a Discord/Meet call with headphones while speaking; confirm both tracks, relative timing, and anonymous speakers. Repeat with YouTube plus microphone. Check speakers/sidetone separately for echo.
2. Stop via the button and a configured shortcut. Reload the renderer, collapse the sidebar and switch device views while recording; verify the timer and stop controls. Quit and confirm capture stops.
3. Try a missing dependency, muted system input, missing credentials and a provider/network failure. Confirm clear errors, saved audio, and successful retry after fixing the issue.
4. Restart the Hub or interrupt capture. Verify recovery notices and retry. Change/disconnect an audio device and check the pinned-device behavior and any capture error.
5. Try retention on/off, rename, bundle export, delete audio, and delete recording. Clear Companion and confirm earlier transcripts remain accessible. Ask Companion to summarize and then try a direct transcript edit to verify its read-only policy.
6. Use a long recording and concurrent speech to assess timestamp drift, chunk boundaries, processing time and the over-90-minute speaker warning.
