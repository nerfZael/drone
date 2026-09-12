Companion compaction investigation — 12 September 2026

The observed delay is dominated by sequential model summary calls over large
contexts. Recent progress logs show completed batches and streaming activity;
they do not indicate a single stuck request. All five compactions found in the
latest 200 completed Companion run records ended in cancellation, before a
checkpoint was installed.

Evidence comes from read-only queries of
`data/profiles/default/drone/hub.sqlite`, table
`companion_message_telemetry`, and `data/profiles/default/drone/hub.log`.
Times below are Europe/Zagreb (CEST). Context sizes are the last recorded
heuristic context estimates, not measured summary-input token totals.

| Run started | Message ID prefix | Compaction time | Model time | Calls started | Recorded context tokens |
| --- | --- | ---: | ---: | ---: | ---: |
| Sep 11 23:46:54 | c9a5a57b | 361.169 s | 360.928 s | 8 | 409,941 |
| Sep 12 02:10:10 | 07feaf73 | 95.985 s | 95.869 s | 3 | 553,515 |
| Sep 12 09:58:33 | 9d47323f | 150.755 s | 150.606 s | 5 | 215,664 |
| Sep 12 10:04:13 | 7cefd564 | 53.341 s | 53.243 s | 3 | 344,952 |
| Sep 12 10:05:52 | 97cd6f32 | 41.637 s | 41.574 s | 2 | 232,110 |

Every record reports `gpt-5.6-sol`, medium reasoning, automatic compaction,
and one incomplete model response. More than 99.8% of each compaction's elapsed
time was inside model calls (including transport/provider waiting). This does
not measure reasoning time separately. Cancellation telemetry does not establish
who or what initiated cancellation.

For message `9d47323f-3e84-45a1-af2f-d1aa72dbebfb`, the first four summary
calls finished in 18.4, 39.3, 40.9, and 39.4 seconds. The fifth was cancelled
after 12.7 seconds. The logs show stream events for every call. For the latest
message, the first call completed in 15.0 seconds and the second streamed 847
events before cancellation at 26.6 seconds. These observations support ongoing
generation and sequential batch overhead rather than a frozen compaction UI.

The implementation explains the multiplication of latency:

- `blip/packages/core/src/compaction-settings.ts` defaults to 120,000 transcript
  characters per summary batch, 12,000 per fragment, and a 4,096-token summary
  ceiling. The character limit is not a cap on the total transcript processed.
- `blip/packages/core/src/helpers/compaction-summary-input.ts` visits every
  selected message, splitting large records rather than dropping their contents.
- `blip/packages/core/src/helpers/compaction-summary.ts` awaits each batch and
  sends its resulting checkpoint into the next call. Each batch rewrites the
  structured checkpoint. It inherits the chat model and reasoning level through
  `blip/packages/core/src/context-manager.ts`.
- There is no compaction-specific wall-clock deadline in this path. The existing
  abort signal controls cancellation.
- Only the final validated checkpoint is persisted. Cancellation discards
  intermediate summaries; another attempt on unchanged history must repeat the
  summary work. The observed runs have different session IDs, so the evidence
  does not establish repeated attempts on identical history.
- `packages/assistant-chat/src/companion-compaction.ts` displays the generic
  “Compacting context…” label; it does not display the batch progress available
  in backend telemetry.

Large message input is established; its exact source is not. The recorded
message contribution ranges from 208,005 to 546,144 heuristic tokens, versus
roughly 7,000–10,000 tokens of other context. Several affected runs called
`read_chat`, while another used file reads/searches. Companion uses
`new HubSessionRepository({ inMemory: true, trackUsage: true })`, so the closed
sessions' individual tool-result payloads cannot be reconstructed from the
assistant transcript SQLite database.

One concrete candidate for oversized input is `read_chat` in
`apps/drone/src/hub/mcp-server.ts`: it requests full transcript activity by
default, and `boundedTranscriptTurn` spreads the entire turn while truncating
only `prompt`, `output`, and `error`. Activity, file changes, plans, and other
metadata bypass that per-field bound. `formatTranscriptRow` in
`apps/drone/src/hub/chat-session-runtime.ts` includes those fields. This is a
confirmed bounding gap, but attribution to these particular runs remains
unproven without payload-size measurements.

Recommended follow-up, in priority order:

1. Measure tool-result size by tool/field without retaining content; constrain
   conversational `read_chat` results to a deliberate projection and total
   response budget, with explicit truncation and access to further detail.
2. Benchmark larger context-aware summary batches to reduce serial calls while
   preserving all selected transcript evidence. Separately evaluate a lower
   compaction reasoning level; its speed/quality impact is not measured here.
3. Surface elapsed time and completed/current summary-call counts in Companion.
   Avoid a percentage unless total planned work is known.
4. Consider resumable intermediate checkpoints with history validation. A
   timeout alone bounds waiting but does not make this workload finish faster.

No application code, settings, or running sessions were changed. No model calls
were initiated. Validation consisted of matching persisted timing records to
progress logs and tracing the batching, cancellation, persistence, and input
projection paths in source.
