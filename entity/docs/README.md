# Entity

An entity is a realtime AI agent: a continuous control loop over an **event log** and the **state** projected from it, not a turn-based chat. It wakes whenever something happens, reads a fresh, bounded context, acts, and can be interrupted at any moment.

- **No long-lived transcript.** The head, voice and reviewer start every run from a fresh context rendered from state and events. Workers keep a conversation for their task, and state is what persists.
- **Not turn-based.** The entity can speak first, send several messages, press buttons, or stay silent while events pile up.
- **LLM limbs write code limbs, and code can call Jev.** Code reacts in milliseconds, the LLM thinks in seconds, and Jev is a function (`judge`, `sense`) that turns fuzzy things like "is the user confused?" into calibrated numbers in hundreds of milliseconds. No part has to be good at everything.
- **Many workers at once.** Every message that needs real work gets a worker right away. Workers reply for themselves, and a fast front limb routes, answers and steers while a stronger model reviews its answers.
- **Library first.** The logic lives in `@entity/core`. Drone Hub's Entity window is the test bench.

## Terms

- **Limb**: the runtime's unit of supervision. The head, the voice, the reviewer, workers, watches and programs are all limbs.
- **Front limb**: the limb that handles your messages first: the voice when one is configured, otherwise the head.
- **Worker**: a limb (role `task` in code, id `worker-N`) that handles one piece of your work. The UI shows its name.
- **Chat** is where you talk to the entity; a worker's own conversation is its **thread**.

## Docs

**How it works**

| Doc | Covers |
|---|---|
| [core-model.md](core-model.md) | Event log, state and what each limb sees, events and levels, effects, time, output stops |
| [architecture.md](architecture.md) | Limb kinds, Jev as a primitive, watches (data) and programs (sandboxed JS), risk classes, the floor, guardrails, user controls |
| [topology.md](topology.md) | The limbs and their capabilities, supervision, the voice rule, default models |
| [host-api.md](host-api.md) | The host interface (`Entity`, `Mind`, `Evaluator`) and the channels: chat, keypad, workspace |
| [context-and-memory.md](context-and-memory.md) | What each limb's context holds, kept worker conversations, memory |

**Conversation and UI**

| Doc | Covers |
|---|---|
| [parallel-conversation.md](parallel-conversation.md) | Routing every message: dispatch, fork, steer, batches, the worker queue, rerouting, answer review, the routing eval |
| [work-canvas.md](work-canvas.md) | The Work tab as a map: time rows, lineage columns, arrows, folds, group cards, the side panel |
| [demo.md](demo.md) | The bench, scenarios, end-to-end stories and latency targets |
| [session-logs.md](session-logs.md) | Where sessions are recorded, the log format, and replaying them in the bench |

**Direction and status**

| Doc | Covers |
|---|---|
| [plan.md](plan.md) | Milestones, decisions, results, open questions |
| [coding.md](coding.md) | Coding as a search: parallel candidates in worktrees, evidence-based pruning, live steering, spend policy |
| [future.md](future.md) | Designed but not built: richer topologies, arbitration, memory, budgets, more hosts |
| [alternatives.md](alternatives.md) | Architectures we compared the design against, and what we took or rejected |

## Code

| Where | What |
|---|---|
| `entity/packages/core` | `@entity/core`: the runtime (`entity.ts`), channels, watches, the program sandbox, Jev, prompts. Tests in `tests/` |
| `apps/drone/src/hub/entity` | The Hub's session: the pi-ai mind, Jev evaluator, work summarizer, recorder and the `/api/entity/*` routes |
| `apps/drone-hub/src/droneHub/entity` | The bench UI: chat, keypad, Brain, Work (canvas, rows, cards), Inspector, Files, replay |
| `entity/evals` | Routing cases, run with `bun apps/drone/scripts/entity-routing-eval.ts` |
| `entity/spike` | The M0.5 spike and its findings |

## What makes it novel

The slow model **programs its own fast attention**. Each tier becomes faster by being specified by the tier above it, not by getting smarter itself.

To be honest about it: an LLM writing code is not new, and most of what the entity does fast is exactly that. What is new is the loop around it. The code keeps running while the model keeps talking. Coaching rewrites the code live without stopping it. Interrupts are authored by the thought they interrupt. And it is all one persistent entity, not write-then-run.

1. **Self-authored interrupts.** Every thought ships with the conditions that should stop its actions. Code limbs enforce them, calling Jev for fuzzy conditions, in real time by stopping output, and the thought itself decides what happens next. Standard agents can only be interrupted by a human pressing stop.
2. **Thinking that can be parked.** Fresh context per wake, kept worker conversations and state make starting, parking and resuming a thought normal operations. Checkpoints that would let a worker survive a restart are designed, not built ([context-and-memory.md](context-and-memory.md)).
3. **Effects as optimistic transactions.** Actions are validated against the current state when they commit, so a slow mind can act safely in a world that moved on while it was thinking.
4. **Self-authored senses.** The slow model writes not only its reflexes but its own perception: `sense` questions that Jev answers continuously with calibrated probabilities, turning "is the user confused?" into `user.confused = 0.83`. That makes the fuzzy world codeable, so millisecond code can react to meaning.
5. **Fast answers, checked.** A fast front limb answers and routes; a stronger model reviews every answer and corrects it in the open ([parallel-conversation.md](parallel-conversation.md#second-looks)).
6. **Behaviour can migrate downward.** Skills start as mind reasoning and become watches and programs. Saving and recalling the ones that work is designed in [future.md](future.md#memory).
7. **Topology as configuration.** v1 is a head with limbs. Hierarchies, peers and entities nested inside entities are the same parts configured differently ([future.md](future.md#topology)).

We measure it with scenario tests, live runs recorded in [plan.md](plan.md#results), and the routing eval. Every session is recorded and can be replayed in the bench ([session-logs.md](session-logs.md)).
