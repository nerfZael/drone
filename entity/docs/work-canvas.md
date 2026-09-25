# Work canvas

The Work tab as a map of the work: what is running, what came from what, what is waiting on what, and what needs you. It replaces the row and card views. You look at it from the top and click into a worker when you need to; you don't arrange it.

Mockup (v10): https://claude.ai/artifact/6v5hf6Guu2qZBdHo47NZDv. Older versions, for comparison: [v4](https://claude.ai/artifact/HVFDQC3DCx37wUrogT2oZq), [v5](https://claude.ai/artifact/McMX67JjeuCu4ETKk4ofGy), [v6](https://claude.ai/artifact/CxP9miBuQtTfybRZDnM6dz), [v7](https://claude.ai/artifact/LPmbQp8DjPHRp6WLeL6QGA), [v8](https://claude.ai/artifact/2ebTXVBBMrT2ALWBTwsQs4), [v9](https://claude.ai/artifact/DoyjCnp1amyTwSvqjX3VVA).

## Status (2026-09-25)

Built: the canvas is the Work tab's default view, with Rows and Cards kept next to it (`EntityWorkCanvas.tsx`, laid out by `work-canvas-model.ts`, which is pure and tested). It has time rows with the message column, lineage columns, the three arrows, folds for talk and for finished work (after a minute, never while selected, expanded or hovered), group cards for batches and for four or more workers from one message, watch and program chips, the top strip, a side panel with the thread and Message and Stop, rename by double-click, and pulses when a fork starts or a wait is released. The runtime has the worker queue (`maxTasks` running, the rest `queued`), `dispatch_many`, and labels on watches and programs.

Also built: a batch shows one progress line in Chat, updated in place, and its workers reply in their own threads (`say` defaults to `thread: true` for them); the front limb is woken with the results when the batch ends. Past three, workers pulled out of a group are one compact list. Chat and the canvas highlight each other (a message and its work, a worker and its replies), and clicking a worker's reply in Chat opens it on the canvas. Folded work fades out and the rows below slide up; the canvas keeps its own clock between events so work folds in quiet sessions too.

A message that was only answered or steered stays visible for a minute with **Own worker** and **Fork of X**, then folds. The view keeps everything in sight until you pan or zoom yourself.

Not built yet: the needs-you state (`ask`) and a zoomed-out design.

## Terms

- **Limb**: the runtime's unit of supervision. Head, voice, task limbs, watches and programs are all limbs.
- **Worker**: a task limb, the LLM limb that handles one piece of your work. Every worker is a limb; the head, the voice, watches and programs are limbs but not workers. The UI says worker; the runtime and these docs say limb when they mean all of them.
- **Chat**: where you talk to the entity. A worker's own conversation is its **thread**.

## Design so far

**Layout.** Rows run in time order; columns show lineage.
- The left column has one line per origin: the message that started the work. Its work sits level with it.
- Forks and follow-ups sit to the right of what they came from.
- Every card has the same width. Placement is automatic and only grows: new work never moves existing cards.

**Arrows.** Only three kinds:
- forked from (solid)
- waiting on (dashed amber, green once released)
- blocked by a file another worker holds (red dotted)

**Cards.**
- A card shows its name (double-click to rename), status, a status line of up to two lines, and a footer with steps, time and cost.
- Watches and programs a worker installed are icon chips in its footer. The chip's fill is the progress; its text is seconds to fire, or runs done. Hover shows the full condition.
- ⌄ expands a card in place (full status, each watch and program spelled out, last steps, model). Click opens the thread in a side panel with Message, Fork and Stop.

**Text fits by being written short.** The summarizer gets a budget of about 60 characters per status, and watches and programs carry a short label beside their full condition. Anything still cut off shows in full on hover.

**Scale.**
- Only live work gets a row. Messages that started nothing (chat, answered questions, steers, messages in a thread) fold into one line between rows, such as `··· 4 messages · steered W3`.
- Finished work that nothing live depends on folds the same way, such as `··· 57 finished · $8.17`. Anything running, waiting, needing you, selected or expanded keeps its row.
- A fan-out of 4 or more workers from one origin becomes a **group card**: counts, one cell per worker coloured by status, and totals. Hover a cell to see that worker, click it for its thread, click the card for a filterable list.
- Workers that need you, or have stopped, leave their group as normal cards.

