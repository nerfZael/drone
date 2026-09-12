Native OpenAI-compatible request diagnostics
==========================================

Each new OpenAI Chat Completions response (including OpenRouter) carries
`message.requestMetrics` in the persisted transcript. This is collected after
`onPayload` transforms, immediately before SDK submission. The Hub stores it in
`assistant_blip_entries.entry_json`; no database migration is needed. Existing
messages cannot be backfilled. Other provider adapters do not yet populate it.

Measurements contain no prompt text, tool arguments, tool schemas, credentials,
headers, or raw reasoning. They include:

- `payload.jsonBytes`: UTF-8 size of the serialized final request parameters.
- `payload.messages`: ordered message sizes and roles, with separate content,
  tool-call and reasoning field sizes. Tool-result content appears in tool-role
  messages. Indexes refer to the final transformed request, not transcript rows.
- `payload.tools`: ordered individual tool-definition sizes.
- `estimatedTokens`: JSON character count divided by four, rounded up. This is
  explicitly a heuristic, not exact tokenization, and not an image-token estimate.
  Component sizes omit separators and may overlap message totals; do not sum them
  with their containing message sizes.
- `providerUsage`: allowlisted original numeric usage counters before normalization.
- `responseHeadersMs`, `firstChunkMs`, `firstContentMs`, `durationMs`: monotonic
  offsets from request instrumentation start. First content includes text,
  reasoning or tool-call deltas; the first chunk can be only a role announcement.
- `status`, `chunkCount`, and wall-clock `startedAt` for correlation. Existing
  `responseId`, `responseModel` and message model/provider fields identify the
  upstream completion. Timing includes setup, callbacks and any SDK retries;
  individual retry attempts and server-side queue/prefill/decode are not measured.

Failure/abort responses retain measurements collected up to failure; missing
response timings mean that milestone was not observed. No usage is fabricated.
The existing tool start/completion events provide tool execution duration.

To investigate a token spike, compare final payload bytes, per-message and
schema estimates across adjacent requests with `providerUsage.prompt_tokens`.
A small payload with a huge reported token count is evidence of a discrepancy,
not proof of which upstream component caused it. A large payload reveals which
message or tool schema grew. Compare first-content latency with total duration
to separate waiting for initial output from subsequent streaming.

Example read-only query (bind the target session ID):

```sql
SELECT sequence,
       json_extract(entry_json, '$.message.responseId') AS response_id,
       json_extract(entry_json, '$.message.requestMetrics') AS request_metrics
FROM assistant_blip_entries
WHERE session_id = ?
  AND json_extract(entry_json, '$.message.requestMetrics') IS NOT NULL
ORDER BY sequence;
```
