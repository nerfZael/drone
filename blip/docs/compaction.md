# Blip Context Compaction

## Purpose

Compaction lets Blip continue long coding sessions without sending the full transcript back to the model forever.

The v1 goal is a reliable local handoff system, not a general memory platform. Blip should preserve the facts needed to continue coding safely, keep recent work verbatim, and remove old conversational detail that no longer helps.

## V1 Scope

Blip should support **local anchored compaction** in v1.

This is more than a manual summary command. V1 should include the core algorithm, session state, prompt contract, context assembly behavior, and CLI feedback needed for real long-running coding work.

V1 behavior:

- Keep a rolling structured summary for older context.
- Keep the newest work verbatim by token budget and by recent turn count.
- Preserve exact file paths, symbols, commands, errors, user instructions, repo rules, decisions, changed files, open tasks, and risks.
- Preserve read-file and modified-file lists as structured compaction metadata, not only prose.
- Update the previous summary on repeated compactions instead of replacing it blindly.
- Never compact while a tool call, approval, cancellation, or unresolved error is active.
- Keep the full raw transcript on disk for audit, replay, and future debugging.
- Make compaction visible in the CLI and persisted session events.

V1 does not need:

- remote compaction services
- pre/post compaction hooks
- background compaction while a turn is still running
- multi-summary trees
- semantic memory
- cross-session memory
- provider-specific compaction APIs

## Triggers

Use manual compaction plus a deterministic local pre-turn trigger. When compaction runs, Blip should ask the active model for a structured summary and fall back to a deterministic local summary if that fails.

Recommended v1 triggers:

- Manual CLI command: `/compact`
- Automatic local compaction before the next model call when estimated usage exceeds `contextWindow - reserveTokens`

Default settings:

```ts
{
  auto: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
  keepRecentTurns: 2
}
```

Rationale:

- Manual `/compact` keeps behavior debuggable.
- Pre-turn auto-compaction prevents avoidable context-window failures without adding background jobs.
- Keeping both recent tokens and recent turns avoids cutting away a short but important latest exchange.

These defaults should be configurable later, but v1 can start with constants and a clear session event.

## Session State

Store compaction as a first-class session entry, not only as text injected into the prompt.

Recommended shape:

```ts
type CompactionEntry = {
  type: "compaction";
  id: string;
  createdAt: string;
  trigger: "manual" | "auto";
  tokensBefore: number;
  tokensAfterEstimate?: number;
  firstKeptEntryId: string;
  summary: string;
  details: {
    readFiles: string[];
    modifiedFiles: string[];
  };
};
```

The raw transcript remains unchanged. Runtime context is assembled from:

1. Built-in system/developer instructions.
2. Current repo instructions and selected skills.
3. The latest compaction summary, if present.
4. Verbatim session entries from `firstKeptEntryId` onward.

This mirrors the useful part of OpenCode's "latest compaction plus later messages" model while keeping Blip's transcript simple.

## Boundary Selection

Choose a boundary with a deterministic algorithm before asking the model to summarize.

Algorithm:

1. Estimate current context tokens from the latest provider usage when available.
2. Add estimated tokens for messages after the last provider usage.
3. Find the latest previous compaction entry, if any.
4. Start the candidate range after the previous compaction's `firstKeptEntryId`; otherwise start at the beginning of the session transcript.
5. Keep at least `keepRecentTurns` complete user turns when possible.
6. Expand the retained tail backward by whole user turns while it still fits inside `keepRecentTokens`.
7. Cut at the start of a retained user turn.

Split-turn prefix summaries are intentionally deferred. If one very large recent turn exceeds the keep budget, Blip keeps that recent turn rather than cutting through a tool-call sequence.

## Summary Shape

Use a strict structured summary.

Recommended format:

```md
## Goal

- ...

## Constraints & Preferences

- ...

## Progress

### Done

- ...

### In Progress

- ...

### Blocked

- ...

## Key Decisions

- ...

## Next Steps

1. ...

## Critical Context

- ...

## Relevant Files

- ...

## File Metadata

- ...
```

Rules for the summarizer:

- Do not answer the conversation.
- Do not mention that it is summarizing unless the format requires it.
- Preserve exact paths, package names, symbols, command names, error messages, and user-stated constraints.
- Preserve previous summary facts unless the new transcript clearly makes them stale.
- Move completed tasks out of open tasks.
- Remove stale details that would mislead the next turn.
- Prefer short bullets over paragraphs.
- Use `(none)` for empty sections so omissions are visible.

## Prompt Contract

Use two prompts: one for the first compaction and one for updating an existing summary.

First compaction prompt:

```md
You are performing a context checkpoint compaction for a coding agent.

The conversation is inside <conversation> tags. Create a structured handoff summary that another model can use to continue the same coding task.

Only output the summary in the required format. Do not continue the conversation.
```

Repeated compaction prompt:

