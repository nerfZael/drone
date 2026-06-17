# Blip Runtime Events And JSONL

## Purpose

Runtime events are structured updates emitted by Blip while a session is running.

They let the CLI render progress without parsing assistant text, and they let other programs consume Blip output without scraping terminal UI.

JSONL output should be part of v1.

## V1 Decision

Blip v1 should support both:

- internal TypeScript runtime events between `core` and `cli`
- `--jsonl` output that writes the same event stream as newline-delimited JSON

This is not a full server protocol. It is a simple process IO contract.

## Why JSONL In V1

JSONL is useful early because it makes Blip easy to integrate with:

- shell scripts
- DroneHub
- VoiceStream later
- test harnesses
- CI jobs
- editor or desktop wrappers

Those integrations can run Blip as a child process and read structured events line by line.

## CLI Modes

Recommended v1 modes:

```bash
blip "fix the failing test"
blip --jsonl "fix the failing test"
```

Normal mode renders human-friendly terminal output.

`--jsonl` mode writes one JSON object per line to stdout. Human diagnostics that are not part of the event stream should go to stderr.

## Event Envelope

Every event should have a stable envelope:

```ts
interface BlipRuntimeEvent {
  version: 1;
  type: string;
  sessionId: string;
  turnId?: string;
  timestamp: string;
}
```

Event-specific fields are added per type.

Example:

```jsonl
{"version":1,"type":"session_started","sessionId":"s_123","timestamp":"2026-06-06T12:00:00.000Z","workspaceRoot":"/repo","model":"gpt-5.3-codex"}
{"version":1,"type":"assistant_delta","sessionId":"s_123","turnId":"t_1","timestamp":"2026-06-06T12:00:01.000Z","text":"I will inspect the failing test."}
{"version":1,"type":"tool_call_started","sessionId":"s_123","turnId":"t_1","timestamp":"2026-06-06T12:00:02.000Z","tool":"read_file","callId":"call_1","args":{"path":"src/app.ts"}}
```

## V1 Event Types

### `session_started`

Emitted when Blip starts or resumes a session.

Fields:

- `workspaceRoot`
- `model`
- `permissionMode`
- `resumed`

### `turn_started`

Emitted when a new user turn starts.

Fields:

- `turnId`
- `prompt`

In `--jsonl`, consider redacting or omitting `prompt` later if privacy controls need it. For v1 local CLI, include it.

### `assistant_delta`

Emitted for streaming assistant text.

Fields:

- `turnId`
- `text`

### `assistant_message`

Emitted when an assistant message is complete.

Fields:

- `turnId`
- `messageId`
- `text`

### `tool_call_started`

Emitted when a tool call begins.

Fields:

- `turnId`
- `callId`
- `tool`
- `args`

### `tool_call_progress`

Emitted for optional progress updates from long-running tools.

Fields:

- `turnId`
- `callId`
- `tool`
- `message`
- `details`

### `tool_call_completed`

Emitted when a tool call succeeds.

Fields:

- `turnId`
- `callId`
- `tool`
- `result`

### `tool_call_failed`

Emitted when a tool call fails.

Fields:

- `turnId`
- `callId`
- `tool`
- `error`

### `approval_requested`

Reserved for future approval-gated tools.

Fields:

- `turnId`
- `callId`
- `tool`
- `reason`
- `args`

### `compaction_started`

Emitted when context compaction begins.

Fields:

- `turnId`
- `reason`

### `compaction_completed`

Emitted when context compaction completes.

Fields:

- `turnId`
- `summaryId`
- `tokensBefore`
- `tokensAfter`

### `session_error`

Emitted for session-level failures.

Fields:

- `error`
- `recoverable`

### `session_finished`

Emitted when the run settles.

Fields:

- `status`: `completed`, `cancelled`, or `error`
- `changedFiles`
- `durationMs`

## JSONL Rules

- Emit exactly one JSON object per line.
- Do not pretty-print JSON in `--jsonl`.
- Keep stdout reserved for JSONL events.
- Send logs, warnings, and human diagnostics to stderr.
- Include `version` on every event.
- Keep event names stable.
- Add fields instead of changing field meaning.
- Do not include ANSI terminal formatting in JSONL fields.

## Error Handling

If Blip crashes after JSONL mode starts, it should try to emit `session_error` and `session_finished` with `status: "error"`.

If that is not possible, the process exit code is still authoritative.

## Comparison

### Pi

Pi's agent core is evented and its CLI renders those events for users. This is a good local architecture, but JSONL process output is not the main product contract.

Blip should adopt the evented core idea and expose it directly through JSONL in v1.

### OpenCode

OpenCode has richer session and event concepts because it supports a broader product surface. That makes it easier for UI/runtime layers to stay synchronized.

Blip should adapt the event separation, but keep the first external contract as simple JSONL instead of a larger app protocol.

### Codex

Codex has deeper protocol and app-server concepts. It can model threads, turns, tool calls, approvals, compaction, and UI state as structured events.

Blip should take the structured-event lesson but avoid building a server protocol in v1.

## Blip Choice

Blip v1 should expose JSONL because it is cheap, useful, and keeps integrations possible without committing to a server architecture.

Internal runtime events and JSONL output should share the same event model. The CLI can render events for humans, while `--jsonl` can stream them for machines.

## Open Questions

- Should `--json` exist for one-shot final output, or is `--jsonl` enough?
- Should prompts and tool args be redacted by default in JSONL?
- Should JSONL include token usage and cost fields in v1?
- Should event schemas be exported from `blip/packages/core` or a separate package later?
