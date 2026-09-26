# Parallel conversation

This is the entity's only conversation mode. Every message that needs real work gets a capable worker immediately. Nothing waits for earlier work to finish, nothing gets interrupted by a steering message, and every answer is a real reply in the chat. Workers know about each other through the shared log, so they don't trip over each other.

It replaces a manual workaround with single agents: cloning a conversation to give it a side task. It used to sit next to a single mode in which the head did everything and relayed task results. Parallel conversation had all of single mode's tools, so the two were merged on 2026-09-25; single mode's behaviour is now just the router choosing to act itself.

## How a message is handled

The front limb (the voice when one is configured, otherwise the head) routes each message, or a burst of messages, in one quick decision:

| The message is... | Action | Tool |
|---|---|---|
| A question it can answer from state or general knowledge | Answer it, and do nothing else | `say` |
| Something that takes seconds: a key press, or ongoing behaviour ("repeat after me", "stop when I press 5") | Do it directly. Ongoing behaviour stays with the head, because a worker's watches and programs end with it; the voice hands it over with `handoff` | keypad effects, `set_watch`, `run_program` |
| A new, independent task | Start a fresh worker right away, with the request and the context it needs | `dispatch` |
| Many independent items of one kind ("one worker per issue") | Start a batch: one worker per item under a title | `dispatch_many` |
| Building on a worker's context ("do the same for signup") | Fork that worker: clone its conversation at its current point | `fork` |
| A refinement of work in progress ("keep the old API") | Steer that worker only, with the user's own words; it hears it with its next tool result | `steer` |
| More work for a worker once it's done ("then add tests") | Queue it: the worker continues in the same conversation when it finishes (or is revived if it already has) | `steer` with `when: "after"` |
| Something that needs another worker's result first | Dispatch with a gate: the worker starts when the other one finishes | `dispatch` with `after` |

Workers run on the task model (gpt-6-sol by default); the router may pick the head model for small requests.

## Routing rules

These came from live sessions, and each is a general rule, not a fix for one scenario.

- **One decision per message.** Whatever the router can fully answer itself it answers, and it never also dispatches for the same message; a worker would only repeat it.
- **New messages can change existing work.** Before starting anything, the router checks what running workers are doing. A message that replaces or cancels a worker's work stops or redirects that worker in the same decision.
- **Seconds, not minutes.** The front limb only does things that take seconds: talking, the keypad, watches, programs. Reading or changing files, running commands and research are real work, even when they look small. Actions that belong to a piece of work (pressing a key as each step is done) go to that work's worker, in its task.
- **A question can be a request.** "Can you...?", "should we...?", "all three in parallel?" ask for action; answering "yes" is not doing it.
- **No promise without the action.** A reply that says work is happening comes with the tool call that makes it true, in the same decision.
- **The user's words about splitting work win**, and keep applying: "in parallel", "separately" mean separate workers; "in the same worker", "after that" mean steer or queue.
- **Let the user finish.** The front limb does not act while the user is still typing: the action waits until the draft has been quiet for 1 s (at most 6 s), and a user message it has not read supersedes it. A burst like "actually", then "let's convert to python", becomes one decision.

When the router is unsure, the cheap mistake is a fresh worker with a note like "may relate to the login worker".

## When routing is a guess

Routing is the entity's hardest call, so wrong guesses are cheap to fix. On the Work canvas, a message that started no worker of its own offers **Own worker** on hover, and **Fork of X** when it was steered into a worker X (`reroute`). A new worker starts for the message, and a steered worker is told to leave that part to it. The buttons stay available while the message is one of the three most recent, or less than a minute old, and inside an opened fold after that.

