# Compaction visibility and regression checks

Companion shows its latest compaction in both the web and mobile overlays, separately from tool calls. The row is visible while compaction runs and retains its outcome until the next request. Completed rows show estimated context sizes and identify fallback summaries. Skipped, failed, stopped, and missing-result outcomes have distinct wording. Closing or starting a new request clears the row; late events for an older request cannot change the current row.

The Companion activity channel forwards only compaction status, estimated sizes, and the fallback flag. It does not forward summaries, provider error text, or metrics. Detailed measurements remain in the runtime events and the existing Companion telemetry report.

## Measurements

Blip's `compaction_completed`, `compaction_skipped`, and new `compaction_failed` events carry optional `metrics`. This applies to built-in and Companion sessions and stored-session compaction through the shared context manager. Fields remain optional so older events can still be read.

| Field | Meaning |
| --- | --- |
| `durationMs` | Monotonic elapsed time from emitting the start event to preparing the terminal event. Includes planning, model calls, validation, and checkpoint persistence; excludes terminal-event delivery. |
| `modelDurationMs` | Sum of time awaiting summary model calls. |
| `modelCallCount` | Summary model invocations, including invocations that throw before returning a response. Includes all summary batches/retries performed by compaction, but cannot count retries hidden inside a provider SDK. |
| `modelResponseCount` | Responses for which usage was observed. A smaller value than call count indicates calls without a returned response. |
| `incompleteModelResponseCount` | Usage responses flagged incomplete by the runtime (error or abort). This does not measure summary correctness or schema validity. |
| `usage` | Sum of reported input, output, cache-read, cache-write, and total tokens. Missing usage is not estimated. These are token quantities, not a dollar-cost calculation. |

`compaction_failed.reason` is `cancelled` or `error`. Original exceptions still propagate to existing error handling. Skips remain distinct from failures. A terminal event is emitted only once for an attempt, and measurements reset at the next start.

The existing `GET /api/companion/telemetry?limit=200` report adds:

- `compaction`: attempt/outcome counts, elapsed and model-time distributions (including p50/p95), measured-attempt count, model calls/responses, reported usage, completed fallback count, and summed estimated before/after sizes.
- `runs[].compactions`: individual attempts with normalized trigger, outcome, duration, size estimates, fallback flag, and available metrics.

Conversation content and provider error strings are excluded from these new telemetry records. An older runtime without terminal metrics can still contribute observed duration and outcomes; `measuredAttemptCount` makes the missing detailed measurements explicit. A run ending without a compaction terminal event closes the pending attempt as cancelled, failed, or interrupted rather than assuming success.

Before/after sizes describe estimated active context. They are not provider billing usage. Aggregated counts reflect the report's selected recent runs, not lifetime totals. The elapsed-time minus model-time difference helps locate local overhead; it is not a CPU benchmark. Fallback counts refer to installed checkpoints, not rejected fallback candidates.

## Automated coverage

- Core observer fixtures verify exact clock arithmetic, multiple model calls, missing/incomplete responses, exclusion of chat usage, resets, skips, and cancellation/failure events.
- Core session fixtures compact twice, resume from durable storage, inspect the next summary/model requests, and check independent persisted measurements. Cancellation during a real summary request installs no checkpoint and emits one measured cancellation.
- Companion continuation fixtures deliberately omit saved instructions from two canned summaries and verify exact instruction restoration in subsequent model requests. The same events feed the transport filter and telemetry report.
- Shared client fixtures cover repeated compaction, each terminal state, queued follow-ups, stale events, disconnect, cancellation, and reset. Shared presentation fixtures cover status wording, estimated counts, and fallback labels.
- Transport and telemetry fixtures check bounded payloads, absence of private fields, mobile event forwarding, legacy records, and aggregation.

Focused checks, after generating any missing workspace package artifacts:

```sh
bun test blip/packages/core/tests/compaction-observer.test.ts blip/packages/core/tests/compaction-observability.test.ts
bun test packages/assistant-chat/tests/companion.test.ts packages/assistant-chat/tests/companion-compaction.test.ts
bun test apps/drone/tests/companion-compaction-continuation.test.ts apps/drone/tests/companion-telemetry.test.ts apps/drone/tests/companion-transport-shared.test.ts apps/drone/tests/companion-device-mesh-capability.test.ts apps/drone/tests/companion-websocket-server.test.ts
```

These fixtures test continuation plumbing and exact saved-instruction restoration. Their canned model responses do **not** establish semantic summary quality or production latency. To compare summarization strategies, run the same real conversation corpus and model settings through each strategy, then compare task completion, lost constraints/corrections, repeated work, exact identifiers, pending tasks, token usage, and latency across repeated runs. Include multiple successive compactions and difficult long-tool-output conversations; judging only summary length would miss damaging omissions.

## Manual verification

On web and mobile, use a Companion conversation long enough to trigger compaction. Confirm the status is visible without expanding tool calls, completion shows estimated sizes, and tool counts remain correct. Stop during compaction and disconnect once to confirm no indicator remains running. Send a queued follow-up to check that old request events do not change its status. Inspect the telemetry endpoint for matching attempts. Check narrow layouts and screen-reader announcements; these require the running applications and were not established by the automated fixtures.
