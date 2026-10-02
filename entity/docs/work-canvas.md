# Work view

The Work tab answers three questions at a glance: what is running, what came of what you asked, and why each piece of work exists. You read it top-down and open things only when you want more. Nothing moves on its own.

Code: `EntityWorkTree.tsx` renders it; `work-tree-model.ts` derives it from the snapshot and the log, purely, so replays show it too (tested in `work-tree-model.test.ts`). It is built on what the runtime records ([asks.md](asks.md)): each worker's cause and reason, its result and points, its rounds, and your asks with the work they went to. The mockup it follows is [Entity Work Tree](https://claude.ai/artifact/Ken25EcWDHMJPN5hLoWAxQ).

## Requests

The view is a list of **requests** in time order. A request is one of your messages that started work, or one piece of work the entity started on its own:

- A worker belongs to the message of the ask it serves; failing that, the message it was started for (`cause.seqs`, `reply_to`). A batch stays together. Work the entity started itself (its cause is a heartbeat, a timer, a batch ending…) is its own request, marked **Started by the entity** with the reason it gave, never pinned to your latest message.
- The heading shows the time, a title (the batch title, the one agent's name, or the first ask), whether it is still working, how long it has run and what it cost. Under it, what you asked in that message, each ask with its state: done, answered, open, or asked again.
- **Outcome first.** A finished request leads with what it produced: the result of its one agent, or of the agent the others led to (`after`), with its first points and "▸ N more". When agents worked side by side with no one result, each agent's result gets one line. The agents behind it fold into a line of names until **Show the work**.
- **Running now**, pinned to the top, has one line per running request: what its one agent is on (its latest round, or its summary's current step), or how many of its agents are done. Clicking a line jumps to it.
- **Asked, not started** lists things to do you asked for that no agent took, 30 s on: work the entity may have dropped.

## Agents

While a request runs, or once its work is shown, its agents sit in stages: each below what it waits for (`after`: one agent, several, or a whole batch), with arrows, dashed while waiting and green once released. An agent that waits on a whole stage gets one bracket under it instead of an arrow per agent; its card says "after all of Audit". Work that waits on a batch belongs to the batch's request, even when the head started it as the batch ended.

- **Labels / Gists**: a card is its name alone, or its name and one line: its result when done, else what it is on, from its own rounds or the summarizer's current step. The switch at the top sets every request; each request has its own beside its heading.
- Time sits in the card's corner; the agent's id, model, cost and the reason it was started are on hover. **▸ N points** opens a finished agent's points in place.
- Clicking an agent opens its panel: its points and reason. When the agent linked a report (a Markdown file in its messages), each point opens that report in place, at the section the point names or else the heading matching its label, with a link to the whole report (read through `GET /api/entity/home-file`). Below them are its summary steps, the message that started it and the task it was given, its replies and every steer, with Message and Stop. Clicking a request's heading opens the request's panel: your words, each ask with how it was resolved, and every agent with its reason.

## Not built yet

- **Changed since you looked**: a mark on what changed since you last opened it, instead of anything moving.
- **Rerouting** (Own worker, Fork of X) from the old canvas, and renaming a worker by double-click.

The previous canvas (`EntityWorkCanvas.tsx`, `work-canvas-model.ts`) is no longer the Work tab; its worker panel and status pieces are still used by the Work view and the Brain.
