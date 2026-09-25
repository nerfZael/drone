# Future

Ideas we designed and want to keep, but that are not part of v1. Each one should be possible without rewriting the core, and none of them should shape v1 code beyond what the v1 docs already say.

## Topology

v1 is one head (which also speaks unless a separate voice limb is configured), task limbs and code limbs. Later shapes are the same parts configured differently:

| Shape | Description |
|---|---|
| Hierarchy | Heads of sub-teams, each directing its own limbs. |
| Peers | Equal authority, coordinating only through the log and dependency checks. Worth trying when models cooperate better. |
| Nested entities | A child is a whole entity, attached to its parent through the [host API](host-api.md) as a channel. Its events are its messages, status and results; its effects are sending it a message, pausing it and giving it budget. An entity never needs to know whether it is talking to a limb, a sub-entity or a human. |
| Free spawning | Any limb may spawn limbs, within budget caps. |

## Arbitration

For peers, a head is replaced by arbitration, from global workspace theory in cognitive science:

- Any limb can **bid** for a scarce resource (the voice, a motor channel, the head's attention) with an urgency and a reason.
- An **arbiter** picks the winner by urgency, recency, budget and a `judge` confidence, and logs the decision.
- The winning content is **broadcast** into every limb's projection.

v1's rule, "the newest voice run owns the voice", is the degenerate case.

## Supervision extras

OTP's `temporary` children (never restarted) and `one_for_all` strategies (restart a group together).

## Jev beyond senses

- **Cascades.** A fast limb answers, `judge("is this answer correct?")` scores it, and low scores escalate to gpt-6-sol with a correction. E3 in [demo.md](demo.md) is the first use and lands in M3; the general machinery comes later.
- **"Does it still fit?" checks** before a `say` commits, extending dependency checks from facts to meaning.
- **Routing mid-run events.** `judge` choosing ignore, redirect (blip `steer`) or parallel for events that arrive while a limb is busy. In v1 the floor covers this: messages wake a parallel voice run.
- **Difficulty routing** ("is this hard enough to need sol?") and **understanding checks** ("did I understand?").
- **Several `judge` calls voting** for more reliable signals.

## Memory

v1's memory (M5) is working memory in state, the event log, and an explicit `remember` / `recall` store. Later:

- **Jev-driven recall.** Alongside each wake, `judge` picks relevant headlines from the long-term store, and they are paged into a `recalled` section without the mind asking.
- **Consolidation ("sleep").** While idle, a background run turns recent episodes into durable facts and reusable programs.
- **Learned reflexes.** Watches and programs that worked are saved and re-installed by recall, so behaviour migrates from slow thinking to fast code. `judge("did that reflex work?")` decides what to keep.

## Channels and hosts

- **MCP adapter.** MCP has resources, subscriptions and tools, which map to state, events and effects. An adapter could turn any MCP server into a channel. It isn't realtime-grade and has no risk classes, so it stays an adapter.
- **Coachable game player** as a second host and viral demo: the entity plays Pong or Snake with superhuman reflexes while taking coaching ("only eat the blue ones", "let me win, but make it close").

## Tests and self-awareness

- **Real sessions into test stories.** Record live sessions and promote interesting ones to regression stories, replayed with a fake clock.
- **The entity sees its own spending.** Spend rate against budget becomes part of state, so it can choose cheaper limbs or slower heartbeats.
