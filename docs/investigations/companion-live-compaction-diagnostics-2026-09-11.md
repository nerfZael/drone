# Live Companion compaction diagnostics

`GET /api/companion/telemetry` now includes `activeCompactions` alongside the
existing completed-run report. Active compactions appear immediately, before
the summary call or the containing Companion run finishes.

Each record includes run/message/session IDs, model and reasoning level, start
time, elapsed time, phase, summary-call and response counts, current or most
recent call duration, cumulative model time, and model stream event count.
Phases are `preparing`, `credentials`, `summarizing`, `validating`, and `saving`.

Read a stalled operation as follows:

- `modelCallActive: true` with `modelEventCount: 0`: no stream event has been
  observed yet. Call setup, transport, retries, and provider waiting are combined.
- An increasing `modelEventCount`: the provider stream is producing events.
  Events can include reasoning or status; they do not necessarily represent
  usable summary text.
- Increasing `modelIdleMs`: time since the last reported stream event. Activity
  updates are throttled to once per five seconds after the first event, so this
  is approximate between updates. The field is absent before the first event.
- An increasing `modelCallCount`: sequential summary batches are progressing.
  Counts are not a percentage; later batch sizes depend on the carried summary.
- A non-model phase with increasing `lastProgressAgeMs`: inspect that preparation,
  credential, validation, or persistence step rather than model generation.

Hub logs emit `Companion compaction progress` for phase transitions, model call
boundaries, throttled stream activity, terminal events, and a heartbeat every
15 seconds while active. The live registry holds at most 100 compactions. Timers
stop once it is empty; completion, failure, cancellation, and run termination
remove active entries. Late events cannot reactivate a finished run.

All new progress payloads contain counters and status metadata only. Transcript,
summary, reasoning text, provider error bodies, and credentials are omitted.
Existing final usage measurements and compaction decisions remain in place.
This adds observability, not a new deadline or automatic cancellation policy.

The endpoint and heartbeat run on the Hub's event loop: they can be delayed by
an event-loop stall. Compare their timestamps with `hub event loop stall` logs.
A server restart loses active records, while emitted logs remain available.

Build `@blip/protocol`, then `@blip/core`, then the Hub to deploy this change.
Restarting the Hub interrupts in-memory Companion conversations; source changes
do not instrument an already-running compaction retroactively.
