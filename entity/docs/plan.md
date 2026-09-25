# Plan

## Codebase plan

We remove Companion's Jev voice mode so that `@drone/reflex` has one owner, then build the entity on top of reflex.

1. **Remove Jev voice from Companion.** This covers:
    - `use-companion-jev.ts`
    - `packages/assistant-chat/src/companion-reflex/*`
    - the Jev and Decisions tabs in `CompanionTranscriptDialog`
    - `CompanionAgentInsight` and `CompanionJevRequests`
    - the Jev settings and the mobile Jev rejection
    - `/api/reflex/compile`

    Keep `/api/reflex/evaluate` and the Jev gateway call as the server-side evaluator. Keep the live transcription path for the speech-in channel.
2. **Reuse `@drone/reflex` where it fits.** In practice, only its Jev call is reused: the Hub's `/api/reflex/evaluate` path backs `judge` / `sense`. `@entity/core` has its own small `JevService` (batching, coalesced re-asking, caps, timeouts, logged answers), because reflex's loop is shaped around rule tables. The rule table, the brain and the recorder are unused, and can be removed or merged later.
3. **New `entity/packages/core` (`@entity/core`)**, with no UI and no blip dependency. The `entity/packages/*` glob gets added to the root workspaces, like `blip/packages/*`.
    - the event log, reducers, per-limb projections, and effect commit
    - levels derived from events
    - watches as validated data and programs as sandboxed JS, with their guardrails
    - the host and channel API, and the chat and keypad channels
    - the orchestrator, limbs with OTP-style supervision, the voice rule (newest run owns the voice), effect dependencies, scoped output stops, and user controls
    - `Mind` and `Evaluator` interfaces, and the `judge` / `sense` primitives with batching, coalescing, timeouts and logged answers
    - story tests using a fake mind
4. **Mind adapter** in the Hub (`apps/drone/src/hub/entity/entity-mind.ts`). It calls pi-ai directly rather than blip, because blip's session machinery (persistence, compaction) is exactly what reactive wakes don't want. Each reactive wake gets a fresh context. Task limbs keep an in-memory conversation until they finish. Tool calls commit as effects as soon as they stream, and usage is journaled like other Hub generations.
5. **Hub routes.** Create a session, post events (key, chat), and stream state, events and mind activity over SSE. The orchestrator runs on the server, next to the LLM and Jev calls.
6. **Popup.** A `DesktopChatWindow kind="tool"` holding the chat (with both drafts), keypad, inspector with latency readouts, and Start / Pause / Resume / Reset controls. It reuses the assistant chat components where they fit.

## Milestones

The M0.5 spike comes first and is thrown away; it exists to measure before we build. Jev (`judge` and `sense`) comes in at milestone 3. Scenarios 1–4, 9, E1 and E2 don't need it; scenarios 5–8, E3 and E4 exist to prove it. Scenarios are in [demo.md](demo.md).

| Milestone | Delivers | Done when |
|---|---|---|
| M0 | Jev voice removed from Companion | Companion tests green, no reflex imports left in assistant-chat |
| M0.5 (done) | Throwaway spike: one LLM, the keypad, output stops and one code watch, hacked together in a few days | We have measured real latencies for scenarios 2–4 and 9, and know which parts of the design they confirm or break |
| M1 (done) | `@entity/core`: event log and projections, levels, watches and sandboxed programs, supervision, host API, chat and keypad channels, guardrails, fake mind | Scenarios 1–4 and 9 pass as stories in tests |
| M2 (done) | LLM limbs via pi-ai (gpt-6-luna head, gpt-6-sol tasks), Hub routes, popup with Start / Pause / Resume / Reset | Scenarios 1–4 and 9 pass live, within the latency targets; end-to-end stories E1 (Morse) and E2 (deep work you can still talk to) pass |
| M3 (done) | `judge` and `sense` primitives: senses (language into levels), cascades, routing, interrupt contracts; Jev compared against a small fast LLM | Scenarios 5–8 and end-to-end stories E3 (quick guess, careful correction) and E4 (live tutor) pass live, and 1–4 still pass with Jev and code limbs disabled (the floor); wrongful and missed interrupts measured; the backing model for `judge` / `sense` chosen by accuracy, latency and cost |
| M4 | Speech in and speech out channels, plus a native full-duplex realtime model as an optional voice limb | The user talks, the entity talks back, and it reacts to overlap, with both the chained and the native voice limb |
| M5 | Memory: episodic log, long-term store, explicit `remember` / `recall` | The entity recalls a fact or a program from an earlier session |

