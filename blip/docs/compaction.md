# Context Compaction

Blip has local anchored compaction in `@blip/core`.

Compaction keeps the raw transcript on disk, stores a summary checkpoint, and changes model context for subsequent turns to:

```text
[system prompt]
[user message: Summary of earlier conversation]
[recent verbatim messages from firstKeptEntryId onward]
```

Older raw messages are not sent to the model when a valid compaction boundary exists.

## Triggers

Implemented triggers:

- Manual: `blip --compact [--session <id>]`
- Automatic: before a model call when estimated model-visible context exceeds `contextWindow - reserveTokens`

Default settings:

```ts
{
  auto: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
  keepRecentTurns: 2
}
```

These settings are constants in code. There is no user-facing config file for them yet.

## Compaction Entries

Compaction is stored as a transcript entry:

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

`firstKeptEntryId` points to the first raw message retained verbatim after the summary.

## Boundary Selection

Blip chooses a boundary before summarizing:

1. Find the latest prior compaction, if any.
2. Start from that compaction's `firstKeptEntryId`; otherwise start from the beginning.
3. Keep at least `keepRecentTurns` user turns when possible.
4. Expand the retained tail backward by whole user turns while the tail still fits in `keepRecentTokens`.
5. Cut at the start of the retained user turn.

This avoids cutting through a tool-call sequence in the current implementation because cuts happen at user-turn boundaries.

## Token Estimation

For raw, uncompacted context, Blip uses the latest successful assistant usage block when it is available and non-zero, then adds heuristic estimates for messages after that point.

For compacted context, Blip estimates the summary plus retained messages. It does not reuse old assistant usage blocks inside compacted tails because those usage blocks described a larger pre-compaction context.

## Summary Generation

Blip first asks the active model to create or update a structured summary. The summary request serializes transcript entries as data inside `<conversation>` tags.

If there is a previous compaction summary, Blip passes it inside `<previous-summary>` tags and asks the model to update it.

Tool results are capped at 2,000 characters before they enter the summary request.

If model summarization fails or returns empty text, Blip falls back to a deterministic local summary.

## Summary Shape

The model prompt requests this Markdown shape:

```md
## Goal

## Constraints & Preferences

## Progress
### Done
### In Progress
### Blocked

## Key Decisions

## Next Steps

## Critical Context

## Relevant Files
```

Blip appends a `## File Metadata` section after summary generation. That section is generated from structured session metadata, not trusted only to the model summary.

## File Metadata

The runtime tracks files read and modified through Blip tools.

Compaction stores:

- `readFiles`
- `modifiedFiles`

Repeated compaction merges previous compaction details with current session metadata.

## Context Reconstruction

`SessionStore.readModelMessages()` reconstructs model-visible message history.

If no compaction exists, it returns all raw message entries.

If a valid compaction exists, it returns:

1. A synthetic user message: `Summary of earlier conversation:\n...`
2. Raw messages from `firstKeptEntryId` through the compaction entry.
3. Raw messages after the compaction entry.

If `firstKeptEntryId` cannot be found, Blip ignores that compaction for model context and falls back to the raw transcript. This avoids silently dropping context.

## Runtime Events

Compaction emits:

- `compaction_started`
- `compaction_completed`
- `compaction_skipped`

Manual compaction with too little useful history writes a skipped event and no compaction entry.

## Current Gaps

- Split-turn prefix summaries are not implemented. If one recent turn is very large, Blip keeps that turn instead of cutting through it.
- Remote/provider-native compaction APIs are not used.
- Pre/post compaction hooks are not implemented.
- There is no user-facing config for compaction settings.
- There is no special warning event at 70% context usage.
- If deterministic fallback is used, the summary can be less semantically rich than a model-generated summary.
