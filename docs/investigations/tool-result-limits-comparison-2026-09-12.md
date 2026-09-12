Tool-result handling comparison — 12 September 2026

Companion uses Blip's shared agent runtime. The appropriate shared protection
is a bounded model-facing tool-result projection in `@blip/core`, with original
results retained for retrieval and application logic. A separate `read_chat`
projection should avoid returning a whole nested agent trace by default.
An MCP-adapter-only fix would miss Companion's browser tools and native workspace
tools. No application changes were made during this investigation.

The upstream repositories were shallow-cloned into the already ignored
`tmp/tool-result-comparison/` directory and inspected at these revisions:

- Codex: `c4017a87aacc7558002b7cb510025e967c1d765e`.
- OpenCode: `95daf90670b7c039c436c85537da5fbfe2205b41`.

The comparison concerns model-facing results, not just UI display limits.

| Behavior | Codex | OpenCode | Blip / Companion |
| --- | --- | --- | --- |
| Fresh oversized text result | Truncated under model/tool policy before entering context | Shared truncation, normally 2,000 lines or 50 KiB, whichever is reached first | No common fresh-result ceiling found |
| Full result access | Raw MCP result remains available to Code Mode and hooks; do not assume every ordinary MCP call creates a retrieval file | Oversized output is saved to a file; preview includes instructions to search/read it | Original session tool result is retained; `read_tool_output` provides character pages |
| Old result pruning | Context history also enforces output policy | Old completed outputs can be marked compacted, protecting recent context and skill output | Successful older text results over 12,000 characters can become roughly 4,000-character head/tail previews |
| Compaction input | Stored model history has output truncation applied | Compaction serializer caps each completed tool output at 2,000 characters, or uses a cleared-output marker | Summary batching reads the full selected transcript outputs, not the pruned model projection |

