# Work canvas

The Work tab as a map of the work: what is running, what came from what, what is waiting on what, and what needs you. You look at it from the top and click into a worker when you need to; you don't arrange it. It is the Work tab's default view; the older Rows and Cards views stay next to it while they are easy to keep.

Code: `EntityWorkCanvas.tsx` renders on `@xyflow/react`; `work-canvas-model.ts` derives everything from the snapshot and the event log, so it also works when replaying a recording, and is pure and tested. Mockups: [v10](https://claude.ai/artifact/6v5hf6Guu2qZBdHo47NZDv), which the colours follow, and earlier [v4](https://claude.ai/artifact/HVFDQC3DCx37wUrogT2oZq)–[v9](https://claude.ai/artifact/DoyjCnp1amyTwSvqjX3VVA).

## Layout

- **Rows run in time order.** The left column has one line per origin, the message that started the work, with its time of day; the work sits level with it. Hovering a time shows the exact time and how far into the session (and into the worker) it was.
- **Columns show lineage.** A fork sits right of the worker it came from, and gated work right of what it waits for.
- **Rows are laid out from measured sizes**, so expanding a card, or a row folding, slides the rows below. The view keeps everything in sight until you pan or zoom yourself; **Fit** brings that back.

**Arrows**, only three kinds: forked from (solid), waiting on (dashed amber, green once released), and blocked by a file another worker holds (red dotted). An arrow into folded or grouped work attaches to the fold line or the group card.

## Cards

- **Header:** the worker's name and its state: working (one colour for thinking and acting), waiting, queued, blocked, failed, done. The id (`worker-N`) only shows on hover. Double-click the name to rename it; the name is kept in this browser for the session, and the canvas and its side panel use it.
- **Status line** (up to two lines): what the worker is doing, from its latest summary's current step, or else the task it was given. Never the tool it happens to be calling: that changes every second, and external agents don't report it. Blocked, waiting and queued workers say what they're waiting for, by name. Done workers show their result.
- **Footer:** summary steps as pips, watch and program chips, time, and cost (or tokens for subscription models). A chip shows the label, an eye (watch) or `</>` (program), and one value: a watch's fire count, a program's running time, ✓ or failed. Hover shows the full condition.
- **⌄ expands a card in place**: the done / doing / next steps, each watch and program spelled out, claims and the model.
- **Click opens the side panel**: the message that started the worker, the task it was given (collapsed), then its replies and every steer, in markdown with times of day, plus Message and Stop.
- **Motion:** a pulse runs along an arrow when a fork starts or a wait is released; a card flashes when it finishes, starts from the queue, or is steered.

Text fits by being written short: summaries are asked for short steps, and watches and programs carry a label beside their full condition. Anything still cut off shows in full on hover.

## Scale

- **Folds.** Messages that started no work, and finished work that nothing live depends on, fold into one line such as `··· 57 finished · $8.17 · 6 messages · steered Signup flake`. Click it to open it in place. Folding waits: nothing folds within a minute, the 5 most recently finished rows and the 3 most recent plain messages never fold, and nothing folds while selected, expanded or hovered. Folded work fades out and the rows below slide up. The canvas keeps its own clock between events, so work folds in quiet sessions too.
- **Group cards.** A batch, or 4 or more workers from one message in the first column, becomes one card: counts by state, one cell per worker coloured by state, and totals. Hover a cell to see that worker, click it to open it, ⌄ for a filterable list. Workers that need attention (failed, blocked, stopped) also get their own card under the group, the first three as cards and the rest in one "N more need attention" list.
- **Top strip:** what needs you (by name), what's waiting on what, how many are queued, the entity's own running watches and programs as chips, and **Fit**. Clicking an item opens that worker.

## Chat and the canvas

- Hovering a card or a message line highlights the matching messages in Chat (a soft tint), and scrolls Chat to them.
- Hovering in Chat highlights the related work on the canvas.
- Clicking a worker's reply in Chat opens that worker in the side panel.
- Holding Ctrl or ⌘ turns hover into a lens: everything unrelated dims. Without it, nothing dims.
- A message that was only answered, or steered into a worker, offers **Own worker** and **Fork of X** on hover ([parallel-conversation.md](parallel-conversation.md#when-routing-is-a-guess)).
- Messages you send a worker from its side panel get their own line, "in X's thread".

## Not built yet

- **A real needs-you state.** Today "needs you" is derived: a failed worker, a blocked one, or one whose last message ends with a question you haven't answered. An `ask` tool would hold the worker until you answer.
- **The entity's own limbs.** Watches and programs of the head and voice show as chips in the top strip; they could have their own row with their conditions and meters.
- **Work no message started.** Head-started work lands in the row of your latest message, because dispatch defaults `reply_to` to it. The left column could mean "started by": your message, the head at 12:40, or a watch firing.
- **More states:** continued after running out of steps (`2/4`), frozen by an output stop, the whole entity paused.
- **Zoomed out:** below about 45%, cards need their own design, such as the name large and the status as a coloured bar.
- **Fork from the side panel.** The side panel has Message and Stop; forking a worker is only possible by asking the router.

Results stay general: workers may be external agents (Codex, Claude Code) whose file changes we can't see, so a card shows the worker's own result, never harness data like files changed. The "blocked by a file" arrow comes from our workspace claims, so it only appears for workers that use our tools.
