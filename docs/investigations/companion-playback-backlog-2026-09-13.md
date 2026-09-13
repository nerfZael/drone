# Mobile Live playback backlog recovery

## Incident

At 18:38:44.992 Europe/Zagreb on September 13, the physical phone logged a
`DroneLiveVoice.playPcm` rejection: `Live voice playback fell behind. Start again.`
The app was backgrounded. The Hub recorded `remote-closed` for audio session
`0d4d946f-4061-4f15-935f-9a091e417dc4` after 219005 ms; the backend task completed
at 18:38:47.034. Android's playback track logged underrun restarts at
18:38:38.990 and 18:38:42.306. Headset audio teardown followed the app error.

The confirmed trigger is the native playback queue limit (240000 bytes, five
seconds of PCM16 mono at 24 kHz, or 100 pending chunks). The old enqueue path
threw, and the installed mobile hook stopped Live on any audio error. These
logs do not distinguish an arrival burst from delayed device playback as the
underlying cause of the backlog. They also do not identify which limit fired.
Raw phone logs were saved outside the repository at
`/tmp/companion-disconnect-20260913/phone.log`.

## Change

On Android queue overflow, remove stale pending speech, retain the local start
cue and any write already in flight, and enqueue current speech if it fits the
existing bounds. Capture and the Live connection stay active. Recovery can skip
speech; it does not reconstruct the omitted audio. Log dropped and retained
byte counts without speech content.

After overflow, a native Handler deadline checks for successful device writes.
If output makes no progress for five seconds and still has pending audio,
report an output-stall error to the existing mobile reconnect path. Stop cancels
the deadline. This detects a stuck write without trying to pause or re-route
headset audio from the enqueue path. Normal write errors still use reconnect.

The existing reconnect change (`08af9a5d`) postdates the incident and was absent
from the phone's installation at investigation time. Both changes must be in
the installed build to obtain recovery plus automatic reconnect.

## Validation

The native JVM suite compiles production PCM code against Android APIs and runs
it against a controllable audio device. Byte-limit and chunk-limit regressions
block output, overflow the queue, check that capture continues and stale speech
is removed, resume output, and verify current speech plays without an error.
They cover repeated overflow, stop during a blocked write, recovery-deadline
cancellation, and a permanently stalled output producing an error at five
seconds. Existing cue, route, playback-order, partial-write, and media-control
checks also pass.

Mobile connection, lifecycle/reconnect, and audio tests pass when run as separate
Bun processes. Running these files together leaks their module mocks and fails
seven audio tests; isolated execution passes all 37 tests.

This change has not yet been installed or verified on the physical headset.
