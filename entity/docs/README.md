# Entity

An entity is a realtime AI agent: a continuous control loop over an **event log** and the **state** projected from it, not a turn-based chat. It wakes whenever something happens, reads a fresh, bounded context, acts, and can be interrupted at any moment.

- **No long-lived transcript, no compaction.** Reactive runs start from a fresh context rendered from state and events. Task runs keep their context only while the task lives, and state is what persists.
- **Not turn-based.** The entity can speak first, send several messages, press buttons, or stay silent while events pile up.
- **Three speeds.** Code reacts in milliseconds, Jev judges in hundreds of milliseconds, and the LLM thinks in seconds. The LLM programs the two faster tiers, so it doesn't have to be fast itself.
- **Library first.** The logic lives in packages under `entity/packages/` (starting with `@entity/core`). A Drone Hub popup is only the test bench.

## Docs

| Doc | Covers |
|---|---|
| [demo.md](demo.md) | The Drone Hub test bench, scenarios and latency targets |
| [core-model.md](core-model.md) | Event log, projections, events and levels, effects, time, holds |
| [host-api.md](host-api.md) | The host interface and channels: chat, keypad, speech |
| [architecture.md](architecture.md) | Tiers, watches and behaviour trees, Jev's authority, the floor, guardrails, user controls |
| [topology.md](topology.md) | Limbs, work vs. lifecycle, supervision, topology presets, arbitration, nested entities |
| [context-and-memory.md](context-and-memory.md) | Fresh vs. kept context, caching, memory layers |
| [plan.md](plan.md) | Codebase plan, milestones, decisions, open questions, later |
| [alternatives.md](alternatives.md) | Architectures we compared the design against, and what we took or rejected |

## What makes it novel

The slow model **programs its own fast attention**. Each tier becomes faster by being specified by the tier above it, not by getting smarter itself.

1. **Self-authored interrupts.** Every thought ships with the conditions that should stop its actions. Jev and code enforce them in real time by holding effects, and the thought itself decides what happens next. Standard agents can only be interrupted by a human pressing stop.
2. **Thinking that can be parked.** Fresh context per wake, per-task context and checkpoints into state make starting, parking and resuming a thought normal operations. Losing a thought is never forced.
3. **Effects as optimistic transactions.** Actions are validated against the current state when they commit, so a slow mind can act safely in a world that moved on while it was thinking.
4. **A classifier as the attention and recall system.** Jev gates wakes, routes events that arrive mid-thought, and picks memories to page in. The generative model is used only where generation is needed.
5. **Behaviour migrates downward.** Skills start as mind reasoning, become motor programs and watches, and are stored and recalled. The entity gets faster at things it has done before.
6. **Topology as configuration.** A head with limbs, a hierarchy, peers, or entities nested inside entities are all the same parts configured differently. As models get better at cooperating, the entity can move from one head toward a society without a rewrite.

We can measure it. Record every session with the reflex recorder, replay it against changed watches or prompts, and track **reaction latency per tier**, **wrongful interrupts** and **missed interrupts** alongside the pass/fail result of each scenario.
