# Shared chat reads, activity, and search

Native chats retain Blip transcripts in `assistant-blip.sqlite`. CLI-backed chats retain canonical turns in `hub.sqlite`. The Hub projects visible messages from those sources at one boundary, rather than making MCP and subscription consumers interpret each source independently.

## Read contract

`GET /api/drones/:droneRef/chats/:chatName/messages` uses `ChatReadService` and the existing chat snapshot reader. Query parameters are `limit` (default 10, maximum 20), `maxChars` (default 4000, maximum 8000), and `activity=summary|full`.

Both chat kinds return `historyKind: "messages"`, `messages`, `hasOlder`, and bounded pending prompts. Messages have stable source IDs, role, completion/failure status, timestamp, visible text, and truncation metadata. CLI messages additionally identify their source turn and retain compact model/activity/file-change metadata. Native limits retain the existing allowance of two visible messages per requested turn; CLI reads retain that many turns, including separate error messages.

MCP `read_chat` now makes one request to this endpoint. Its default CLI response changes from `turns` to `messages`; consumers should use `historyKind`. Explicit `includeActivity: true` includes the bounded CLI `turns` and their rich activity. Native rich history remains available through the existing native history API. Custom agents without structured transcripts keep the existing terminal-output fallback. Existing transcript/native routes and desktop/mobile rich-history rendering remain supported.

Empty chats return an empty message list. Missing chats and source read failures remain errors. Draft prompts retain their held status. Tool results, reasoning, images, compaction summaries, and arbitrary metadata are excluded from default visible reads.

## Activity and subscriptions

Idle status and reads use the same history and pending-message projection. Completed CLI turn IDs reconcile their delivery records, including completions outside a bounded history read. Model-facing reads opt out of the brief completed-prompt grace period retained by rich chat UI reads. Native `sent` records describe completed delivery and are excluded; queued/sending prompts and the native runtime's busy state still prevent idle. Runtime busy includes active runs and outstanding approval/input requests.

Failures retain failed status, whether represented by a prompt-delivery failure or an assistant completion. Subscription detection recognizes both and emits `chat.failed` once per failed message. It does not report a failed completion as a successful idle transition. Silent CLI completion still counts as finished and retains its turn order when timestamps match. Startup seeds count as queued work only before the chat exists.

## One search index

Chat schema migration 14 rebuilds the existing FTS5 index with a source discriminator. CLI triggers maintain their rows as before. Before each search, authorized active native chats refresh their rows from a consistent snapshot of durable Blip history. Search then executes one FTS query, one relevance ordering, and one pagination operation. Chat ownership breaks ties between cloned message IDs, keeping pages stable across index refreshes.

A per-chat session/sequence/count cursor supports incremental appends. Rebinding, deletion, or rollback causes replacement of that chat's native index rows. The entry count is checked alongside the sequence so deletion in the middle of history cannot leave an old answer searchable. The refresh and cursor update share one Hub transaction; concurrent searches cannot duplicate rows. No runtime dual writes or background indexing worker are required.

Archiving/deleting a chat removes its native index rows and cursor. Metadata identity or agent-kind changes invalidate the native projection. Searches also check current ownership/source; retained transcripts from a previous agent do not appear as current chat results. Restoring or renaming a chat indexes its retained history under its current identity.

Native search now uses the same whole-token matching, snippets, and relevance ranking as CLI search, replacing its previous substring matching and constant rank. First search after upgrade backfills native history in the requested scope; subsequent searches append new rows. A large initial history or an edited history can make that refresh slower. The index is disposable; original transcripts and model context are unchanged.

## Validation

Automated regressions cover bounded reads, optional rich activity, empty/draft/error states, native compaction/recovery, CLI/native completion, failed subscriptions, schema upgrade, repeat indexing, mixed pagination, access scope, append, middle deletion plus append, rollback, restart, rebinding, concurrent search, agent changes, archive/restore, and rename.

Manual checks after deployment:

1. Read and search a completed native chat and a CLI chat through Companion; compare the replies with each chat UI.
2. Subscribe while each is working; finish or fail it and verify exactly one appropriate event. Repeat while waiting for approval/input.
3. Edit/delete a native message, restart the Hub, and search again. Archive/restore and rename the chat; confirm only current visible history appears.
4. Request detailed CLI activity explicitly and confirm reasoning/tool details remain available only when requested.

This change centralizes model-facing reads, idle status, and search. Provider runtime execution and rich desktop/mobile history APIs keep their existing implementations.
