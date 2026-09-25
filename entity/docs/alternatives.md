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
| Event log as the only truth, state as projections | Event sourcing | State is no longer a mutable store; everything is projected from the log. Recording, replay and test stories come almost for free, and per-limb views and lossless eviction are possible later. | [core-model.md](core-model.md) |
| Events vs. levels | Functional reactive programming (events vs. behaviours) | Held keys, typing and sensed values are levels with a start time. Watches can say "held > 2 s" directly. We call them levels to avoid clashing with behaviour trees. | [core-model.md](core-model.md#levels-and-events) |
| Watches as data, programs as sandboxed JS | Game AI (behaviour trees) and plain code | We first chose behaviour trees for programs, then switched to sandboxed JS: stateful logic like E1's Morse decoder is trivial in JS and painful as tree data. Watches stay validated data. Risk is enforced at the effect boundary. | [architecture.md](architecture.md#code-limbs-watches-and-programs) |
| Supervision trees for lifecycle | Erlang/OTP | Cancel = `shutdown` with timeout, kill = `brutal_kill`, restart intensity (a crashing worker is retried a few times, then fails). `temporary` children and group restarts are in [future.md](future.md#supervision-extras). | [topology.md](topology.md#supervision) |
| Arbitration with bids | Global workspace theory | Designed, then deferred. Today's rule, "the newest run owns the voice", is the degenerate case. | [future.md](future.md#arbitration) |
| Native full-duplex voice models as a limb type | OpenAI Realtime, Gemini Live, Moshi | In M4 a realtime speech model can be the voice limb, while our limbs think and the core keeps the log and output stops. | [host-api.md](host-api.md), [plan.md](plan.md) |
| A throwaway spike before building | Engineering practice | M0.5 measured real latency with one LLM, the keypad, output stops and a code watch before the core was built, and changed four design decisions. | [plan.md](plan.md#m05-spike) |
| Jev behind `judge` / `sense` rather than a small fast LLM | Measured in M3 | Jev was faster and far more reliable live: about a third of qwen's calls returned no parseable answer. Both sit behind the `Evaluator` interface, so the choice can change. | [plan.md](plan.md#m3) |

## Deferred

| Idea | Why not now |
|---|---|
| MCP servers as channels | Not realtime-grade and no risk classes, so it becomes an adapter, not the core ([future.md](future.md#channels-and-hosts)). |
| Peer topology with real bidding | Current models trample each other without a head. |

## Rejected

| Idea | Why not |
|---|---|
| Building the core around a native realtime voice model | Fast and natively interruptible, but weaker reasoning, vendor-specific, and little control over output stops, projections or authority. It stays one limb type among others. |
| Pure actor model with no shared store | Actors with mailboxes fit societies and lifecycle well, which is why we took OTP supervision. Without a shared log, every limb would need its own copy of the world and coordination would become message chatter. The log plus supervision gives us both. |
| One long-lived transcript with compaction | This is how standard agents work. Cost is unpredictable, compaction loses information, and interruption is awkward. Fresh context per wake and per-worker conversations replace it. |
| A new scripting DSL for watches and programs | One more language to design, validate and teach the model. Watches are data; programs are JS, which models already write well. |
| Jev as a separate actor (an evaluator limb or controller) | A function is simpler. Code calls `judge` / `sense` and decides what to do with the number, so Jev can never act and needs no authority rules. The runtime keeps what an actor would give us: coalescing, caps, timeouts and logging. |
