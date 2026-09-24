# Alternatives considered

The design started from "state + events". Before committing, we compared it against established architectures from robotics, game AI, distributed systems and cognitive science. Most of what we built turned out to have a well-known ancestor, which we treat as a good sign: we inherit their solutions and their known failure modes.

## What we are, in known terms

| Architecture | Where it's from | How it maps to the entity |
|---|---|---|
| Three-layer architecture (3T) | Robotics | Reactive controller = code watches, sequencer = motor programs and Jev, deliberator = LLM limbs. Its known failure mode is the layers drifting out of sync, which our commit-time checks against the log address. |
| Blackboard systems | 1970s AI (Hearsay-II speech recognition) | Specialists reading and writing one shared store: limbs over the log and its projections. |
| Subsumption | Rodney Brooks, robotics | Fast layers act and slow layers adjust them: the mind programs watches and motor programs. |

## Adopted

| Idea | From | What changed | Where |
|---|---|---|---|
| Event log as the only truth, state as projections | Event sourcing | State is no longer a mutable store. Each limb reads its own projection, so `view` is a real concept. Replay, time travel, test stories and lossless eviction come almost for free. | [core-model.md](core-model.md) |
| Events vs. levels | Functional reactive programming (events vs. behaviours) | Held keys, typing, speech overlap and thinking are levels with a start time. Watches can say "held > 2 s" directly. We call them levels to avoid clashing with behaviour trees. | [core-model.md](core-model.md#levels-and-events) |
| Behaviour trees for motor programs | Game AI | No new DSL. Interruptible, inspectable, composable, and LLMs write them well. Watches extend reflex's condition shapes. | [architecture.md](architecture.md#watches-and-motor-programs) |
| Supervision trees for lifecycle | Erlang/OTP | Cancel = `shutdown` with timeout, kill = `brutal_kill`, restart policies (`permanent`, `transient`, `temporary`), restart intensity, and failing upward. | [topology.md](topology.md#supervision) |
| Arbitration with bids | Global workspace theory | The voice sits behind an arbiter interface from v1. Peers later bid for the voice, motor channels or attention; the winner is broadcast to every projection. | [topology.md](topology.md#arbitration) |
| Native full-duplex voice models as a limb type | OpenAI Realtime, Gemini Live, Moshi | In M4 a realtime speech model can be the voice limb, while our limbs think and the core keeps the log and holds. | [host-api.md](host-api.md), [plan.md](plan.md) |
| A throwaway spike before building | Engineering practice | M0.5 measures real latency with one LLM, the keypad, holds and a code watch before we build the core properly. | [plan.md](plan.md#milestones) |

## Deferred

| Idea | Why not now |
|---|---|
| MCP servers as channels | MCP has resources, subscriptions and tools, which map to state, events and effects. It isn't realtime-grade and has no risk classes, so it becomes an adapter after v1, not the core. |
| Peer topology with real bidding | Current models trample each other without a head. The arbiter interface is in v1 so this is a configuration change later. |

## Kept open, to measure

| Question | How we decide |
|---|---|
| Jev vs. a small fast LLM as the evaluator | Jev offers calibrated probabilities, low cost and speed, while a small LLM can also generate. Both sit behind the `Evaluator` interface, and M3 compares them on the Jev scenarios for accuracy, latency and cost. |

## Rejected

| Idea | Why not |
|---|---|
| Building the core around a native realtime voice model | Fast and natively interruptible, but weaker reasoning, vendor-specific, and little control over holds, projections or authority. It stays one limb type among others. |
| Pure actor model with no shared store | Actors with mailboxes fit societies and lifecycle well, which is why we took OTP supervision. Without a shared log, every limb would need its own copy of the world and coordination would become message chatter. The log plus supervision gives us both. |
| One long-lived transcript with compaction | This is how standard agents work. Cost is unpredictable, compaction loses information, and interruption is awkward. Per-task context and checkpoints into the log replace it. |
| A new scripting DSL for watches and programs | It would be one more language to design, validate and teach the model. Behaviour trees and reflex-style conditions already cover what we need. |
