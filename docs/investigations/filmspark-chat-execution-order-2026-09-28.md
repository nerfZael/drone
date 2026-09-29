# FilmSpark Plan: completed answer below an active request

The screenshots show a real execution-order difference combined with a misleading transcript presentation. The question answer continued an already-running task ahead of a queued user message. The completed response then appeared under the question-answer notification instead of staying visibly connected to its original request. There is no evidence that two independent agent turns in this chat ran concurrently.

Scope: drone `0cdc0a56-dd4a-49b0-a348-f0138f82fe9e` (Combined Plan to Assets Spec Analysis), chat `FilmSpark Plan`. Evidence: screenshots, read-only queries of the canonical Hub database, Hub delivery logs, source inspection, and a replay of the stored message metadata through the current frontend grouping functions. No prompts were sent, chat state changed, or application fixes applied.

All times below are Europe/Zagreb on 28 September 2026 (UTC+2).

| Time | What happened |
| --- | --- |
| 20:45:11 | The user requested typed chat after the proposal and follow-up storyboard behavior. Prompt `a464fee3f37df7bcc0`. |
| 20:45:12 | That request started running. |
| 20:46:03 | The agent asked how storyboard shot creation should be approved. |
| 20:47:21 | The user submitted the longer clarification about supplementary assets, storyboard navigation, and editor/export availability. Prompt `888a4a79b3e46c411a`, delivery mode `queue`. |
| 20:47:26 | The user selected “Review a second storyboard proposal.” |
| 20:47:37 | The answer notification was delivered with mode `asap` into the original active run. |
| 20:54:39 | The original run finished. Its final answer, “Implemented, uncommitted,” was assigned to the answer notification. |
| 20:54:43 | The longer queued clarification started running, after approximately 7m21s waiting. |

The Hub log at lines 29940093–29940107 explicitly records `disposition: 'steered'`, `outcome: 'accepted'`, original run ID `a464fee3f37df7bcc0`, and provider turn ID `01a0e955-e3ba-74f2-930d-c58134203cb9`. The notification was `subscription-51886587-c953-421b-8524-dd87df33082c`. Delivery timing for the longer clarification is recorded at lines 29942500–29942538, including `queueWaitMs: 441054` and agent start `18:54:43.685Z` UTC.

The canonical subscription settings use `deliveryMode: 'asap'`, with no event-specific overrides; that settings row was last updated on September 18. Thus the different treatment of the queued text and question answer follows the configured delivery policy. The longer clarification's stored activity contains the commentary about removing both automatic generation triggers shown in the screenshots. It was being handled, not lost. At the investigation snapshot it had no completed transcript entry; this report does not establish its eventual outcome.

The yellow “Still working on an earlier request · Show request” text is a clickable status notice, not an error. It points back to the active request above a later completed entry. It was introduced in commit `4b86332cc` on September 25. Its trigger is in [chat-execution-order.ts](../../apps/drone-hub/src/droneHub/app/chat-execution-order.ts), and its wording, yellow styling, and scroll behavior are in [ChatExecutionNotice.tsx](../../apps/drone-hub/src/droneHub/chat/ChatExecutionNotice.tsx).

The implementation explains three presentation problems:

1. **The answer loses its visible connection to the original task.** On accepted steering, [codex-prompt-run-manager.ts](../../apps/drone/src/codex-prompt-run-manager.ts), around lines 1058–1065, changes `responseMessageId` to the incoming message. On completion, [chat-reconciliation-executor.ts](../../apps/drone/src/hub/chat-reconciliation-executor.ts), around lines 509–526, stores the original message as `userOnly: true`, with an empty output. The entire response and activity belong to the notification. This explains the original request's apparently empty completed block and the implementation report appearing below “Question responses.”

2. **Grouping does not reconstruct this shared run after completion.** [chat-timeline-items.ts](../../apps/drone-hub/src/droneHub/app/chat-timeline-items.ts) sorts by message submission time. Its grouping heuristics can attach a user-only follow-up to an earlier answer, but here the original user-only message comes first and the response-owning notification comes last. Replaying the actual records produces three separate groups: original completed user-only request, active queued clarification, completed answer notification. The earlier-working banner and execution-order note then follow directly. The original user-only record also omits the provider turn ID in this reconciliation branch, so the presentation lacks a reliable shared-run link on both entries.

3. **The clocks describe different portions of one run.** The original request's timestamps span 567.075 seconds (9m27s). The notification's timestamps span 421.207 seconds (7m1s), although its activity includes work performed before the notification arrived. [TranscriptTurn.tsx](../../apps/drone-hub/src/droneHub/chat/TranscriptTurn.tsx), around lines 223–241, calculates elapsed time using the response-owning message's `startedAt`. The two durations therefore look like separate tasks even though the log proves they share one run.

Recommended changes, in priority order:

1. Preserve a stable run identity and its actual start/completion timestamps on every participating message. Present the task, question answer, activity, and final reply as one clearly connected run through both streaming and completion. Preserve the user's message order while explicitly identifying which task a reply completes. Avoid relying only on timing or adjacency to infer ownership.
2. Explain the currently active task in neutral status language. For this case, “Working on your follow-up about supplementary assets and storyboard navigation” is clearer than a yellow warning about an “earlier request.” Explain that the submitted question answer continued the previous task when that distinction matters.
3. Make delivery behavior visible: typed messages queued behind active work versus answers delivered into active work. Retain the ability for question answers to reach the task that asked them; changing everything to FIFO would prevent useful continuation without fixing the ownership problem.
4. Add coverage for the precise sequence: original task → queued clarification → immediate question answer → shared-run completion → clarification starts. Check stable grouping, answer attribution, full-run timing, and the status shown while the clarification is active.

Validation: 20 existing tests passed across `chat-execution-order.test.tsx`, `chat-timeline-items.test.ts`, and `codex-prompt-run-manager.test.ts`. A separate read-only replay of the scoped database extract reproduced the three groups, the banner target `888a4a79b3e46c411a`, and both durations. Existing tests cover related ordering and steering cases but not this completed-run ownership transition. No production reproduction was necessary.

One small source/screenshot difference remains: current source prefixes the notification's execution-order note with “ASAP:”; the screenshot omits that prefix. The frontend build and response payload used for the screenshot were not captured, so that wording difference is not attributed to a specific deployment or projection issue. It does not change the sequence established by the persisted records and delivery log.

## Implementation — September 29

The Hub now preserves the daemon's shared `runId` and `runStartedAt` on pending messages and completed transcript records, including the original user-only record. These fields survive canonical storage, summary reads, and mesh transport. The UI uses confirmed membership to keep the original request, accepted ASAP inputs, and final response in one group. The response retains its own identity for activity loading and checkpoint actions; the group's request and elapsed time remain anchored to the original work. Independent ASAP runs and messages still waiting for execution stay separate. A failed shared run retains its error and recovery identity.

The shared duration is displayed through streaming and completion. Accepted inputs are labeled “Added to this run · ASAP.” The active-request notice uses neutral styling and “Working on this request · Show request,” and queued messages explain that they wait for their turn.

Regression coverage includes the screenshot sequence, a question-answer notification, multiple steering inputs, completion records arriving in separate updates, JSON reload, partial history pages, failure recovery, and cache invalidation. Targeted frontend/backend tests, both TypeScript checks, and a direct SQLite close/reopen check passed. No live chat prompt was sent or service restarted to validate this change.

This implementation has not been deployed. Historical completed turns that lack run identity are not automatically backfilled; the screenshot's old run needs an authoritative repair from its daemon records to gain the new grouping. The implementation deliberately does not infer that missing relationship from coincident timestamps.
