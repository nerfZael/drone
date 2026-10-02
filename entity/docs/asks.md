# What the user asked, and why work exists

Two records sit beside the work itself, so a view can answer "what did I ask for, and did it happen" and "why is this running" without anyone reading the chat back.

## Why work exists

Every run of an LLM limb logs what woke it (`run_started.kind`): a user message, the session starting, a resume, the heartbeat, a watch, a program, a timer, an output stop, a file conflict, a handoff, a batch ending, a review, other work, a steer, a continuation or a retry. It also logs the user messages no earlier run of that limb acted on (`user_seqs`): a run that read a message but did nothing, because the user was still typing or a newer run took over, leaves it to the next.

Work a run starts carries that as its **cause** (`limb_spawned.cause`, `group_started.cause`): `{ kind: 'user', seqs }` when it answers user messages, otherwise the kind of thing that set the entity off, such as `{ kind: 'timer' }`. A worker the head starts on its own is visibly not something the user asked for. `dispatch`, `dispatch_many`, `fork` and `steer` take a **why**, one sentence in the user's terms. It is optional for work a user message asked for, and required for work the entity starts on its own: without it the dispatch is refused, with a reminder not to repeat work that is done or running. A steer made for a user message carries that message's cause too. A rerouted message is the user's own cause.

## What work reports

- **Names** are 2–4 words (`dispatch.name`), so a dozen workers stay readable side by side.
- **Results** (`finish_task`): `result` is the outcome in one sentence of at most 200 characters, what was found or done rather than what was looked at; a longer one is refused twice, then cut. `points` give the findings or parts, each a 2–4 word `label`, one sentence of `text`, and the `section` of the worker's report file it expands. The schema the model sees requires `points` (`[]` for a single result), because live runs skipped it while it was optional; the runtime still takes a call without it as none. The agent writes them once, when it finishes and its context is fresh; nothing asks it to keep a plan while it works (progress stays the summarizer's job).
- **Rounds** (`report_round`): only for open-ended work the user asked to keep going ("keep polishing…"). After each round, one line saying what changed (`work_round`), instead of saying it in the chat. The worker keeps a count and the latest line, and the head sees it in its workers list (`round 6: …`). A worker whose run ends while it has a timer pending, or a watch or program running, is waiting for it, not done: open-ended work can pace itself.

## Asks

An **ask** is one thing the user asked for: `do` (something to do or produce), `question`, or `rule` (a standing preference: "always…", "keep…"). A host-supplied `AskTracker` (the Hub's is gpt-6-luna) does all of it, one call at a time beside the limbs, so the agents spend nothing on it:

| When | The tracker | Logged |
|---|---|---|
| The user sends a message, or messages a worker directly | Splits it into new asks, and names earlier asks it repeats or replaces. How to organize the work ("in parallel", "add another agent") is not an ask | `ask_recorded`, `ask_repeated`, `ask_replaced` |
| Work is started or steered for user messages | Links it to the asks it serves. With one candidate ask, or the user's own message to a worker, it is linked without a model call; when the run read several messages, the tracker decides, so work is not credited with a message it ignored | `ask_linked` |
| A worker finishes (`task_done`, done) | Once every worker related to an ask is done, judges it on all their results together, against what the user actually wrote | `ask_resolved` |
| The head, voice or reviewer says something in the chat | Judges the open asks of the messages that run read (and its `reply_to`), and asks whose work has all finished (the head combining results), against the reply | `ask_resolved` |

The state follows from these events (`RuntimeState.asks`, replayed like everything else):

- An ask is **open** until resolved, and **went to** the workers linked to it. An open ask that went to nobody is work the entity dropped.
- Asked again after it was resolved, it is **open again** and keeps its last resolution, so a view can say "marked done by X at 14:20, asked again at 14:45". The tracker only spots the repeat; the rule is fixed code.
- **Rules** stay open until replaced, and every limb sees the open ones in its state (`rules`), on every wake.
- Ask tracking is reported, never acted on: nothing wakes or steers a limb because of an ask.

The tracker's three prompts are Hub prompt sections (`hub_ask_split`, `hub_ask_link`, `hub_ask_resolve`), editable in the bench; it splits and links on low reasoning and judges on medium. Its calls count in the session's usage as `usageBy.asks`, a fraction of a cent per session in the trials below. The bench's **Record** tab lists asks and work as recorded, as a plain check on the data before views are designed on it.

## Trials (2026-10-01)

Six live sessions on a copy of these docs (head gpt-6-luna, workers gpt-6-sol, medium; asks on luna): a breakdown, four rounds of README polishing "while we talk", improvement ideas from several agents in parallel with one prioritized list, one more agent added later, a standing rule, and "which areas did you delegate?". About $0.50 and 3–6 minutes each. What each run found, and the fix:

| Run | Found | Fixed by |
|---|---|---|
| 1 | "One prioritized list" marked done by one area's own list; "keep polishing" filed as a rule; a new request taken as repeating it; "add another agent" kept as an ask forever; the head re-ran finished work on its own with no reason; rounds said in the chat | Stricter split and judge prompts; `why` required for self-started work; `report_round` replaces saying rounds |
| 2 | Agents packed findings into long results instead of points; one area's list still resolved the combined ask | 200-character results; shared asks judged once all their work is done |
| 3 | The judge now too strict (done work left open) and still too lenient on "one list" | The judge gets the user's own words and how many agents the evidence came from, on medium reasoning |
| 4 | A message the head read but did not act on was missing from the cause of what the next run started; points still optional and mostly skipped | Causes cover unhandled messages; `points` required in the offered schema |
| 5 | A run that read two messages dropped the README work, and both messages were credited to the audits | Explicit links decided per piece of work |
| 6 | Links right; README polishing stopped after round 1 because the worker set a timer and its run ended, which counted as done | A worker waiting on its own timer, watch or program is not done |

By run 6, causes and links were right throughout, five of six workers gave points, and the open asks were exactly the work not done: the README rounds the runtime cut short, and the combined list the head had not yet posted.
