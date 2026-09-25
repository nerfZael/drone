# Alternatives considered

The design started from "state + events". Before committing, we compared it against established architectures from robotics, game AI, distributed systems and cognitive science. Most of what we built turned out to have a well-known ancestor, which we treat as a good sign: we inherit their solutions and their known failure modes.

## What we are, in known terms

| Architecture | Where it's from | How it maps to the entity |
|---|---|---|
| Three-layer architecture (3T) | Robotics | Reactive controller = code watches, sequencer = motor programs calling Jev, deliberator = LLM limbs. Its known failure mode is the layers drifting out of sync, which our commit-time checks against the log address. |
| Blackboard systems | 1970s AI (Hearsay-II speech recognition) | Specialists reading and writing one shared store: limbs over the log and its projections. |
| Subsumption | Rodney Brooks, robotics | Fast layers act and slow layers adjust them: the mind programs watches and motor programs. |

## Adopted

| Idea | From | What changed | Where |
|---|---|---|---|
| Event log as the only truth, state as projections | Event sourcing | State is no longer a mutable store. Each limb reads its own projection, so `view` is a real concept. Replay, time travel, test stories and lossless eviction come almost for free. | [core-model.md](core-model.md) |
| Events vs. levels | Functional reactive programming (events vs. behaviours) | Held keys, typing, speech overlap and thinking are levels with a start time. Watches can say "held > 2 s" directly. We call them levels to avoid clashing with behaviour trees. | [core-model.md](core-model.md#levels-and-events) |
| Watches as data, programs as sandboxed JS | Game AI (behaviour trees) and plain code | We first chose behaviour trees for programs, then switched to sandboxed JS: stateful logic like E1's Morse decoder is trivial in JS and painful as tree data. Watches stay validated data. Risk is enforced at the effect boundary. | [architecture.md](architecture.md#code-limbs-watches-and-programs) |
| Supervision trees for lifecycle | Erlang/OTP | Cancel = `shutdown` with timeout, kill = `brutal_kill`, restart policies (`permanent`, `transient`, `temporary`), restart intensity, and failing upward. | [topology.md](topology.md#supervision) |
| Arbitration with bids | Global workspace theory | Designed, then deferred. v1 uses the degenerate rule "the newest voice run owns the voice". | [future.md](future.md#arbitration) |
| Native full-duplex voice models as a limb type | OpenAI Realtime, Gemini Live, Moshi | In M4 a realtime speech model can be the voice limb, while our limbs think and the core keeps the log and output stops. | [host-api.md](host-api.md), [plan.md](plan.md) |
| A throwaway spike before building | Engineering practice | M0.5 measures real latency with one LLM, the keypad, output stops and a code watch before we build the core properly. | [plan.md](plan.md#milestones) |

## Deferred

| Idea | Why not now |
|---|---|
| MCP servers as channels | MCP has resources, subscriptions and tools, which map to state, events and effects. It isn't realtime-grade and has no risk classes, so it becomes an adapter after v1, not the core. |
| Peer topology with real bidding | Current models trample each other without a head. |

## Kept open, to measure

| Question | How we decide |
|---|---|
| Jev vs. a small fast LLM behind `judge` / `sense` | Jev offers calibrated probabilities, low cost and speed, while a small LLM can also generate. Both sit behind the `Evaluator` interface, and M3 compares them on the Jev scenarios for accuracy, latency and cost. |

## Rejected

| Idea | Why not |
|---|---|
| Building the core around a native realtime voice model | Fast and natively interruptible, but weaker reasoning, vendor-specific, and little control over output stops, projections or authority. It stays one limb type among others. |
| Pure actor model with no shared store | Actors with mailboxes fit societies and lifecycle well, which is why we took OTP supervision. Without a shared log, every limb would need its own copy of the world and coordination would become message chatter. The log plus supervision gives us both. |
| One long-lived transcript with compaction | This is how standard agents work. Cost is unpredictable, compaction loses information, and interruption is awkward. Per-task context and checkpoints into the log replace it. |
| A new scripting DSL for watches and programs | One more language to design, validate and teach the model. Watches are data; programs are JS, which models already write well. |
| Jev as a separate actor (an evaluator limb or controller) | A function is simpler. Code calls `judge` / `sense` and decides what to do with the number, so Jev can never act and needs no authority rules. The runtime keeps what an actor would give us: batching, coalescing, stale checks and logging. |
