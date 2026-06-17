# Blip Sessions, Threads, Chats, And Conversations

## Purpose

Different coding agents use different names for the same general idea: a persisted interaction between a user and an agent.

Blip should use one canonical term internally: **session**.

## Blip Terminology

| Term | Blip Meaning | Use In Blip? |
| --- | --- | --- |
| Session | The canonical persisted unit of work. Contains messages, model settings, workspace root, tools, compacted summary, and metadata. | Yes |
| Conversation | Generic product-language synonym for a session. Useful in prose, not code. | Limited |
| Chat | UI view of a session transcript. A chat is how a user sees or interacts with a session. | UI only |
| Thread | External/provider/runtime term for a resumable backend conversation or agent runtime handle. | Avoid internally |
| Turn | One user input plus the agent response and any tool loop needed to answer it. | Yes |

## Recommended Rule

Use **session** in Blip code, docs, CLI flags, filenames, and persisted records.

Examples:

- `blip --session <id>`
- `blip --continue`
- `blip --resume`
- `blip --fork <id>`
- `sessions/<session-id>/transcript.jsonl`
- `SessionState`
- `SessionEvent`

Use **chat** only when describing UI.

Use **thread** only when adapting to an external system that already uses that word. If an external provider returns a thread id, store it as provider metadata, for example `providerThreadId`, not as Blip's primary session id.

## Blip Session State

Recommended v1 session state:

```ts
interface BlipSessionState {
  id: string;
  workspaceRoot: string;
  modelProvider: string;
  modelId: string;
  permissionMode: "read-only" | "workspace-write" | "full-access";
  loadedSkills: string[];
  transcriptPath: string;
  compactedSummary?: string;
  changedFiles: string[];
  parentSessionId?: string;
  forkedFromEntryId?: string;
  providerSessionId?: string;
  providerThreadId?: string;
}
```

`parentSessionId` and `forkedFromEntryId` are optional because only forked sessions need them. `providerSessionId` and `providerThreadId` are optional because provider naming differs. Blip's own id remains `id`.

## V1 Session Commands

Blip should support these session commands in v1:

| Command | Meaning | Recommended Behavior |
| --- | --- | --- |
| `blip --continue` | Continue the most recent session for the current workspace. | Fast path for "keep going". Create a new session only if none exists. |
| `blip --resume` | Choose a previous session to reopen. | Interactive picker when available; simple list-and-select fallback is acceptable. |
| `blip --session <id>` | Open one exact session. | Best for scripts and copied resume commands. |
| `blip --fork <id>` | Copy an existing session into a new session and continue from the copy. | Preserve parent metadata and start with a new Blip session id. |

`--continue`, `--resume`, `--session`, and `--fork` should be mutually exclusive.

Forking in v1 should be useful but narrow. It should copy the source session's usable context into a new session, record `parentSessionId`, and optionally record `forkedFromEntryId` when the fork starts from a specific transcript entry. Blip v1 does not need Pi-style in-place tree navigation or multiple active branches inside one file.

## Comparison

### Pi

Pi is session-oriented.

Observed behavior:

- CLI flags include `--session`, `--session-id`, `--session-dir`, `--resume`, `--continue`, `--fork`, and `--no-session`.
- Session files are persisted and can be selected, resumed, forked, and exported.
- Core types and modules use names like `AgentSession`, `SessionManager`, and `agent-session-runtime`.

Inferred rationale: Pi treats a coding interaction as a local resumable session. This fits a CLI-first product because users often leave and return to repository work.

Pros:

- Clear mental model for CLI users.
- Works well with local files and local transcripts.
- Supports resume/fork/export naturally.

Cons:

- "Session" can also mean auth/session in other systems, so names should be specific where needed.

### OpenCode

OpenCode uses session-oriented runtime concepts and chat/product concepts around the UI.

Observed behavior:

- Runtime files include session and agent concepts.
- Storage includes session summaries and diffs.
- The product has richer UI and event concepts than a small CLI-only agent.

Inferred rationale: OpenCode has a broader product surface, so it needs session state plus UI-facing abstractions.

Pros:

- Strong fit for richer app state.
- Can connect sessions, summaries, diffs, and UI events.

Cons:

- More terminology can be harder to follow from the outside.
- Blip v1 does not need all of that product structure.

### Codex

Codex uses multiple terms in different layers.

Observed behavior:

- The Rust code includes `CodexThread`, `ThreadManager`, `thread_id`, and thread-manager examples.
- MCP/server docs and code also describe running a Codex **session** and continuing a Codex **conversation** by thread id.
- TUI code uses chat-oriented names for the interactive user interface.

Interpretation:

- **Thread** often means the resumable runtime/backend handle.
- **Session** often means the configured run or active agent execution context.
- **Conversation/chat** often describe the user-facing message history or UI experience.

This is powerful but can be confusing because the terms overlap.

Pros:

- Thread ids are useful for app/server and multi-agent orchestration.
- Session and conversation language can fit different API surfaces.
- Chat terminology makes sense in a TUI.

Cons:

- The same user-visible concept can appear under several names.
- It is harder for outside readers to know whether thread, session, and chat are identical.
- Blip does not need that complexity in v1.

## Blip Choice

Blip should use **session** as the canonical term.

Why:

- Blip is CLI-first, like Pi.
- Session maps naturally to resume, continue, fork, transcript, and compaction.
- Chat is better reserved for UI.
- Thread should be reserved for external systems that already use thread ids.

Pros:

- Clear CLI vocabulary.
- Easier docs and code search.
- Avoids Codex-style term overlap.
- Leaves room to store provider thread ids without adopting the word internally.

Cons:

- Future integrations may need adapters to translate from Blip sessions to external threads.
- UI surfaces may still want to say chat for user-facing labels.

## Open Questions

- Should session ids be UUIDs, timestamp slugs, or human-readable names plus ids?
- Should session storage be one JSONL file or a directory with metadata plus transcript?
