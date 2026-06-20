# Runtime Events And JSONL

Blip emits runtime events from `@blip/core`. The CLI renders those events for humans, or writes each event as JSON when `--jsonl` is enabled.

## Event Envelope

Every event has:

```ts
{
  version: 1;
  type: string;
  sessionId: string;
  turnId?: string;
  timestamp: string;
}
```

`timestamp` is an ISO string.

## Implemented Events

Session lifecycle:

- `session_started`
- `turn_started`
- `assistant_delta`
- `assistant_message`
- `session_error`
- `session_finished`
- `process_diagnostics`

Tool lifecycle:

- `tool_call_started`
- `tool_call_progress`
- `tool_call_completed`
- `tool_call_failed`
- `agent_results_delivered`

`tool_call_progress` is emitted for tool partial updates. For the `agent` tool, Blip derives progress from child-agent tool activity instead of asking child agents to write status reports. The progress `message` is a compact coverage summary, and `details` includes the agent run id, agent id, task, status, and coverage such as read files, changed files, search queries, listed paths, bash commands, and per-tool counts.

While agent runs are active, Blip also injects compact runtime-generated agent context into the parent model context before each parent model request. Running agents appear as an ephemeral status digest so the parent can avoid duplicate discovery. Completed non-blocking agent runs are delivered once as compact result context, without spending a model-chosen tool turn on `agent collect`. Delivery emits `agent_results_delivered`; the delivered context itself is ephemeral and is not persisted as a transcript message.

Compaction:

- `compaction_started`
- `compaction_completed`
- `compaction_skipped`

## JSONL Mode

`blip --jsonl "task"` writes one JSON event per line to stdout.

Human diagnostics that are not part of JSONL mode are rendered by the CLI to stderr in normal mode. Assistant text deltas are streamed to stdout in normal mode.

## Human Rendering

The CLI currently renders a small subset of events:

- Session start.
- Assistant deltas.
- Tool start and tool failure.
- Session errors.
- Session finish.
- Process diagnostics emitted after session finish when the process remains alive past the watchdog delay.
- Compaction completion or skip.

Other events are still available in JSONL mode.

For one-shot CLI prompt runs, Blip emits an immediate `process_diagnostics` snapshot after `session_finished`, then flushes stdout/stderr and exits explicitly. This preserves handle/request debugging clues without waiting for provider keepalive sockets to close. Embedders that call the runtime directly can still opt into delayed process diagnostics.

## Status Semantics

`tool_call_failed` records an individual failed tool call. A failed tool does not by itself make the session fail if the model recovers and produces a final answer. Recovered tool failures are included on `session_finished.toolFailures`. For `bash`, a command that exits non-zero or times out is recorded as `tool_call_failed` even though stdout/stderr are still returned to the model as the tool result.

`session_finished.status` is `error` for assistant/model/runtime failures that prevent a clean completion.

`session_finished.timing` contains a performance summary for the run:

- total run duration
- tool call count, completion count, and failure count
- tool wall time, summed tool time, and non-tool wall time
- turn count, single-tool turn count, parallel-tool turn count, and max tools in one turn
- per-tool call counts and summed durations
- longest tool call

Use `timing.nonToolWallMs` versus `timing.toolCallWallMs` to distinguish model/orchestration time from time actually spent executing tools. Use `parallelToolTurnCount`, `singleToolTurnCount`, and `maxToolsInTurn` to track whether Blip is batching independent tool calls effectively.

`session_finished.contextUsage` contains the estimated model context size at the end of the turn:

- `tokens`: estimated context tokens
- `contextWindow`: selected model context window
- `percent`: estimated context percentage used

## Current Gaps

- Event schemas are TypeScript types, not generated JSON Schema.
- Provider billing token usage and cost are not included in events.
- There are no approval events because Blip has no approval flow.
- There is no server protocol around these events.
- If the process crashes hard, Blip may not emit a final `session_error` or `session_finished`.
