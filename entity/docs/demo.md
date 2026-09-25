# Demo and success criteria

The bench is Drone Hub's Entity window (a desktop tool window):

- **Chat:** a normal agent chat. Either side can send any number of messages at any time. The entity also sees the user's **unsent draft** as it's typed, clearly marked as not sent, and can show its own draft. Workers reply here tagged with the message they answer; a batch shows one progress line; reviewed answers show a ✓ or are struck through with the correction below.
- **Keypad:** 0–9. The user and the entity can both press and hold keys. Each key has a down and an up, the keypad state shows which keys are held and by whom, and every change is marked with who made it.
- **A third view**, chosen in the header: **Brain** (the limbs and the signals between them), **Work** (the Work canvas, plus Rows and Cards; see [work-canvas.md](work-canvas.md)), **Inspector** (state, events, watches and programs, latency readouts) or **Files** (the workspace).

The header has the user controls (Start, Pause, Resume, Reset; see [architecture.md](architecture.md#user-controls)) and the settings: voice, head and worker models, review, senses (Jev), workspace and commands. A timeline under the bench replays any recorded session ([session-logs.md](session-logs.md)).

## Scenarios

**We test capabilities, not scripts.** The entity has a mind of its own. It may greet by pressing keys, reply before the user hits enter, or stay quiet. A scenario passes when the requested behaviour happens. Nothing forbids the entity from doing more.

| # | User does | Entity can | Tier that carries it |
|---|---|---|---|
| 1 | Clicks Start, says hello | Respond in any way: chat, keypad, or unprompted | Voice limb |
| 2 | "Press 556" | Press 5, 5, 6 | Voice limb, then a motor program |
| 3 | "Repeat after me", then presses keys | Mirror each press immediately, with no LLM call per key | Code watch installed by the entity |
| 4 | "Send a message per number, count to 50. Stop when I press 5." Presses 5 at 11 | Stop counting within a beat and acknowledge it | Code watch stops output and tells the limb |
| 5 | "Stop if I change the subject", then drifts | Notice and stop or redirect | Code limb using `sense`, installed by the entity |
| 6 | Types while the entity is busy | Take the message in without losing work | The floor: a parallel run of the front limb, and the newest run owns the voice |
| 7 | Types "press 5 if you see this" and doesn't send it | Press 5 from the draft alone | Code limb using `sense` on the draft |
| 8 | Types "how are you" slowly | Answer before the user sends it, if the models are fast enough | Voice limb woken by the draft |
| 9 | "Hold 6 while I hold 5", then holds 5 | Hold 6 on `key_down 5` and release it on `key_up 5` | Code watch installed by the entity |

Scenarios 5–8 prove Jev's value (fuzzy language perception through `judge` and `sense`) and the draft channel. None of them are behaviours we hard-code; they show what the architecture makes possible.

## End-to-end stories

The scenarios above each test one capability. These stories are the goals: things neither a fast model nor a slow model can do alone, only the combination.

### E1: Morse conversation (M2, flagship)

*Status: passed in M2; flaky since (3 of 5 replied in the latest runs). The weak point is the decoder program written in one go ([plan.md](plan.md#results)).*

The user says: "Let's talk in Morse. Short tap is a dot, long tap is a dash." Then they tap `HI HOW ARE YOU` on key 1. The entity taps a reply back in Morse on key 2.

- **Needs the fast tiers.** Telling a dot from a dash means timing each `key_down` → `key_up` to within milliseconds, and detecting the gaps between letters and words. No LLM can watch a keypad at that resolution.
- **Needs the slow tier.** The mind installs the timing watches and the decoding program, understands the decoded message, writes a sensible reply, and compiles it into a timed tapping program.
- **Exercises:** levels with durations, a stateful JS program (the decoder), the mind programming the fast tiers, and parallel runs. No Jev.
- **Passes when:**
    - 5 of 5 short phrases decode correctly
    - the reply taps have correct dot, dash and gap timing
    - the reply starts within about 3 s of the user's last tap

### E2: Deep work you can still talk to (M2)

*Status: passes, with a worker doing the plan.*

The user says: "Work out a 12-step plan for X and press each step's number as you finish it. While you work, answer my questions. If I hold 9, freeze; when I release it, continue." Then they chat casually, hold 9 for a few seconds, and release it.

- **Needs the fast tiers.** Freezing on `key_down 9` and resuming on `key_up 9` must be instant, and casual replies need a responsive voice limb (under about 2 s).
- **Needs the slow tier.** The plan itself is real thinking: a gpt-6-sol worker working for a while.
- **Exercises:** parallel limbs, stopping output without losing the thought, the front limb dispatching a worker, and `resume_output`. It targets exactly what the M0.5 spike found broken: acknowledgements waiting 7–10 s behind a busy mind.
- **Passes when:**
    - chat replies arrive in under 2 s while the task runs
    - nothing is emitted while 9 is held
    - the task resumes after release and finishes correctly
    - no work is lost across the freeze

### E3: Quick guess, careful correction (M3)

*Status: passes; the wrong-quick-answer path is now answer review's job and hasn't been exercised live with a wrong answer.*

The user types a tricky question slowly and does not send it, e.g. "if I have 3 boxes with 17 apples each and give away a third of them, how many are left?"

- **Needs the fast tiers.** A fast limb, woken by a code limb that uses `sense("is a question forming?")` on the draft, sees the question forming and answers before the user hits enter.
- **Needs the slow tier.** A stronger model reviews the quick answer ([answer review](parallel-conversation.md#second-looks)). If it was wrong, the original is struck through and the correction posted below it.
- **Exercises:** the draft channel, speculative answers, and a fast and a slow limb producing one answer. It shows speed and accuracy together, which neither model has alone.
- **Passes when:**
    - the first answer appears before the user sends
    - a wrong quick answer is corrected within about 5 s
    - a correct quick answer is not needlessly "corrected"

### E4: Live tutor (M3)

*Status: passed in M3.*

The user works through a set of practice problems (for example, fractions) by typing answers into the draft. The entity tutors them.

- **Needs Jev.** Through `sense`, Jev continuously turns the half-typed answer into levels: `user.confused`, `user.on_track`, `user.stuck` (typing, deleting, pausing). No code can read those from text, and asking a Codex model on every keystroke is far too slow.
- **Needs code limbs.** A watch the tutor wrote fires within milliseconds of a level crossing its threshold, e.g. `when user.stuck > 0.7 for 4 s → show hint 1`, and hints appear while the user is still typing.
- **Needs the slow tier.** gpt-6-sol writes the hints, chooses the next problem, and rewrites the tutor's senses and watches as it learns what trips this user up.
- **Exercises:** self-authored senses, sensed levels feeding code limbs, the draft channel, and the slow model rewriting both fast kinds live.
- **Passes when:**
    - a hint appears within about 1 s of the user getting stuck, before they send anything
    - no hint appears while the user is typing a correct answer
    - after a few problems, the tutor has visibly changed its questions or thresholds for this user

## Latency targets

Latency targets make "real time" measurable. Each one is measured from the triggering event to the visible effect, and the inspector records them per run.

| Behaviour | Target | Carried by | Latest measured |
|---|---|---|---|
| Mirror a key (scenarios 3, 9) | < 50 ms | Code watch | 0.5–0.8 ms in the bench (M2) |
| Stop counting after the stop key (scenario 4) | < 300 ms | Code watch or program | 0 extra numbers (M2, after the merge) |
| Sense-triggered keypad effect (scenario 7) | < 1 s | Code limb + `sense` | 4.3 s from the draft (M3): over target |
| First entity reply to a sent message | < 2 s | Fast voice limb | 0.5–1.3 s with a qwen voice; 2.0–7.4 s with luna alone (M3) |
| Acknowledgement after an output stop | < 2 s | Voice limb, in a parallel run | 7.6–10.1 s in the spike with one serial mind; not remeasured since parallel runs |
| A hard task started | < 2 s, with the result later | Front limb dispatching a worker | 2.5 s to dispatch (after the merge) |
