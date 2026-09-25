# Future

Ideas we designed and want to keep, but that are not built. Each one should be possible without rewriting the core, and none of them should shape today's code beyond what the other docs say. Where part of an idea is already built, the entry says so and links to it.

## Topology

Today's shape is one head, an optional voice and reviewer, workers and code limbs ([topology.md](topology.md)). Later shapes are the same parts configured differently:

| Shape | Description |
|---|---|
| Hierarchy | Heads of sub-teams, each directing its own limbs. |
| Peers | Equal authority, coordinating only through the log and dependency checks. Worth trying when models cooperate better. |
| Nested entities | A child is a whole entity, attached to its parent through the [host API](host-api.md) as a channel. Its events are its messages, status and results; its effects are sending it a message, pausing it and giving it budget. An entity never needs to know whether it is talking to a limb, a sub-entity or a human. |
| Free spawning | Any limb may start limbs, within budget caps. Today only the front limb and the head dispatch workers. |

## Budgets and resilience

- **Budgets that flow down the tree.** Tokens and money per limb, handed from parent to child, with caps that freeze work at the limit, depth caps, and the entity seeing its own spend rate so it can choose cheaper limbs or slower heartbeats. Today there are the Jev caps, the worker queue, and cost shown per worker on the Work canvas.
- **Backup models.** A limb whose model keeps failing falls back to another (see [plan.md](plan.md#open-questions)).
- **One abort signal per running period**, shared by every run, Jev call, timer and program, so Pause is a single abort nothing outlives.
- **Per-limb views**, beyond today's per-role worker lists: each limb renders only the sections it needs (a keypad limb sees keys and recent chat).

## Arbitration

For peers, a head is replaced by arbitration, from global workspace theory in cognitive science:

- Any limb can **bid** for a scarce resource (the voice, a motor channel, the head's attention) with an urgency and a reason.
- An **arbiter** picks the winner by urgency, recency, budget and a `judge` confidence, and logs the decision.
- The winning content is **broadcast** into every limb's state.

Today's rule, "the newest run owns the voice", is the degenerate case.

## Supervision extras

OTP's `temporary` children (never restarted), `one_for_all` strategies (restart a group together), and restarting the head from a checkpoint.

## Jev beyond senses

- **Cascades.** A fast limb answers and a stronger one checks. Answer review does this with a strong model ([parallel-conversation.md](parallel-conversation.md#second-looks)); a `judge` pre-filter could decide which answers are worth the strong check.
- **"Does it still fit?" checks** before a `say` commits, extending dependency checks from facts to meaning.
- **Routing with Jev.** The front limb routes every message with the model today ([parallel-conversation.md](parallel-conversation.md)); `judge` could make the cheap calls (ignore, steer, new worker) faster. Difficulty routing ("is this hard enough to need sol?") is done by the router's model choice per dispatch.
- **Several `judge` calls voting** for more reliable signals.
- **Replaying recorded Jev answers**, so a replayed session is deterministic.

## Memory

Built today: notes in state and the event log. Designed (M5): a long-term store with `remember` / `recall`, section budgets with pinning and summarizing, and checkpoints instead of compaction ([context-and-memory.md](context-and-memory.md)). Later:

- **Jev-driven recall.** Alongside each wake, `judge` picks relevant headlines from the long-term store, and they are paged into a `recalled` section without the mind asking.
- **Consolidation ("sleep").** While idle, a background run turns recent episodes into durable facts and reusable programs.
- **Learned reflexes.** Watches and programs that worked are saved and re-installed by recall, so behaviour migrates from slow thinking to fast code. `judge("did that reflex work?")` decides what to keep.

## Channels and hosts

- **MCP adapter.** MCP has resources, subscriptions and tools, which map to state, events and effects. An adapter could turn any MCP server into a channel. It isn't realtime-grade and has no risk classes, so it stays an adapter.
- **A second small host** (tic-tac-toe or a timer) to check that the host API is general, and a **coachable game player** as a demo: the entity plays Pong or Snake with superhuman reflexes while taking coaching ("only eat the blue ones", "let me win, but make it close").
- **Coding-agent limbs**: Codex or Claude Code as workers, in their own worktrees ([coding.md](coding.md)).

## Tests

- **Real sessions into test stories.** Sessions are recorded and replayable today, and the routing eval takes its cases from live sessions. Next: promote interesting sessions to regression stories replayed with a fake clock.
