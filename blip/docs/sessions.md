# Sessions

## Embedding API

`createBlipSession()` creates a long-lived session around an injected `SessionRepository`, model, tool providers, prompt provider, preflight hook, and event sink. The handle supports `prompt`, `steer`, `enqueue`, `abort`, `compact`, `delete`, and `waitForIdle`.

`runBlipTask()` is the Node file-backed compatibility wrapper used by the CLI. It supplies
`SessionStore`, local profile tools, and local file telemetry. The CLI separately injects its own
prompt provider.

`SessionRepository` is the persistence boundary. `SessionStore` is the Node file-backed
implementation; Drone Hub and Android supply host-specific implementations.

Blip uses **session** as the canonical persisted unit of work.

A session stores model settings, workspace root, permission mode, active tool profile, file-operation metadata, and a JSONL transcript. The raw transcript remains on disk even when compaction changes the model-visible context.

## Storage

Sessions live under:

```text
<blip-data-dir>/sessions/<workspace-hash>/<session-id>/
```

The default data directory is platform-specific:

- Linux: `$XDG_DATA_HOME/blip`, or `~/.local/share/blip` when `XDG_DATA_HOME` is unset.
- macOS: `~/Library/Application Support/blip`.
- Windows: `%LOCALAPPDATA%\blip`, falling back to `%APPDATA%\blip` and then `~/AppData/Local/blip`.

Set `BLIP_DATA_DIR` to override the root explicitly.

Each session has:

- `session.json`: session metadata.
- `transcript.jsonl`: append-only transcript entries.

The runtime uses `SessionStore` in `blip/packages/core/src/session-store.ts`.

## Session Metadata

Current metadata shape:

```ts
interface BlipSessionState {
  id: string;
  workspaceRoot: string;
  modelProvider: string;
  modelId: string;
  permissionMode: 'read-only' | 'workspace-write' | 'full-access';
  toolProfile: 'local-trusted-write' | 'read-only' | 'no-shell-workspace-write';
  loadedSkills: string[];
  transcriptPath: string;
  compactedSummary?: string;
  changedFiles: string[];
  readFiles: string[];
  parentSessionId?: string;
  forkedFromEntryId?: string;
  providerSessionId?: string;
  providerThreadId?: string;
  createdAt: string;
  updatedAt: string;
}
```

`compactedSummary` stores the latest summary for metadata/debugging. The runtime does not inject this field into the system prompt. Model-visible compacted context is reconstructed from the latest compaction transcript entry.

## Transcript Entries

The transcript is JSONL and currently stores:

- `message`: persisted user, assistant, and tool-result messages.
- `runtime_event`: events emitted by the runtime.
- `compaction`: summary checkpoints with `firstKeptEntryId`.

Compaction does not delete earlier transcript entries.

## Tool output previews

By default, `createBlipSession()` retains at most 24,000 source text characters per tool result
and 48,000 across results from one assistant tool-call batch, plus short omission/retrieval
notices. Small results keep their allowance; remaining capacity is shared among larger results.
These are character budgets, not exact tokenizer limits or a whole-conversation token ceiling.
The shared core policy covers MCP, browser/custom, and workspace tools, including fresh results.
Images and other non-text blocks, error flags, and structured `details` remain intact.

Older successful text-only results larger than 12,000 characters still receive smaller previews:
normally the first 3,000 and last 1,000 characters. The two newest batches, errors, skills,
instruction reads, and retrieval results are exempt from this additional age-based reduction,
but remain subject to the fresh-result and batch budgets. Instruction previews explicitly tell
the agent to retrieve omitted instructions before acting on them; failure previews retain a
failure notice. User/assistant messages and host-transformed or unpaired injected results are
not truncated. Previews preserve both ends without splitting Unicode surrogate pairs.

The complete original result stays in the transcript. The model can call `read_tool_output` with
the original `call_id`, a zero-based character `offset`, and an optional `limit` (at most 12,000)
to retrieve a page, including after compaction or resume. This returns saved historical output;
it never repeats the original command. Text blocks are joined with newlines for offsets; images
do not consume text offsets. Page bounds are validated at execution as well as in the schema.
Retrieval is scoped to the current session. Host permission preflight still applies. Raw history
shown in the UI remains unchanged. Summary generation and deterministic fallback use the same
tool-output projection, so compaction does not reintroduce omitted megabytes. The summary prompt
requires retaining relevant recovery handles and treating omitted evidence as incomplete.

This is a deterministic request transformation and makes no additional model call. Retrieving
omitted evidence can require another tool/model round trip. The recovery tool adds a small tool
definition to requests, even before any output needs shortening. Embedders can set
`pruneToolOutputs: false` to disable previews in normal requests and compaction, and disable the
recovery tool. The stored-session compaction API also accepts this option. When enabled,
`read_tool_output` is a reserved tool name.

## Active history reads

The repository's optional `readActiveTranscript()` returns the latest checkpoint, its retained
tail and pinned user instruction, and messages after it. Core context accounting and compaction
use this path; older repository implementations fall back to `readTranscript()`. Raw history,
forks, and UI history retain their complete transcript APIs.

- The Node JSONL store reads backward in 64 KiB blocks and stops once all retained references
  have been found. A distant pinned instruction can require scanning farther back. Before the
  first checkpoint, it still scans the complete file.
- Hub SQLite uses partial indexes to find checkpoints, retained messages, and instruction IDs.
  Reads use a database snapshot, so no cached boundary can become stale after edits. Existing
  databases create these indexes on first open; this adds startup work and some index storage.
- The mobile repository walks its in-memory transcript backward to the retained boundary. It
  still keeps and persists full history; this optimization does not reduce snapshot storage.

Missing or invalid retained references preserve the full-message fallback. The optional
`readToolResult()` retrieves original output independently of the active boundary; older embedded
repositories can support recovery through the full-transcript fallback.

To manually verify: produce a large successful tool result, run two subsequent tool-call batches,
then ask for a detail in the omitted middle. Check that the model retrieves the saved text and that
the UI still shows the original output. Repeat after compaction and reopening the session; also
confirm a large skill read or failed command stays intact.

## CLI Session Commands

Implemented session flags:

| Command                           | Behavior                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `blip "task"`                     | Starts a new session.                                                                  |
| `blip --continue "task"`          | Uses the latest session for the workspace, or starts a new one if none exists.         |
| `blip --resume "task"`            | Same current behavior as `--continue`.                                                 |
| `blip --session <id> "task"`      | Loads an exact session id.                                                             |
| `blip --fork <id> "task"`         | Creates a new session seeded with the source transcript and records `parentSessionId`. |
| `blip --list-sessions`            | Lists sessions for the workspace.                                                      |
| `blip --compact [--session <id>]` | Runs compaction on the selected or latest session.                                     |

`--continue`, `--resume`, `--session`, and `--fork` are mutually exclusive for task runs.

## Android Persistence

Android stores a bounded visible-message projection for rendering and a separate complete Blip
session per thread. Transcript entries are written as immutable chunks in the app's private document
directory, while a small state file is atomically replaced. Its React Native repository restores
compaction summaries and retained message boundaries, while legacy threads migrate their previously
saved visible history when they are next used.

## Current Gaps

- `--resume` does not yet provide an interactive picker; it behaves like latest-session resume.
- `forkedFromEntryId` exists in the schema but the CLI does not expose a way to fork from a specific transcript entry.
- There is no in-place session tree navigation.
