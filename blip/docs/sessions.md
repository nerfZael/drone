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