## Decided

- The system is called **entity**. It lives in `entity/`, with docs in `entity/docs/` and packages in `entity/packages/`.
- State budget is configurable per section.
- State can be written by the host (any schema) and by the entity (self, scratchpad), plus external tools and storage.
- The recent chat and the draft are always in state and go into every context. Older history is paged in with tools.
- The entity sees the user's unsent draft, marked as unsent. Entity chat arrives as whole messages, with an optional visible entity draft.
- Chat, keypad and speech are channels built on the host API, not core.
- Interrupts stop output (`stop_output` / `resume_output`) and notify the limb. We don't call it "hold": models confused it with holding a key. Thoughts are never killed by default. Jev only returns numbers; code decides what to do with them. Jev backs `judge` / `sense` (chosen in M3 over qwen). `judge` is for perception, not for checking correctness.
- Multiple models run as limbs, in parallel. The default is a gpt-6-luna head-and-voice limb plus gpt-6-sol task limbs (both Codex, medium reasoning), with Cerebras qwen as an optional fast reflex limb. See [topology.md](topology.md#default-v1-config).
- A busy limb never makes a new wake queue: the wake starts a parallel run.
- Head and voice can be split by configuration: a fast voice limb answers first and hands off to the head.
- Parallel conversation (`parallel: true`): every message gets a capable worker at once. Workers reply in threads, can be forked, steered or gated, claim files, and share discoveries. A workspace channel gives them file tools confined to one folder, with commands off by default. See [parallel-conversation.md](parallel-conversation.md).
- Limbs come in two kinds under one contract: LLM limbs and the code limbs they write. Code limbs are children of their author.
- Jev is a runtime primitive, not a limb: `judge(question)` for a one-shot probability and `sense(question)` for a continuous level. The runtime batches, coalesces, times out and logs every call, so replay stays deterministic. Jev makes the fuzzy world codeable: it senses, judges (cascades, fit checks, arbiter confidence) and routes.
- Output stops have a scope (`work` by default: everything under the owner but not the owner) and a mode (`stop` cancels, `freeze` pauses with nothing lost).
- Once a newer head run exists, an older run can no longer act, except to leave a note.
- Programs read events in order through their own cursor, and keypad events carry `held_ms` / `gap_ms`.
- Everything the entity writes is validated, and errors go back to the model as tool results.
- Live tests use only Codex gpt-6-sol and gpt-6-luna on medium reasoning. Cerebras qwen is for rare speed tests only: it is fast but not smart, prompt caching barely works there, and it bills per API call rather than on the subscription.
- Limbs see each other's status and committed results, not each other's context. In v1 only the voice limb spawns task limbs.
- Work flows through state, lifecycle through signals, and parents can cancel or kill their children.
- Context is kept per task, and checkpoints replace compaction.
- The user has Start, Pause, Resume and Reset.
- Scenarios test capabilities, not scripted behaviour.
- The event log is the only source of truth; state is a projection of it, and each limb has its own projection.
- The world has events (instants) and levels (values held over time); watches can condition on both, with durations.
- Watches are validated data (conditions extending reflex's shapes). Programs are sandboxed JS whose only capabilities are effects, `judge`, `sense`, `wait` and a read-only projection. E1's Morse decoder decided it: stateful logic is trivial in JS and painful as data.
- Limb lifecycle follows OTP supervision: shutdown vs. brutal kill, restart policies, restart intensity.
- The newest voice run owns the voice; older runs' `say` returns `superseded`. Arbitration with bids is in [future.md](future.md#arbitration).
- Effects declare their dependencies and are rejected only if those changed. Output stops are scoped to the installing limb's subtree by default.
- The heartbeat reaches code limbs every second and wakes an LLM limb only rarely.
- Jev is billed per call, so the runtime caps Jev calls per minute and per session.
- Why we chose these, and what we rejected, is in [alternatives.md](alternatives.md).

## Open questions

- [ ] Which backup model does each limb fall back to when its model fails? (gpt-6-luna for gpt-6-sol is the obvious candidate; luna itself needs one too.)

## M1–M3 results

**M1.** `@entity/core` has 21 story and runtime tests: scenarios 1–4 and 9, voice supersession, validation, dependencies, scoped stops and freezes, supervision, pause/resume, rate limits, level durations, `judge` / `sense` batching, ordered program reads, and reset. Programs run in QuickJS sandboxes with a memory cap and a CPU deadline per synchronous slice.

**M2.** These results are live, on gpt-6-luna (head) and gpt-6-sol (tasks), medium reasoning.

| Check | Result |
|---|---|
| Scenario 3, mirror, in the popup | 0.5–0.8 ms per key |
| Scenario 4, count and stop on 5 | 11 numbers, 0 after the press |
| E1, Morse | Decoded "HI" and tapped "OK" back with correct dot and dash timing, starting 2.0 s after the last tap. With gpt-6-sol as head it took 11.8 s. |
| E2, deep work you can still talk to | Nothing emitted while 9 was held; the task pressed 1–9 and finished; the question was answered in 2.4 s |
| First reply to a message | 2.4–7.4 s, over the 2 s target. A faster voice limb would be needed to meet it. |

**M3.** `judge` / `sense` were run live with Jev, and Jev was compared with Cerebras qwen.

| | Jev | qwen |
|---|---|---|
| Labelled questions, one call each | 8/10, median 353 ms | 9/10, median 465 ms |
| Live scenarios 7, 8, 5 | All pass: press 5 from the draft in 4.3 s; reply before send in 3.4 s; stop 560 ms after an off-topic message | All fail: about a third of calls returned no parseable answer, and the Jev-tuned draft question scored low |

Jev backs `judge` / `sense`. Neither backend can check arithmetic.

- **E3** failed at first: the entity answered a half-typed question ("17" instead of "34") and nothing checked it. Two changes fixed it. Watches gained `when` conditions, and the built-in draft sense now waits for a 700 ms typing pause. The head prompt also sends correctness checks to a gpt-6-sol task instead of `judge`. On the rerun it answered "34" 2.9 s after the user stopped typing, before they sent, and the task confirmed it. The wrong-quick-answer path was not exercised, because the quick answer was right.
- **E4** passed on the rerun: the tutor pre-wrote a hint in a watch on `sense("is the user stuck…?")`, and it fired 323 ms after the user got stuck, before sending. The first run's 4.2 s came from replying live instead.
- **Wrongful and missed interrupts** were measured on a labelled set of 16 conversations. For the subject-change sense at the 0.75 threshold the head chose live, there were 0/9 wrongful and 0/7 missed; the closest call was "brb coffee" at 0.66. Median call time was 781 ms.
- **The floor** passes live with senses off and code limbs disabled (`codeLimbs: false`): gpt-6-luna says hello (2.0 s), presses 556, and counts 1–5 in chat by itself.
- **First replies:** gpt-6-luna alone takes 2.0–7.4 s against the 2 s target. With the configurable voice split (`voiceModel: cerebras/qwen-3.8-27b`), first responses took 513–1251 ms live. "Repeat after me" was acknowledged in 645 ms and handed to the head, which installed the mirror; the mirror then reacted in 0.83 ms. Only the handoff reached the head.

## M0.5 spike results

The spike lives in `entity/spike/` and is not committed. Full notes are in `entity/spike/FINDINGS.md`. Each figure is one run per model and scenario, so treat them as rough.

| Model | 2: msg → 556 | 3: watch ready / mirror | 4: stop on 5 / ack | 9: watches ready / follow | Pass |
|---|---|---|---|---|---|
| gpt-6-sol, medium | 2.1 s | 5.5 s / < 0.1 ms | 0 ms, 0 extra numbers / 7.6 s | 5.4 s / < 0.1 ms | 4/4 |
| gpt-6-luna, medium | 1.8 s | 3.5 s / < 0.1 ms | 0 ms, 0 extra numbers / 10.1 s | 6.6 s / < 0.1 ms | 4/4 |
| Cerebras qwen-3.8-27b | 0.6 s | 1.6 s / < 0.1 ms | broken counting program | 2.9 s / < 0.2 ms | 3/4 |

What it confirmed:

- Code watches react in under 0.3 ms, and stopping output let 0 extra numbers through. Once a reflex is installed, real time is solved.
- Every model installed watches and programs unprompted. "The LLM programs the fast tiers" works.
- A fresh context per wake was enough.

What it changed, now reflected in these docs:

- **Parallel limbs by default.** The mind's latency is the bottleneck. The slow acknowledgements came from a single mind serialising its wakes.
- **Mandatory validation with errors returned to the model.**
- **"Hold" renamed to `stop_output` / `resume_output`.**
- **Default models chosen.** Cerebras qwen installs reflexes quickly but plans badly, so it is an optional extra limb, not the head.

## Later

Everything designed but not in v1 is in [future.md](future.md).