**The routing eval** measures routing against the real front model. `entity/evals/routing-cases.ts` holds cases, each a short conversation and the decision it should get; `bun apps/drone/scripts/entity-routing-eval.ts [--repeat N] [--voice <model>] [--only <text>]` plays them with stand-in workers that just stay busy, review off and the draft sense off, and prints what the front limb did for each failure. Add a case whenever a live session routes badly; fix the general rule, never the case. Results are in [plan.md](plan.md#results).

## Batches and the queue

- **The queue.** At most `maxTasks` workers (6) run at once; new ones wait as `queued` (up to 500) and start oldest first as others finish. A worker gated with `after` is `waiting` until the other one finishes and doesn't take a slot; then it starts, or queues if no slot is free. A queued or waiting worker can be steered (it gets the message when it starts) or stopped before it starts.
- **Batches.** `dispatch_many({ title, items })` starts one worker per item in one tool call and logs `group_started`. The chat gets one progress line for the batch ("Fix arithmetic functions: 5 of 8 done, 3 running."), updated in place as workers start and finish. Batch workers reply in their own thread (`say` defaults to `thread: true` for them) and pass `thread: false` only for a question the user must answer. When the last worker ends, the front limb is woken with the results and may add one summary.

## Real replies

Workers speak for themselves. Each reply is tagged with the worker and the message it answers (`reply_to`, filled in automatically), so parallel threads stay readable. There are no "steering acknowledged" messages. A worker that finishes says its result, then calls `finish_task` with a one-line summary.

A worker that cannot go on without the user calls `ask`. The question is posted in the chat (as `say` with `question: true`, in the main chat even for a batch worker) and the worker's turn ends. It waits instead of finishing: it holds its slot, the heartbeat and Resume leave it alone, and the Work canvas shows it as asking you. Your answer, sent to it directly or routed to it by the front limb as a steer, wakes it with its conversation intact.

## Second looks

Fast answers are reviewed by a stronger model, and the runtime decides what gets reviewed, not the fast model.

- **What:** every answer of the front limb. Batch progress lines, thread replies and corrections themselves are not reviewed.
- **When:** once the front limb has been quiet for 3 s, all its unreviewed answers in one pass.
- **Who:** `review: 'separate'` (the Hub's default) is a reviewer limb on the head's model, so the head stays free; `'head'` has the head review a separate voice's answers (with no voice there is nothing to review); `'off'` turns it off (the library's default).
- **How:** the reviewer calls `amend` per message: confirm, correct (the original is struck through in the chat and the correction posted below it), or expand. Answers it doesn't amend count as confirmed. A review run that crashes is marked "not checked", never confirmed; one aborted by Pause is reviewed again after Resume. The chat shows "checking…" while a review is pending, then ✓, "corrected below" or "not checked".
- A corrected message is marked as wrong in every limb's state, so no one reads it as fact. The reviewer checks promises against state too ("three workers are running" when one is), and hands work to the head when a correction needs it. With review on, the front limb doesn't dispatch workers just to verify its answers.

## Awareness

- **Shared state.** Every worker sees the other workers, their tasks and status, their claims, and shared discoveries.
- **Mid-run updates.** A busy worker gets updates attached to its next tool result: a steer, a sibling's discovery, a new claim. So it hears about changes within seconds, without being stopped.
- **Claims.** A worker claims the files or areas it is working on (`claim`), and writing a file claims it automatically. Writing to a path another worker holds is rejected with who holds it, so conflicts surface at the moment of the write, and logged as `write_refused`, so the worker shows as blocked by the holder until its next successful call.
- **Discoveries.** `share(text)` broadcasts a finding ("the bug is in token refresh, not the form") to every worker.
- **Orchestration.** A refused write on a claimed path wakes the head to reconcile: steer one worker, put their work in order, or cancel duplicates.

## Workspace

Workers need a workspace to actually write code. The workspace channel gives them tools confined to one folder:

| Tool | Risk class | Notes |
|---|---|---|
| `list_files`, `read_file`, `search` | read-only | Never blocked |
| `write_file`, `edit_file` | `limb` | Claims the file for the writer; rejected if another worker holds it |
| `run` | `limb`, **off unless enabled** | Shell command in the workspace with a timeout. Disabled by default because it runs LLM-written commands on the host |

Paths are resolved inside the workspace root, and `.git` is never written. All workers share one workspace, and claims keep them apart. That holds for a handful of workers; big batches need per-worker worktrees and a merge step, designed in [coding.md](coding.md).

## Cost

Parallel strong workers cost more. The queue caps how many run at once, the router picks the model per request, and the Work canvas shows each worker's cost. Finished workers keep their conversation (the 12 most recent) so they can be forked or asked follow-ups; failed and stopped workers drop theirs, and Reset drops all.

Costs are in USD at list prices, for subscription (Codex) models too, so you can see what the work is worth. The Hub prices every model call from its usage price table: the models.dev catalog, plus manual prices, plus long-context rates it ships for the models that have them (gpt-6-sol and gpt-6-luna above 272k input tokens, for both `openai` and `openai-codex`). Each call is priced on its own, with input, cache reads, cache writes and output (reasoning included) at their own rates, and a call whose whole input is over the threshold at the long-context rates. The entity keeps these totals per limb and for the session, including a worker's final turn and runs that crash or are paused; work summaries and senses (Jev) count too and are shown apart. A call whose model has no known price is counted as unpriced, never as $0.