Codex applies the selected model's truncation policy, with a tool/config override
where supplied and a serialization/header allowance. Its generic fallback model
uses a 10,000-byte policy; that is not a universal 10,000-token default. Text
truncation removes the middle. MCP content and history output handling are
centralized. Code Mode can inspect the raw result and choose what to expose.
Sources: [MCP output conversion](https://github.com/openai/codex/blob/c4017a87aacc7558002b7cb510025e967c1d765e/codex-rs/core/src/tools/context.rs#L102),
[history enforcement](https://github.com/openai/codex/blob/c4017a87aacc7558002b7cb510025e967c1d765e/codex-rs/core/src/context_manager/history.rs#L350),
[truncation implementation](https://github.com/openai/codex/blob/c4017a87aacc7558002b7cb510025e967c1d765e/codex-rs/utils/output-truncation/src/lib.rs),
[model configuration](https://github.com/openai/codex/blob/c4017a87aacc7558002b7cb510025e967c1d765e/codex-rs/models-manager/src/model_info.rs).

OpenCode joins MCP text/resource text and applies its shared truncator, keeping
images and supported binary attachments separate. Native tools use a shared
wrapper unless the tool explicitly reports its own truncation status. Defaults
are configurable; truncation normally keeps the head and writes the full text
to a tool-output file. Those files have seven-day cleanup. Old-output pruning
and the much smaller compaction projection are additional protections.
Sources: [MCP conversion](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/opencode/src/session/tools.ts#L429),
[shared truncator](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/opencode/src/tool/truncate.ts),
[native wrapper](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/opencode/src/tool/tool.ts#L131),
[compaction serializer](https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/opencode/src/session/compaction.ts#L28).

Our call paths converge as follows:

```text
Hub read_chat / other MCP tools -> @blip/mcp -> BlipSession
Companion browser/custom tools -------------> BlipSession
Blip workspace tools -----------------------> BlipSession
                                               |
                                  full original transcript
                                               |
                         transformContext / pruneToolOutputs -> model

Compaction currently reads full original transcript -> serial summary batches
```

Relevant local sources:

- `apps/drone/src/hub/companion/companion-runtime.ts`: creates the shared MCP
  provider and supplies browser/custom/workspace tools to the Blip host.
- `blip/packages/mcp/src/mcp-tool-provider.ts`: forwards MCP text/images without
  a common size cap, with structured-content fallback when no supported content
  is present. `details` retains structured data for application use.
- `blip/packages/core/src/blip-session.ts`: applies the common context transform
  and installs `read_tool_output` unless pruning is disabled.
- `blip/packages/core/src/pruneToolOutputs.ts`: protects the latest two tool-call
  batches, failures, mixed/image results, instruction/skill-related results, and
  results without their original call. A textual mention of instructions can
  exempt even a large result. This is not an upper bound on context size.
- `blip/packages/core/src/createReadToolOutputTool.ts`: session-scoped original
  output retrieval, default/declared maximum 12,000 characters per page.
- `blip/packages/core/src/helpers/compaction-summary-input.ts`: serializes full
  selected message contents into batches; fragmentation does not truncate them.
- `blip/packages/tools/src/tools.ts`: shell output has per-stream character
  limits, while file reads primarily limit lines. A very long line can remain
  large. Browser read tools likewise serialize their returned snapshot.

There are two different kinds of "metadata" here. MCP's `structuredContent`
and Blip's `details` are application-side result fields. Our MCP server also
serializes the entire response object into `content[0].text`. Consequently,
anything nested in that response, including `turn.activity`, is model-visible
text. The OpenAI Responses adapter uses tool-result `content`, not a second
serialization of `details`; the problem does not require counting the same
MCP structured object twice.

`read_chat` accepts `drone`, optional `chat`, `limit` (default 10, maximum 20),
and `maxCharsPerField` (default 4,000, maximum 8,000). It returns the latest
completed turns plus pending messages. It does not currently expose an offset
for paging backward through completed turns.

Its ordinary top-level response contains:

| Field | Meaning |
| --- | --- |
| `ok`, `drone`, `chat` | Result status and requested target |
| `turns` | Latest selected completed transcript turns |
| `draft` | Whether this is a draft chat |
| `pending` | First `limit` pending messages: ID, time, state/status, bounded prompt and its original length/truncation marker |
| `pendingCount`, `pendingTruncated` | Total pending count and whether entries were omitted |
| `message` | Optional explanation that draft messages are held until publication |
| `limit`, `maxCharsPerField` | Effective selection/text limits |

Each turn contains `turn`, `at`, optional `id`, prompt/start/completion times,
`prompt`, `ok`, `output`/`error`, and optional model/reasoning settings.
Prompt/output/error strings receive original-length and truncation markers.
The turn formatter can also include:

| Field | Actual content |
| --- | --- |
| `activity` | Version, agent source, update time, optional truncated flag, and **messages from the other agent's run** |
| `activity.messages` | User/assistant/tool-result/run-summary records; text, reasoning, tool names and arguments, tool results, diagnostics, and details can occur in these records |
| `activitySummary` | Summary metadata when full activity is absent |
| `skillsUsed` | Recorded skill uses |
| `attachments` | Image attachment references |
| `agentPlan` | Plan items, their status, source, and update time |
| `fileChanges` | Workspace identifiers, changed-file paths/statuses, added/deleted/modified-line counts, attribution and diff-artifact references; not the full diff text in this schema |
| `dockerSnapshot` | Snapshot ID/status/timestamps, optional error and size |
| `inheritedFromClone`, `silentCompletion` | Optional turn flags |

These fields are spread through `boundedTranscriptTurn`; only `prompt`,
`output`, and `error` are truncated there. In particular, `activity` is a nested
agent trace, not merely a few labels or timestamps. Some fields have their own
upstream normalization, but this function has no total result-size ceiling.
The state request uses default full activity (`activity` is not set to summary
or none).

The 410 fallback returns an empty turn list for a draft, or bounded raw output
for a non-draft chat, alongside pending state. Raw fallback output is capped at
twice `maxCharsPerField` and includes length/truncation markers.

Validation: extracted the actual `truncateString` and `boundedTranscriptTurn`
function declarations from `mcp-server.ts`, transpiled them with the installed
TypeScript compiler, and executed them on synthetic data. A turn with two
10,000-character prompt/output fields and a 1,000,000-character nested activity
tool result produced:

```json
{"promptChars":4000,"outputChars":4000,"activityResultChars":1000000,"totalJsonChars":1008261}
```

This proves the bounding gap without reading or executing a real conversation.
It does not retrospectively identify the payload responsible for the cancelled
compactions in the earlier investigation.

Recommended implementation has two complementary layers:

1. Give `read_chat` a deliberate conversational response schema: bounded visible
   turns and pending prompts, compact status/plan/file summaries where useful,
   with detailed activity retrieved explicitly. This benefits every MCP client,
   including Codex/OpenCode, as well as Companion.
2. Add one shared Blip policy for fresh and older model-facing tool results,
   including results supplied to compaction. Preserve raw results and structured
   details for application logic and targeted retrieval. Use explicit omission
   markers and retrieval handles; do not silently replace failed outputs or
   mandatory instructions with a successful-looking preview. Keep image and
   other non-text handling separate, and account for multiple results in one
   parallel batch.

That core change would cover Companion and ordinary Blip sessions automatically
after their dependent packages are built and the running host is updated. It
would not require copying a Companion implementation into Blip. Test the shared
policy against fresh large MCP output, browser snapshots, long-line file reads,
multiple simultaneous results, original-result retrieval, and compaction input.
The existing old-output pruning alone does not provide those guarantees.
