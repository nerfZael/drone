# Topology

An entity's mind is a set of **limbs** that share one event log and one orchestrator. v1 has one shape: a head, an optional fast voice in front of it, an optional reviewer, workers, and the code limbs they write. Richer shapes (hierarchies, peers, nested entities) are in [future.md](future.md#topology).

A limb is defined by its **contract**, not by what's inside it: it reads its render of the log, acts through the tools and effects its capabilities allow, and has a supervising parent.

## The limbs

| Limb | Kind | Context | Does |
|---|---|---|---|
| **Head** | LLM, permanent | Fresh each wake | The front limb unless there is a voice: routes messages, answers quick ones, sets up watches and programs. Always the orchestrator: woken on claim conflicts, handoffs and the heartbeat |
| **Voice** (optional, `models.voice`) | LLM, permanent | Fresh each wake | The front limb when configured: answers and routes first and fast, hands watches, programs and ongoing behaviour to the head (`handoff`) |
| **Reviewer** (optional, `review: 'separate'`) | LLM, permanent, on the head's model | Fresh each wake | Takes a second look at the front limb's answers and confirms, corrects or expands them (`amend`); hands needed work to the head |
| **Worker** (id `worker-N`) | LLM, transient | A conversation per worker, kept after it finishes | One piece of the user's work; replies in the chat itself ([parallel-conversation.md](parallel-conversation.md)) |
| **Watch** | Code | — | A validated condition → action ([architecture.md](architecture.md#code-limbs-watches-and-programs)) |
| **Program** | Code | — | Sandboxed JavaScript |

Code limbs are children of the LLM limb that wrote them; a worker's end cancels them. Workers are children of the head, whichever limb dispatched them.

Capabilities decide which tools and effects a limb gets:

| Limb | Capabilities | Router tools |
|---|---|---|
| Head | `speak`, `set_watch`, `run_program`, `cancel`, `kill` | `dispatch`, `dispatch_many`, `fork`, `steer` |
| Voice | `speak`, `cancel` | `dispatch`, `dispatch_many`, `fork`, `steer`, `handoff` |
| Reviewer | `speak`, read-only channel effects | `amend`, `handoff` |
| Worker | `speak`, `cancel`, plus `set_watch` and `run_program` when code limbs are on | `claim`, `release`, `share`, `finish_task` |
| Watch, program | Their author's | — |

The front limb (and the head) may cancel any worker; other limbs only their own children.

## Work goes through state; lifecycle goes through signals

- **Work.** Tasks and results are events in the log, projected into every limb's state. The front limb dispatches a worker with a task; the worker replies to the user itself and commits its result with `finish_task`. Past `maxTasks` (6) running workers, new ones wait as `queued` and start oldest first ([parallel-conversation.md](parallel-conversation.md)).
- **Lifecycle.** Pause, cancel and kill act directly, not through state. Kill aborts a worker's run at once. Cancel asks it to wrap up: from its next tool call on it may only `say`, `note`, read and `finish_task`, and it ends as `cancelled` with what it had. It becomes a kill after 3 s if it doesn't finish.

## Supervision

Lifecycle borrows from Erlang/OTP supervision trees: parents supervise their children.

- **Cancel and kill.** Cancel (the default) lets the child finish within a grace period; kill drops its partial work. Everything up to the kill stays in the log. Jev can do neither: it only returns numbers.
- **Restarts.** A worker whose run crashes is woken again, at most 3 times in a minute; past that it is finished as failed. Every crash is logged as `limb_failed`. The head is not restarted; the next event wakes it. Code limbs are not restarted. The `permanent` / `transient` marking on each limb is recorded but not otherwise used yet.

## Rules

1. **Head and voice are roles, and the split is configurable.** By default one limb (the head) plays both. With a voice model set, a separate **voice limb** answers first: it handles quick things itself (small talk, short answers, simple key presses), dispatches and steers workers for real work, and hands ongoing behaviour (watches, programs) to the head with `handoff(note)`. Simple messages never reach the head. Output stops of scope `work` do not silence the voice.
2. **The newest run of each speaking limb owns its voice.** A busy reactive limb never makes a new wake queue: the wake starts a parallel run ([architecture.md](architecture.md#the-floor-never-worse-than-a-normal-agent)). To stop two runs acting on the same thing, only the newest may act; every action an older run tries returns `superseded`, except `note`, `handoff` and read-only effects, so it can leave what it knows. The front limb is also superseded when a user message arrives after it read the state, and it doesn't act while the user is still typing. Guarding only `say` was not enough: in M2 two head runs each started a Morse decoder.
3. **Workers speak for themselves**, in threads tagged with the message they answer. Workers in a batch keep their replies in their own thread; the chat shows one progress line.
4. **Conflicts are about dependencies, not time.** An effect is rejected only if something it depends on changed since the limb read it ([core-model.md](core-model.md#effects-and-tools)); files two workers want are handled by claims.
5. **Jev calls are shared.** `sense` questions from every code limb are coalesced by the runtime, and answers are shared.

## Default config

Limbs run in parallel. A wake that arrives while a reactive limb is busy starts a new run; a busy worker hears updates with its next tool result.

| Limb | Model | Notes |
|---|---|---|
| Head | `openai-codex/gpt-6-luna`, medium reasoning | At most 8 steps per run |
| Voice | off | Cerebras qwen (`cerebras/qwen-3.8-27b`) answered first in 0.5–1.3 s in M3; gpt-6-luna as a voice adds handoffs without adding speed |
| Reviewer | the head's model | On by default in the Hub (`review: 'separate'`), off by default in the library |
| Workers | `openai-codex/gpt-6-sol`, medium reasoning | At most 24 steps per run, continued up to 4 times; the router may pick the head model for small requests |
| Code limbs | none: plain code | At most 32 |
| Jev | runtime primitive, not a limb | Off by default in the Hub; turn it on for senses |

Live tests use only Codex gpt-6-sol and gpt-6-luna on medium reasoning, which run on the subscription. Cerebras qwen is for rare speed tests only: it is fast but not smart, prompt caching barely works there, and it bills per call. Spike and milestone numbers are in [plan.md](plan.md#results).

Not built yet: token budgets per limb that flow down the tree, and depth caps; see [future.md](future.md).
