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

Tool lifecycle:

- `tool_call_started`
- `tool_call_progress`
- `tool_call_completed`
- `tool_call_failed`

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
- Compaction completion or skip.

Other events are still available in JSONL mode.

## Current Gaps

- Event schemas are TypeScript types, not generated JSON Schema.
- Token usage and cost are not included in events.
- There are no approval events because Blip has no approval flow.
- There is no server protocol around these events.
- If the process crashes hard, Blip may not emit a final `session_error` or `session_finished`.
