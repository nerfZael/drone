# Context and memory

## Context: fresh or kept

Context is scoped to a **task**, not to the entity. Reactive limbs start fresh on every wake. A task limb keeps its context for the life of one task and then throws it away.

- **Reactive limbs** (voice, keypad) start fresh on every wake. Costs are predictable, restarts are free, and there is nothing to compact.
- **Task limbs** run a real blip session for as long as the task lives. They keep the LLM benefits of a continuous context, and `steer` works for redirecting within the task. When the task ends, the session is thrown away and only its results stay in state.
- **Checkpoints replace compaction.** If a task session goes over its context budget, the limb appends a checkpoint event for `tasks[id]` and restarts fresh from its projection. The rendered state is the compacted form. We never need a separate compaction pipeline.
- **Redirect or restart.** Inside a task, new events arrive by steer or as stopped-output tool results. The limb itself decides whether to carry on, or checkpoint and restart. Reactive limbs are short, so they just finish.
- **Prompt caching.** Caching is a design constraint, not an afterthought. Render in a fixed order: role, tools, slow-changing state, then volatile state (draft, recent events, time) last, so a fresh run pays full price only for the changed tail. Task limbs append to their context, which caches naturally. Keeping the conversation in a log instead of in state also keeps the cached prefix stable.

## Memory

Memory has three layers, and the entity manages them itself rather than relying on transcript compaction.

| Layer | Where | Size | Written by |
|---|---|---|---|
| Working memory | `state` | Fixed budget that always fits in one context | Reducers, plus the mind via `note` |
| Episodic log | The event log itself: every event and committed effect | Unbounded | Orchestrator, automatically |
| Long-term store | Files of facts and saved programs, each with a one-line headline | Unbounded | The mind, via `remember` |

- **Eviction instead of compaction.** When a state section goes over its budget, the projection drops its oldest items. They are still in the log, so nothing is ever deleted: evicted items and checkpoints stay readable by tool. The mind sees its budget use and can pin items or summarize them into `self.notes`.
- **Explicit recall.** The mind calls `recall(query)` to search the long-term store and the log. That is all of v1's memory (M5).

Automatic recall by Jev, consolidation while idle, and learned reflexes are in [future.md](future.md#memory).
