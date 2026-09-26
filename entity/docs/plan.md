# Plan

## Milestones

Scenarios are in [demo.md](demo.md). Jev (`judge` and `sense`) came in at M3: scenarios 1–4, 9, E1 and E2 don't need it; 5–8, E3 and E4 exist to prove it.

| Milestone | Delivers | Done when | Status |
|---|---|---|---|
| M0 | Jev voice removed from Companion, so the Jev call has one owner | Companion tests green, no reflex imports left in assistant-chat | Done (`9e9fdf8b0`) |
| M0.5 | Throwaway spike: one LLM, the keypad, output stops and one code watch | Real latencies measured for scenarios 2–4 and 9 | Done; `entity/spike/` |
| M1 | `@entity/core`: event log and state, levels, watches and sandboxed programs, supervision, host API, chat and keypad channels, guardrails, fake mind | Scenarios 1–4 and 9 pass as stories in tests | Done |
| M2 | LLM limbs via pi-ai, Hub routes, the Entity window with Start / Pause / Resume / Reset | Scenarios 1–4 and 9 pass live; E1 (Morse) and E2 (deep work you can still talk to) pass | Done |
| M3 | `judge` and `sense`; Jev compared against a small fast LLM | Scenarios 5–8, E3 and E4 pass live, the floor passes with Jev and code limbs off, interrupts measured, the backing model chosen | Done |
| M3.5 | Workers: parallel conversation as the only mode, the workspace channel, the worker queue, batches, steer-after, rerouting, answer review, work summaries, session recording and replay, the routing eval | Several workers run and reply at once; the routing eval passes on luna; fast answers are reviewed | Done (`00ed05184`–`dc786e65a`) |
| M3.6 | The Work canvas | Work is readable at a glance from one message to a 100-worker batch | Done (`dc786e65a`); gaps in [work-canvas.md](work-canvas.md#not-built-yet) |
| M3.7 | Resumable sessions: the runtime state is a projection of the log, and worker conversations are saved with the recording | After a Hub restart, a session continues where it stopped | Done |
| M4 | Speech in and speech out, plus a native full-duplex realtime model as an optional voice limb | The user talks, the entity talks back, and it reacts to overlap | Not started |
| M5 | Memory: long-term store, explicit `remember` / `recall` | The entity recalls a fact or a program from an earlier session | Not started |

**How it is built.** `@entity/core` (`entity/packages/core`) has no UI and no blip dependency. The Hub's mind (`apps/drone/src/hub/entity/entity-mind.ts`) calls pi-ai directly rather than blip, because blip's session machinery (persistence, compaction) is what reactive wakes don't want; tool calls commit as soon as they stream, and usage is journaled like other Hub generations. The Hub's `/api/reflex/evaluate` path backs Jev. The orchestrator runs on the server next to the model and Jev calls, and the bench (a `DesktopChatWindow kind="tool"`) talks to it over `/api/entity/*` and SSE.

## Decided

Why we chose these, and what we rejected, is in [alternatives.md](alternatives.md).

- **Names.** The system is called **entity**. It lives in `entity/`, with docs in `entity/docs/` and packages in `entity/packages/`.
- **Log and state.** The event log is the only source of truth; state is a projection of it. The world has events (instants) and levels (values held over time), and watches can condition on both, with durations.
- **Chat in state.** The recent chat and the draft are always in state and go into every context; older history is paged in with tools. The entity sees the user's unsent draft, marked as unsent.
- **Channels.** Chat, keypad, workspace and speech are channels built on the host API, not core.
- **Output stops.** Interrupts stop output (`stop_output` / `resume_output`) and notify the limb; thoughts are never killed by default. A stop has a scope (`work` by default) and a mode (`stop` cancels, `freeze` pauses), and covers only the work in flight when it was issued. We don't call it "hold": models confused it with holding a key.
- **Jev** is a runtime primitive, not a limb: `judge` for a one-shot probability, `sense` for a continuous level. It only returns numbers, and it is for perception, not for checking correctness. Jev (not qwen) backs it, chosen in M3. It is billed per call, so the runtime caps calls per minute and per session.
- **Limbs.** Two kinds under one contract: LLM limbs and the code limbs they write, which are children of their author. Watches are validated data; programs are sandboxed JS (E1's Morse decoder decided it: stateful logic is trivial in JS and painful as data). Program events are strict, and a program can `wake(reason)` its author.
- **Parallel runs.** A busy reactive limb never makes a new wake queue: the wake starts a parallel run, and the newest run owns the limb's actions.
- **One conversation mode** (2026-09-25): the front limb answers quick things, does what takes seconds itself, and dispatches real work to workers, who reply for themselves. Only the front limb and the head dispatch; `spawn` and `report` are gone. The routing rules are in [parallel-conversation.md](parallel-conversation.md#routing-rules).
- **Voice split.** Head and voice can be split by configuration: a fast voice answers and routes first, and hands ongoing behaviour to the head.
- **Asking the user.** A worker that needs an answer calls `ask`, a tool that ends its turn and keeps it waiting, not a flag it can forget (see results).
- **Review.** Every fast answer gets a second look from a stronger model, decided by the runtime, not the fast model. Corrections are shown struck through with the fix below, never as silent edits.
- **Supervision** follows OTP: cancel with a grace period, then kill; restart caps.
- **Validation.** Everything the entity writes is validated, and errors go back to the model as tool results.
- **Models and tests.** Live tests use only Codex gpt-6-sol and gpt-6-luna on medium reasoning. Cerebras qwen is for rare speed tests only: fast but not smart, barely cached, and billed per call. Scenarios test capabilities, not scripted behaviour, and fixes are general rules, never tuned to one scenario.
- **User controls.** Start, Pause, Resume and Reset belong to the user.

## Open questions

- [ ] Which backup model does each limb fall back to when its model fails? (gpt-6-luna for gpt-6-sol is the obvious candidate; luna itself needs one too.)
- [ ] How to make E1-style one-shot programs reliable: test a program against made-up input before installing it?

## Results

Numbers are from single runs unless a count is given, so treat them as rough. Live runs use gpt-6-luna as head and gpt-6-sol for workers, medium reasoning.

### M0.5 spike

Full notes are in `entity/spike/FINDINGS.md`.

| Model | 2: msg → 556 | 3: watch ready / mirror | 4: stop on 5 / ack | 9: watches ready / follow | Pass |
|---|---|---|---|---|---|
| gpt-6-sol, medium | 2.1 s | 5.5 s / < 0.1 ms | 0 ms, 0 extra numbers / 7.6 s | 5.4 s / < 0.1 ms | 4/4 |
| gpt-6-luna, medium | 1.8 s | 3.5 s / < 0.1 ms | 0 ms, 0 extra numbers / 10.1 s | 6.6 s / < 0.1 ms | 4/4 |
| Cerebras qwen-3.8-27b | 0.6 s | 1.6 s / < 0.1 ms | broken counting program | 2.9 s / < 0.2 ms | 3/4 |

It confirmed that code watches react in under 0.3 ms, that every model installed watches and programs unprompted, and that a fresh context per wake is enough. It changed the design in four ways: parallel limbs by default (slow acknowledgements came from one mind serialising its wakes), mandatory validation with errors returned to the model, "hold" renamed to `stop_output`, and qwen as an optional fast voice, not the head.

### M1

Story and runtime tests with a scripted mind cover scenarios 1–4 and 9, voice supersession, validation, dependencies, scoped stops and freezes, supervision, pause and resume, rate limits, level durations, `judge` / `sense`, ordered program reads and reset. The core now has 60 tests, each also checking that replaying its log rebuilds the runtime state, and the bench's canvas model and Work view have their own.

### M2

| Check | Result |
|---|---|
| Scenario 3, mirror, in the bench | 0.5–0.8 ms per key |
| Scenario 4, count and stop on 5 | 11 numbers, 0 after the press |
| E1, Morse | Decoded "HI" and tapped "OK" back with correct timing, 2.0 s after the last tap (11.8 s with gpt-6-sol as head) |
| E2, deep work you can still talk to | Nothing emitted while 9 was held; the task pressed 1–9 and finished; the question was answered in 2.4 s |
| First reply to a message | 2.4–7.4 s, over the 2 s target |

### M3

| | Jev | qwen |
|---|---|---|
| Labelled questions, one call each | 8/10, median 353 ms | 9/10, median 465 ms |
| Live scenarios 7, 8, 5 | All pass: press 5 from the draft in 4.3 s; reply before send in 3.4 s; stop 560 ms after an off-topic message | All fail: about a third of calls returned no parseable answer |

- **E3** failed at first: the entity answered a half-typed question and nothing checked it. Watches gained `when` conditions and the draft sense now waits for a 700 ms typing pause. The rerun answered "34" 2.9 s after the user stopped typing, before they sent. (Checking is now answer review's job.)
- **E4** passed on the rerun: the tutor pre-wrote a hint in a watch on `sense("is the user stuck…?")`, which fired 323 ms after the user got stuck.
- **Interrupts**, on 16 labelled conversations: for the subject-change sense at 0.75, 0/9 wrongful and 0/7 missed; median call 781 ms.
- **The floor** passes with senses and code limbs off: gpt-6-luna says hello (2.0 s), presses 556, and counts 1–5 in chat by itself.
- **First replies:** with a Cerebras qwen voice, 513–1251 ms; "repeat after me" was acknowledged in 645 ms, handed to the head, and the mirror then reacted in 0.83 ms.

### One conversation mode (2026-09-25)

| Scenario | Result |
|---|---|
| Coding: fix a failing test, a changelog entry, "how's it going?", another entry | Pass on the second run. The fix was dispatched in 2.5 s, the changelog request steered that worker, the question was answered from state in 3.2 s. The first run failed because the head fixed the bug itself, which led to the "seconds, not minutes" rule |
| Counting to 50, stop on 5 | Pass: stopped at 11 |
| E2 | Pass on the second run: the worker pressed 1–9 as it went and froze between 2 and 3 while 9 was held; the question was answered in 4.1 s. The first run failed because the head pressed the keys on a timer, which led to the rule about actions that belong to a piece of work |
| E3 | Pass: answered 3.6 s after typing stopped (34), confirmed |
| E1, Morse | 1 of 5 clean before the program fixes, 3 of 5 replied after strict events and `wake` (one reply garbled). Failures are in the decoder luna writes in one go, plus one runtime bug found and fixed: a stop issued to replace a decoder also blocked the replacement. Before the merge 2 of 3 passed; Morse is flaky either way |
| Batch: fix 8 files, one worker each | Pass: the router chose `dispatch_many`, 6 ran and 2 queued, all 8 files fixed about 35 s after the message; in the bench, Chat showed one progress line |

### Routing eval (2026-09-25)

Seven cases, gpt-6-luna. With the head in front: 30 of 32 runs right (5 of 7 on the first pass, both misses passed on rerun, then 21 of 21). With a gpt-6-luna voice: 13 of 14; the miss read the chat and took no action for a second message. After the compact per-role renders: 14 of 14 with the head in front. After the per-role tool table, `ask` and crash retries (2026-09-26): 14 of 14 again. With a case from a live session, "make it 6" (one batch of six, not a second batch of one): 3 of 3 with the head in front, 2 of 2 with a gpt-6-luna voice, and the full eval 8 of 8.

### Asking the user (2026-09-26)

A request that needs an answer first ("a poem about my favourite animal"), gpt-6-sol workers. With a `question` flag on `say`, the worker marked its question in 1 of 3 runs; in the others it asked and then called `finish_task`, so it showed as done. With the `ask` tool, which ends the worker's turn itself, 2 of 2 asked and waited, and the answer, routed to the worker as a steer, let it finish.

## Later

Everything designed but not built is in [future.md](future.md).
