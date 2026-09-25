# Context and memory

## Context: fresh or kept

Context is scoped to a **piece of work**, not to the entity.

- **Reactive limbs** (head, voice, reviewer) start fresh on every wake, from a render of state and new events ([core-model.md](core-model.md#state-and-what-a-limb-sees)). Costs are predictable, restarts are free, and there is nothing to compact.
- **Workers** keep a conversation for their task: Drone Hub's mind holds each worker's message history in memory, appended step by step, so a run that is paused or crashes keeps the steps it completed. They keep the benefits of a continuous context, and a steer arrives inside it with the worker's next tool result. When a worker finishes, its conversation is kept (the 12 most recent), so it can be forked or picked back up with a follow-up; a failed or stopped worker's conversation is dropped at once. Only results stay in state.
- **Running out of turns** is not the end: a worker whose run hits its step limit while still working is continued in the same conversation, up to 4 times.
- **Prompt caching** is a design constraint, not an afterthought. Renders keep a fixed order: role and tools, stable state (notes, limbs, workers), then live state, new events and time last, and the stable part carries no ages or counters, so a fresh run pays full price only for the changed tail. Workers append to their conversation, which caches naturally, and after their first wake they are shown only the state that changed.

What a render includes is bounded: the last 12 chat messages, the last 40 new events with long text clipped, limbs that are running or started in the last minute, the last 20 notes, and a capped list of workers per role ([core-model.md](core-model.md#state-and-what-a-limb-sees)). A worker in a 100-worker batch gets about 3 KB of state, the head about 15 KB. Older history stays in the log, readable by tool (`read_chat`).

**Not built yet:**

- **Checkpoints instead of compaction.** A worker whose conversation outgrows its budget would append a checkpoint of its task and restart fresh from state, so no separate compaction pipeline is needed. Today a worker's conversation grows without limit.
- **Surviving a restart.** Worker conversations live in memory, so a Hub restart loses them, and the session can only be replayed ([session-logs.md](session-logs.md)). Saving conversations next to the recording would make sessions resumable; the runtime state is already rebuilt by replaying the log.

## Memory

Memory has three layers, and the entity is meant to manage them itself rather than rely on transcript compaction.

| Layer | Where | Status |
|---|---|---|
| Working memory | State: notes (the last 20, written with `note` by any limb), channel state, levels | Built |
| Episodic log | The event log itself: every event, tool call and committed effect | Built; recorded to disk per session |
| Long-term store | Files of facts and saved programs, each with a one-line headline, written with `remember` and searched with `recall` | Not built (M5) |

Also not built: per-section budgets the entity can see, pinning and summarizing items into notes, automatic recall by Jev, consolidation while idle, and learned reflexes ([future.md](future.md#memory)).
