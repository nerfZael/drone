# Limbs

An entity's mind is a set of **limbs**: concurrent workers that share one event log and one orchestrator, each reading its own projection of it. v1 has one shape: a head that also speaks and routes, workers (task limbs on a strong model) it dispatches, and the code limbs they write. Richer shapes (hierarchies, peers, nested entities) are in [future.md](future.md).

A limb is defined by its **contract**, not by what's inside it. It reads a projection of the log, commits effects allowed by its capabilities and their risk class, spends a budget, and has a supervising parent.

| Kind | What its "thinking" is | Examples | Budget |
|---|---|---|---|
| **LLM limb** | Generating: talking, planning, writing code limbs | head and voice (gpt-6-luna), task limbs (gpt-6-sol) | tokens per minute |
| **Code limb** | Executing: millisecond reactions, calling Jev when a condition needs meaning | every watch and program an LLM limb installs | effect rate limit plus its Jev calls |

Code limbs are children of the LLM limb that wrote them. That limb supervises them, can cancel or replace them, and pays for them, including their Jev calls, from its budget. So one supervision tree, one authority model and one inspector view cover everything that runs. Jev itself is not a limb: it is a [runtime primitive](architecture.md#jev-as-a-runtime-primitive) (`judge`, `sense`) that code calls, and it only returns numbers.

A limb's configuration:

| Field | Example |
|---|---|
| `kind` and `model` | `llm` with gpt-6-luna or gpt-6-sol, or `code` with the watch or program it runs |
| `role` | a short system prompt: "head", "task" |
| `parent` | the limb that spawned it and holds authority over it; none for the root |
| `capabilities` | what it may do: `speak`, `set_watch`, `run_program`, `cancel`, `kill` |
| `view` | its projection of the event log: which sections and how much history it sees |
| `restart` | `permanent` or `transient` (see below) |
| `budget` | tokens per minute and concurrency, handed down from its parent |

## Work goes through state; lifecycle goes through signals

- **Work.** Tasks and results are events in the log, projected into each limb's state. The front limb assigns work by dispatching a worker with a task; the worker replies to the user itself and commits its result. See [parallel-conversation.md](parallel-conversation.md).
- **Lifecycle.** Pause, cancel and kill are direct signals from the orchestrator. They take effect immediately, like OS signals, and are logged as events. A child could delay a directive written to state; it can't delay a signal.

## Supervision

Lifecycle borrows from Erlang/OTP supervision trees. Every parent is its children's supervisor.

- **Cancel and kill.** Parents can stop their own children. **Cancel** (the default) lets the child checkpoint and stop within a grace period. **Kill** fires the child's abort controller at once and drops its partial output. A cancel that isn't honoured in time becomes a kill, and running out of budget also kills. Everything up to the kill stays in the log. Jev can do neither: it only returns numbers.
- **Restart policy.** `permanent` limbs (the head) are always restarted from their checkpoint. `transient` limbs (task limbs, code limbs) are restarted only if they crashed, not if they finished.
- **Restart cap.** A supervisor allows at most N restarts in T seconds. Past that, it gives up and reports `limb_failed` to its parent. At the root, the entity falls back to [the floor](architecture.md#the-floor-never-worse-than-a-normal-agent). This stops a crashing limb from burning budget in a loop.

## Rules

1. **Head and voice are roles, and the split is configurable.** By default one limb (the head) plays both. With `voiceModel` set, a separate **voice limb** on a fast model answers first: it handles simple things itself (small talk, short answers, simple key presses), dispatches and steers workers for real work, and hands ongoing behaviour (watches, programs) to the head with `handoff(note)`. The head can still speak directly, so its answers are not relayed. Simple messages never reach the head. Output stops of scope `work` do not silence the voice.
2. **The newest run of each speaking limb owns its voice.** A busy voice never makes a new wake queue: the wake starts a parallel run (see [the floor](architecture.md#the-floor-never-worse-than-a-normal-agent)). To stop two runs acting on the same thing, only the newest voice run may act. Every action an older run tries returns `superseded`, except `note`, so it can leave what it knows for the newer run. Its thinking is not killed; it just can't act any more. Guarding only `say` was not enough: in M2 two head runs each started a Morse decoder. Workers speak for themselves, in threads tagged with the message they answer.
3. **Conflicts are about dependencies, not time.** Each effect declares what it depends on (see [core-model.md](core-model.md#effects)). It is rejected only if one of those things changed since the limb read it. The log advancing with unrelated keystrokes or ticks is not a conflict.
4. **Budgets flow down the tree.** A parent gives its children part of its own budget. Depth and spawn caps apply.
5. **Jev calls are shared.** All `judge` and `sense` questions from every code limb are batched by the runtime, so ten code limbs sensing ten things cost about one Jev call per tick, not ten.

## Default v1 config

Limbs run in parallel. A wake that arrives while a limb is busy starts a new run instead of queuing.

| Limb | Model | Role |
|---|---|---|
| Head (and voice, unless split) | `openai-codex/gpt-6-luna`, medium reasoning | Replies, routes messages, installs watches and programs, dispatches workers |
| Voice (optional, `voiceModel`) | `cerebras/qwen-3.8-27b` | Answers first in about 0.5-1.3 s; routes, and hands ongoing behaviour to the head |
| Task limbs | `openai-codex/gpt-6-sol`, medium reasoning | Real work, dispatched per request; they reply to the user themselves |
| Fast reflex limb (optional) | `cerebras/qwen-3.8-27b` | Sub-second watch setup where speed is being tested. Not a planner, not cached, and billed per API call rather than on the subscription, so it's off by default |
| Code limbs | none: plain code | Every watch and program, supervised by the LLM limb that wrote it |
| Jev (M3) | Runtime primitive, not a limb | `judge` and `sense`, called from code limbs |

The Codex models run on the subscription. In the spike, gpt-6-luna reached its first action in about 1.5–2 s and Cerebras qwen in about 0.5 s; see [plan.md](plan.md#m05-spike-results).