**Top strip.** What needs you, then what fires next (watches, waits), then the head's status and heartbeat. Each item jumps to its card.

**Motion.** A pulse travels along an arrow only for cause and effect, such as a finished worker releasing the one waiting on it. Smaller updates flash the card.

## Runtime work the design depends on

| Needed | Why | Change |
|---|---|---|
| A needs-you state | Workers now ask with `say` and carry on or end | An `ask` tool that holds the worker in `needs_you` until you answer |
| Queued workers | Every dispatch starts at once; 100 workers hit rate limits and cost | `maxConcurrentWorkers` and a queue Done. |
| Blocked by a file | A write to a claimed path is only refused | `wait_for_claim`, or derive it from a refusal followed by idling |
| Short labels | Watches and programs only have a name and a condition | A `label` field when they are created, and the summarizer budget Done. |
| Batch dispatch | 100 dispatches cost 100 router tool calls, and the group has no title | `dispatch_many({ title, items })` Done. |
| One progress message per batch | 100 replies would bury Chat | Workers in a batch reply in their threads; Chat gets one message that updates as they finish, plus the ones that need you |

## Not designed yet

- **The entity's own limbs.** Keypad watches, "stop when I press 5", the built-in draft-attention watch and programs the head installs belong to no worker. They need their own row at the top, with the same conditions and meters as the chips on worker cards.
- **Work that no message started.** The head can start work on a heartbeat, a watch can wake it, and a worker can spawn subtasks. The left column should mean "started by": your message, the head at 12:40, or a watch firing. Subtasks go in their parent's row, as a group from 4 up.
- **More states.** Stopped and failed; continued after running out of steps (`2/4`); frozen by an output stop; the whole entity paused.
- **Steers.** A steer now lives in a folded message line. The card should flash, and the side panel should show the latest steer.
- **Arrows into folded or grouped work.** They should attach to the fold line or the group card instead of disappearing.
- **Chat and canvas links.** A message line opens that message in Chat, and a reply tagged W3 in Chat jumps to its card.
- **Results stay general.** Workers may be external agents (Codex, Claude Code) whose file changes we can't see, so a card shows the worker's own result summary, never harness data like files changed. The "blocked by a file" arrow comes from our workspace claims, so it only appears for workers that use our tools.
- **Fold timing.** A row that folds the moment its work finishes makes the rows below jump. Fold after about a minute, not while hovered, with the collapse animated. Use the entity clock, so replay shows the same thing.
- **Zoomed out.** Below 45% the cards leave their text out, which reads as blank cards. It needs its own design, such as the name large and the status as a coloured bar.
- **Many exceptions.** Past about three, workers pulled out of a group should be one-line rows under it, not full cards.

## Big batches need their own worktrees

All workers share one workspace today, and claims keep them apart. That holds for a handful of workers. With 100 workers on 100 issues, many touch the same files, and most would sit blocked. At that scale each worker needs its own worktree and a merge step, as in [coding.md](coding.md). Until then, batches run at a small concurrency.

## Open questions

1. **Group threshold.** Group 4 or more workers from one origin, and pull out needs-you, stopped and failed? *Suggested: yes.*
   Answer: yes: 4 or more, with needs-you, stopped and failed pulled out.
2. **Rows and cards.** Remove both once the canvas works, and add a searchable outline only if long sessions call for it? *Suggested: yes.*
   Answer: keep them next to the canvas if that stays easy; remove them if they become a burden.
3. **Acting from the canvas.** So far: view, rename, expand, and Message, Fork and Stop in the side panel. Anything more, like dragging a message onto a card to steer it, or moving cards by hand?
   Answer: the recommendation. No dragging for now.
4. **Build order.** *Suggested:* (1) runtime states: ask, queue and limit, `dispatch_many`, labels; (2) a pure, tested function from the log to the canvas layout, replacing `deriveWork`; (3) rendering on `@xyflow/react`, which Drone Hub's canvas already uses; (4) motion and fold timing; (5) remove the row and card views.
   Answer: the recommendation, except that the needs-you state (`ask`) comes later.
5. **One conversation mode.** Should parallel conversation become the only mode, with single mode's behaviour as a routing preference? See [parallel-conversation.md](parallel-conversation.md).
   Answer: yes. Done 2026-09-25.
