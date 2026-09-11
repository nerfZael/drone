# Compaction planning, budgets, triggers, and manual requests

This documents features 4, 5, 6, and 9. Summary content/coverage, output pruning, history storage, and Companion UI are separate workstreams.

## Behavior

- **Long turns (4):** Prefer retaining whole user turns within `keepRecentTokens`. If those turns are too large, cut after a complete tool batch. All parallel calls and their results stay together. Keep the latest user message verbatim even when it precedes that cut. The transcript remains the source of truth.
- **Budgets (5):** `summaryMaxTokens` defaults to 4,096 independently of `reserveTokens`. The summary allowance is also capped by the model output limit and one eighth of its context window. Validate the estimated size of the complete checkpoint, including file metadata, before saving. Output caps are forwarded through the agent hook; the mobile OpenAI transport now sends `max_completion_tokens`.
- **Triggers (6):** Check before each model request, including requests following tools. Use the earlier of 90% occupancy or the context window minus output headroom. Aim for 60% occupancy when choosing the retained tail, and require at least 5% input reduction. These fractions are configurable. A failed automatic compaction stops the request with an actionable error instead of knowingly submitting another oversized context.
- **Manual requests (9):** Embedded, stored-session, and CLI entry points share planning, usage reporting, validation, cancellation, and checkpoint installation. CLI checks include its prompt, local tools, configured MCP tools, and their prompt sections. Manual compaction can skip when a summary would enlarge the conversation. Stop also works while the embedded session refreshes its prompt.

The planner reserves summary space and checks the retained request before invoking the summary generator. It may replan the boundary without a model call. It no longer generates a normal summary and then regenerates an emergency summary. The coverage workstream can still use several chronological summary batches for one selected boundary; this change does not promise one model call for arbitrarily long histories.

## Defaults and headroom

| Setting | Default | Meaning |
| --- | ---: | --- |
| `reserveTokens` | 16,384 | Minimum requested headroom; never silently reduced |
| `keepRecentTokens` | 20,000 | Preferred raw-tail allowance, including a pinned user |
| `keepRecentTurns` | 2 | Preferred whole turns, subject to the token allowance |
| `summaryMaxTokens` | 4,096 | Estimated checkpoint ceiling and generation allowance |
| `triggerThreshold` | 0.9 | Maximum input occupancy before automatic compaction |
| `targetThreshold` | 0.6 | Desired occupancy after selecting the boundary |
| `minimumReduction` | 0.05 | Minimum fractional input reduction for installation |

Normal requests receive an output allowance of the smallest of the model maximum, 32,000 tokens, and one quarter of the context window. Headroom includes that allowance plus 3% of the window for estimation error. For reasoning models it conservatively includes up to 16,384 additional thinking tokens, capped by the model maximum, because some adapters add thinking tokens to the supplied output cap. This may compact earlier than necessary for adapters that use a combined cap or a low reasoning setting. Summary input batching also reserves this possible thinking allowance.

The appended file inventory uses at most one fifth of the checkpoint's estimated budget, prioritizing modified paths. Generation reserves room for this inventory. The full lists remain in checkpoint metadata; the model sees an explicit omission notice when the inventory is shortened. The structured summary still records relevant paths from the conversation.

## Shared interfaces

- `prepareCompaction({ session, entries, settings, tailBudget? })` returns the selected boundary without generating a summary.
- `createCompaction({ ..., plan? })` accepts that prepared plan. Keep this parameter when changing the summary generator; selection and generation must use the same plan.
- Checkpoints have optional `retainedUserEntryId` alongside `firstKeptEntryId`. Reconstruct context as summary, pinned user (if any), and retained tail. An active-history reader must fetch **both** referenced entries. Missing references fall back to raw history.
- `BeforeModelCallResult.maxTokens` is forwarded to the stream implementation even when no compaction occurs.
- `compactStoredSession` accepts `signal`, `streamFn`, `systemPrompt`, `tools`, `transformContext`, and `convertToLlm`. Custom hosts must supply the same context configuration as normal requests. The file-backed wrapper supplies local tools; the CLI additionally supplies its prompt and MCP providers.

## Limits and tradeoffs

Token estimates are not exact tokenizer counts. During a running agent loop, successful provider input usage, including cached input, can raise the estimate of an unchanged request prefix; new assistant/tool content adds its estimated cost. Calibration is discarded for changed prefixes, prompts, tools, or models, and starts fresh on the next separately invoked agent loop. It does not lower a conservative estimate. Prefix validation adds work proportional to the active request size.

An oversized latest user message or fixed prompt/tool configuration may leave no room for a summary. That produces a skipped manual compaction or an automatic-compaction error, preserving the existing checkpoint. Invalid, oversized, or insufficiently smaller generated candidates are likewise not installed.

Output caps depend on the transport. The Codex transports still do not serialize an output-cap field; the post-generation estimate protects checkpoint installation but does not impose a provider billing ceiling. No provider-native compaction API, background preparation, or fresh-window continuation was added.

Embedded sessions exclude concurrent prompts while compacting. Before saving, compaction detects changed message/checkpoint IDs in the repository. This check is not a cross-process transaction or lock; callers must serialize independent writers to one stored session.

## Validation

Focused regressions cover parallel tool boundaries, repeated pinned-user reconstruction, corrupted references, independent budgets, rejected oversized/nonshrinking candidates, cancellation before/during generation and prompt refresh, concurrent prompts, stale history, provider-usage invalidation, agent output-cap forwarding, and the mobile API field. Combined core tests cover JSONL, SQLite, and mobile active-history parity.

Before release, manually run a long tool-driven task and confirm it resumes with the latest user constraints; run CLI `--compact` with MCP configured; cancel manual compaction; and resume after restarting the host. Exercise each deployed provider, especially transports that do not send output caps. Live-provider latency, cost, and continuation quality have not been benchmarked by these deterministic tests.
