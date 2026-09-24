# Reflex agent

> **Note:** Companion's Jev voice mode has been removed. `@drone/reflex` and `POST /api/reflex/evaluate` now serve the entity system (see `entity/docs/`). The Companion integration, the `/api/reflex/compile` route, and the `evaluate-companion-reflex` script described below no longer exist; those sections are kept as design history.

Status: library and evaluate route in use by the entity system; the Companion integration below was removed.

## Idea

A real-time agent has two tiers. A fast, calibrated evaluator (TypeSafe's Jev, through AI Gateway) answers typed questions over the live state several times per second. A slower LLM, the brain, does not run on a schedule: it writes the questions, the rules that turn answers into actions, and the expectations that should hold, and it is woken only when the reflex layer is unsure or surprised. Code owns control flow and every side effect.

```text
every tick (coalesced, one in flight):
  answers = evaluator(state, table.questions ∪ expectations)
  rule    = first rule whose conditions hold        # code
  act(rule)                                          # code-owned handler
  wake brain on: rule.wake, violated expectation, low-confidence streak, table age
brain wake: compile(purpose, state description, actions, current table, observations) → new table
```

## Library: `@drone/reflex`

`packages/reflex` has no runtime dependencies and runs in the browser, the Hub, and Bun.

- **Table** (`ReflexTable`): questions (`boolean`, `choice`, `score`), optional expectations (boolean checks with a threshold), ordered rules, a wake policy, and a preamble describing the state fields. Rules are data: a condition over answers (`is`, `atLeast`, `atMost`, `all`, `any`, `not`) plus an action name. Actions are handlers registered in code, never free text.
- **Loop** (`ReflexLoop`): minimum interval between starts, optional re-poll for time-dependent state, one evaluation in flight, a host-supplied `stillValid` check so a stale decision never acts on state it did not read, optional `preempt` so an important change (speech arriving during a sense-only tick) aborts the in-flight evaluation instead of waiting behind it, first matching rule acts, wake policy with cooldown, and `idle()` to await the in-flight evaluation.
- **Rules**: `matchRule`, `decisionConfidence`, `violatedExpectations`. Confidence of a conditional rule is the least certain answer it depended on. Confidence of the unconditional fallback is how surely every other rule failed to match, so "do nothing" is doubtful only when another rule nearly fired. An earlier definition used every answer, which made most waits look uncertain and woke the brain constantly.
- **Validation**: `validateReflexTable` rejects unknown questions, options, or actions, more than 255 choice options, and a fallback rule that is not last. Every table change is validated.
- **Brain helpers**: `reflexCompilePrompt` builds the system and user prompt; `applyBrainOutput` merges a flat brain revision (ANDed leaf conditions per rule) into the base table, validates it, and bumps the version.
- **Recorder and replay**: `ReflexRecorder` keeps a bounded ring of ticks; `replayReflexTrace` re-evaluates a trace with a candidate table and reports which decisions would change. Nothing acts during replay.
- **Stories**: `runReflexStory` drives timed host events and scores which actions fired for state observed inside each step's window (`expect` and `forbid`); a decision belongs to the window in which its evaluation started, so evaluator latency never moves it. The runner drains an in-flight evaluation before finishing. `scaleReflexStory` compresses a timeline for fast tests.

Constraints that shaped the design: Jev reads literally, cannot count or compare dates, degrades with irrelevant state, and can be steered by injected text. Keep state trimmed, keep criteria contrastive, do arithmetic in code, and never feed untrusted text straight into an action.

## Hub routes

- `POST /api/reflex/evaluate` `{ state, questions }` → `{ answers, usage, durationMs, model }`. Questions are validated and rebuilt from allowlisted fields; state is bounded to 300,000 characters. Usage is journaled as auxiliary Hub work under the `ai-gateway` provider. Provider failures are classified without echoing details.
- `POST /api/reflex/compile` `{ purpose, stateDescription, actions, base, observations?, guidance? }` → `{ table, output, model, provider, durationMs }`. Uses the Companion provider and model with a structured-output schema restricted to the listed actions. The returned table is validated and versioned.

Neither route acts on the Hub. The caller owns the loop and its actions.

## Companion integration

`packages/assistant-chat/src/companion-reflex` holds the Companion-specific parts so the browser, the Hub, and the eval script share them:

- **Transcript model** (`CompanionReflexTranscript`): retains all speech, advances a per-item cursor on decisions, reconciles final wording without resending delivered prefixes, and annotates the display with sent, skipped, and cancelled markers.
- **Default table** (`companionReflexTable(seedInstructions)`): questions `delegation` (send or wait, seeded from the editable Jev instructions, which now only judge whether there is enough to act on; chatter, holds, and cancellations belong to the other questions), `intent` (request, correction, cancel, chatter), `addressed` (boolean). Rules in order: cancel (intent cancel ≥ 0.8 and addressed ≥ 0.5, wakes the brain), chatter (≥ 0.85) → skip, not addressed (≤ 0.15) → skip, delegation send → send, fallback wait. Wake policy: confidence below 0.55 for four ticks, a one-minute cooldown, and a fifteen-minute table age.
- **Session** (`CompanionReflexSession`): state is `{ unsentTranscript, previousDelegatedTranscripts, timing.silenceMs, backend.status, backend.lastReply }`. Actions: `send` delegates and advances the cursor; `skip` consumes the speech only after two seconds of silence, otherwise the decision is recorded as not applied; `cancel` calls the host's cancel and consumes the speech; `wait` does nothing. Wakes call the injected `compile`, apply the returned table, and report success or failure without pausing the loop.

The desktop hook (`use-companion-jev.ts`) hosts the session: evaluation and compilation go through the Hub routes, `send` runs the Companion backend as before, `cancel` calls the Companion controller's cancel, and the backend status is tracked from in-flight runs. Brain revisions survive stop and start within the open Companion; a changed seed instruction rebuilds only an unrevised default table; reset clears everything. The voice transcript dialog has an **Agent** tab that shows what the loop sees and thinks right now: its state (listening, holding unsent speech, deciding, brain rewriting, paused), backend status and last reply, the unsent speech and silence, the latest decision with every answer's probability distribution, the current table's rules in order with their conditions, the questions and criteria, the wake policy, and the brain wakes so far. The **Decisions** tab lists every decision with its answers, rule, confidence, and whether it applied, plus brain wakes with the compiled table, and can replay any decision against the evaluate route without acting.

## Autonomy: senses, facts, and non-speech actions

The loop can act without the user speaking. This is gated by the Hub setting `autonomy` on the live-voice settings record, editable in Settings → Companion:

- **off** (default): the loop is speech-only, exactly the behaviour before autonomy existed. No senses are read and no autonomous rules exist in the table.
- **observe**: senses are read every second, the autonomous rules run, and their actions are recorded as dry runs (`dryRun: true`, with the note or nudge text they would have produced) in the Decisions and Agent tabs. Nothing is executed.
- **act**: autonomous actions execute.

A separate `brain` toggle (default off) gates recompiles; with it off, wakes are recorded but the table never changes. **Reset to default table** in the Agent tab discards brain revisions. Changing the autonomy level always rebuilds the default table for that level, since the rule set differs.

**Senses** (`CompanionObservation`): backend status, start time, last activity time, the last five tool calls, the last reply, and errors, from the Companion client snapshot; the selected drone, chat, and repository from the captured app context; and the latest event notification. **Facts** are booleans computed in code from the senses and exposed to rules as certain answers named `fact:<name>`: `speechPending`, `backendWorking`, `backendStalled` (no activity for 45 s while working), `backendJustReplied` (within 8 s), `userSilent` (10 s), `hasEvents`. Jev never has to compare times.

**Autonomous rules** in the default table: `stalled-nudge` sends the backend a status-check steering message when `backendStalled` holds and no speech is pending, and wakes the brain; `drift-notify` shows an on-screen note when the backend is working and the `backendOnTrack` expectation (its recent tool calls serve the delegated requests) falls below 0.3. Speech rules are guarded by `speechPending` so an empty transcript never sends. Nudges and repeated notes are limited to one per minute. The loop re-evaluates unchanged state only while speech is pending; otherwise it evaluates when the senses change, so an idle backend costs nothing.

## Testing and evaluation

- Unit tests: `packages/reflex/tests` (rules, validation, loop, recorder, stories), `packages/assistant-chat/tests/companion-reflex-session.test.ts` (transcript semantics ported from the earlier gate, cancel and skip behavior, brain wakes, and every user story against a scripted oracle at a compressed timeline), `apps/drone/tests/reflex-routes.test.ts` (SDK request shape, retries, error classification, route bounds, brain compile with a fake runtime).
- Live eval on user stories (paid, opt-in): `bun apps/drone/scripts/evaluate-companion-reflex.ts [--story <name>] [--repeat N] [--interval ms] [--scale x] [--seed "<instructions>" | --default-seed] [--brain] [--autonomy off|observe|act] [--autonomous] [--out dir]`. `--autonomous` adds the sense-driven stories (stalled backend gets a nudge, busy backend is left alone, drifting backend gets a note) and defaults autonomy to act. It runs `COMPANION_REFLEX_STORIES` against live Jev in real time, records every decision, reports pass or fail per window with action timings, p50 latency, token usage, and an estimated cost, and writes JSON per run plus a summary. Delegations are recorded, never executed. `--brain` exercises the compile step with OpenAI when a story wakes the brain.

Add a story whenever a real session misbehaves: copy the transcript deltas and timings from the decisions tab, state what must and must not fire, and keep it in the list so the default table and future brain revisions are measured against it.