```md
You are updating an existing context checkpoint summary for a coding agent.

The previous summary is inside <previous-summary> tags. Newer transcript entries are inside <conversation> tags.

Update the summary with new facts, progress, decisions, file changes, open tasks, and risks. Preserve still-valid previous facts. Remove or rewrite stale facts.

Only output the summary in the required format. Do not continue the conversation.
```

Serialize transcript entries before summarization so the model sees them as data, not as a live conversation. Tool results should be bounded before they enter the summarization request. A practical v1 cap is `2_000` characters per tool result, with a truncation marker.

## File Operation Metadata

The summary should mention important files, but Blip should also track file operations directly.

Track:

- files read through `read_file`
- files searched when the file path matters
- files created, patched, moved, renamed, or deleted

Store final lists in `CompactionEntry.details`:

- `readFiles`: files inspected but not modified
- `modifiedFiles`: files created, edited, moved, renamed, or deleted

On repeated compaction, seed the new metadata from the previous compaction details, then merge operations from newly summarized entries. This takes the practical part of Pi's file tracking and makes it part of Blip's session state.

## Context Assembly

After compaction, model-visible context should not include older raw messages and the summary at the same time.

Model-visible layout:

```text
[system/developer prompt]
[repo instructions and selected skills]
[user message: Summary of earlier conversation]
[verbatim recent session entries]
```

Use a stable prefix for the summary message:

```text
Summary of earlier conversation:
...
```

Do not compact built-in instructions, repo instructions, selected skills, permissions state, or current environment context. Re-resolve those at context assembly time so the compacted summary does not freeze stale system context.

## Failure Behavior

Compaction should fail closed.

Rules:

- If model summarization fails, use the deterministic local fallback summary and keep the raw transcript unchanged.
- If the compacted summary is empty, treat compaction as failed.
- If compaction cannot find a safe boundary, skip compaction and report why.
- If `/compact` is requested before any useful history exists, write no entry and display a no-op message.
- If a persisted compaction boundary cannot be found later, ignore that compaction for model context and fall back to the raw transcript.

For provider context-window errors during the compaction request itself, retry once with older summarization input trimmed from the beginning. Do not trim the newest verbatim entries.

## CLI UX

The CLI should show compaction as a visible runtime event.

Recommended messages:

- Starting: `Compacting context...`
- Completed: `Compacted context: 142k -> ~38k tokens, keeping 2 recent turns.`
- No-op: `Nothing to compact yet.`
- Failed: `Compaction failed; continuing with existing context.`

Avoid noisy summary dumps in the normal transcript view. The user can inspect the session file if they need the exact summary.

## Comparison

### Pi

Pi has TypeScript compaction close to the reusable coding-agent runtime. Useful ideas for Blip:

- Keep compaction in core runtime, not only CLI UI.
- Use provider usage when available and estimates for trailing messages.
- Keep a reserve token buffer.
- Preserve recent tokens.
- Track read and modified files as compaction details.
- Handle repeated compactions by updating the previous summary.
- Handle split turns with a separate prefix summary when needed.

Blip should adapt these ideas without copying Pi's exact session format.

### OpenCode

OpenCode treats compaction as an anchored session message and has config for automatic behavior, pruning, recent turns/tokens, and reserved buffer.

Useful ideas for Blip:

- Load context from the latest compaction entry plus later messages.
- Make compaction a session message type.
- Keep both turn-count and token-count controls.
- Keep summary prompts strict and anchored to prior summary state.

Blip should defer OpenCode's broader plugin/config surface and pruning machinery until there is a concrete need.

### Codex

Codex has mature compaction with manual and automatic triggers, compact turns, runtime events, retry/error behavior, remote compaction, hooks, and context reinjection rules.

Useful ideas for Blip:

- Treat compaction as a first-class runtime event.
- Make automatic compaction happen before the next model call, not as invisible background work.
- Keep current system/repo/environment context outside the summary and reinsert it during context assembly.
- Preserve recent user intent around compaction.
- Track before/after token usage and failure status.

Blip should defer Codex's remote compaction, hooks, provider-specific compact APIs, and richer protocol integration.

## Blip Choice

Blip should adopt a local anchored compaction design for v1:

- OpenCode-style latest summary plus verbatim tail
- Pi-style token estimates, reserve buffer, file-operation metadata, and split-turn handling
- Codex-style first-class runtime event, manual and pre-turn automatic triggers, and failure-safe behavior

This keeps v1 practical without making it basic. The system can handle real coding sessions, repeated compactions, large tool-heavy turns, and context pressure while avoiding remote services, hooks, semantic memory, and protocol complexity.

## Open Questions

- Should v1 expose compaction settings in config, or keep constants until the session format settles?
- Should compaction use the active coding model only, or allow a configured cheaper summarization model?
- Should the model be allowed to request compaction through an internal tool, or should only the runtime and user trigger it?
- Should deleted files appear in `modifiedFiles`, or should metadata split `deletedFiles` later?
