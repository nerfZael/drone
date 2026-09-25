# Entity

An entity is a realtime AI agent: a continuous control loop over an **event log** and the **state** projected from it, not a turn-based chat. It wakes whenever something happens, reads a fresh, bounded context, acts, and can be interrupted at any moment.

- **No long-lived transcript, no compaction.** Reactive runs start from a fresh context rendered from state and events. Task runs keep their context only while the task lives, and state is what persists.
- **Not turn-based.** The entity can speak first, send several messages, press buttons, or stay silent while events pile up.
- **LLM limbs write code limbs, and code can call Jev.** Code reacts in milliseconds, the LLM thinks in seconds, and Jev is a function (`judge`, `sense`) that turns fuzzy things like "is the user confused?" into calibrated numbers in hundreds of milliseconds. No part has to be good at everything.
- **Library first.** The logic lives in packages under `entity/packages/` (starting with `@entity/core`). A Drone Hub popup is only the test bench.

## Docs

| Doc | Covers |
|---|---|
| [demo.md](demo.md) | The Drone Hub test bench, scenarios, end-to-end stories and latency targets |
| [session-logs.md](session-logs.md) | Where sessions are recorded, the log format, and replaying them in the bench |
| [core-model.md](core-model.md) | Event log, projections, events and levels, effects, time, output stops |
| [host-api.md](host-api.md) | The host interface and channels: chat, keypad, speech |
| [architecture.md](architecture.md) | Limb kinds, Jev as a primitive, watches (data) and programs (sandboxed JS), risk classes, the floor, guardrails, user controls |
| [topology.md](topology.md) | Limbs, work vs. lifecycle, supervision, the voice rule, default models |
| [context-and-memory.md](context-and-memory.md) | Fresh vs. kept context, caching, memory layers |
| [parallel-conversation.md](parallel-conversation.md) | Every message gets a capable worker at once: dispatch, fork, steer, threaded replies, claims, workspace tools |
| [coding.md](coding.md) | Coding as a search: parallel candidates in worktrees, evidence-based pruning, live steering, spend policy |
| [plan.md](plan.md) | Codebase plan, milestones, decisions, open questions, later |
| [future.md](future.md) | Designed but not in v1: richer topologies, arbitration, cascades, automatic memory, more hosts |
| [alternatives.md](alternatives.md) | Architectures we compared the design against, and what we took or rejected |

## What makes it novel

The slow model **programs its own fast attention**. Each tier becomes faster by being specified by the tier above it, not by getting smarter itself.

To be honest about it: an LLM writing code is not new, and most of what the entity does fast is exactly that. What is new is the loop around it. The code keeps running while the model keeps talking. Coaching rewrites the code live without stopping it. Interrupts are authored by the thought they interrupt. And it is all one persistent entity, not write-then-run.

1. **Self-authored interrupts.** Every thought ships with the conditions that should stop its actions. Code limbs enforce them, calling Jev for fuzzy conditions, in real time by stopping output, and the thought itself decides what happens next. Standard agents can only be interrupted by a human pressing stop.
2. **Thinking that can be parked.** Fresh context per wake, per-task context and checkpoints into state make starting, parking and resuming a thought normal operations. Losing a thought is never forced.
3. **Effects as optimistic transactions.** Actions are validated against the current state when they commit, so a slow mind can act safely in a world that moved on while it was thinking.
4. **Self-authored senses.** The slow model writes not only its reflexes but its own perception: `sense` questions that Jev answers continuously with calibrated probabilities, turning "is the user confused?" into `user.confused = 0.83`. That makes the fuzzy world codeable, so millisecond code can react to meaning. The same fast judge gates commits (cascades from a fast model to a strong one) and routes work by difficulty.
5. **Behaviour can migrate downward.** Skills start as mind reasoning and become watches and programs. Saving and recalling the ones that work, so the entity gets faster at things it has done before, is designed in [future.md](future.md#memory).
6. **Topology as configuration.** v1 is a head with limbs. Hierarchies, peers and entities nested inside entities are the same parts configured differently ([future.md](future.md#topology)), so the entity can move toward a society without a rewrite.

We can measure it. Record every session with the reflex recorder, replay it against changed watches or prompts, and track **reaction latency per tier**, **wrongful interrupts** and **missed interrupts** alongside the pass/fail result of each scenario.
