# Limbs and topology

An entity's mind is a set of **limbs**: concurrent LLM or Jev workers that share one event log and one orchestrator, each reading its own projection of it. It is not bound by biology. It can have 2 limbs or 200. Its shape, whether a single head, a hierarchy or a society of peers, is **configuration, not architecture**.

A limb is configuration, not code:

| Field | Example |
|---|---|
| `model` | a fast model, a strong model, or Jev |
| `role` | a short system prompt: "head", "voice", "planner", "keypad hand" |
| `parent` | the limb that spawned it and holds authority over it; none for the root |
| `capabilities` | what it may do: `speak`, `spawn`, `set_watch`, `direct` (assign tasks to its children), `cancel`, `kill` |
| `view` | its projection of the event log: which sections and how much history it sees (smaller view, cheaper and faster run) |
| `restart` | its supervision policy: what happens when it crashes (see below) |
| `wakes` | code or Jev watches that start it |
| `budget` | tokens per minute and concurrency, handed down from its parent |

## Work goes through state; lifecycle goes through signals

- **Work.** Tasks, results and requests are events in the log, projected into each limb's state. A parent assigns work by writing to a child's `tasks`, and the child commits results. This keeps everything visible, replayable and conflict-checked. For request-and-response, `ask(child, question)` writes the task and waits for the result with a timeout, so it feels like a call while state stays the truth.
- **Lifecycle.** Pause, cancel and kill are direct signals from the orchestrator. They take effect immediately, like OS signals, and are logged as events. State-based directives are soft: a child could delay them. Signals are not.

## Supervision

Lifecycle follows Erlang/OTP supervision trees rather than a scheme of our own. Every parent is its children's **supervisor**.

- **Cancel and kill.** Parents can stop their own children. **Cancel** (OTP `shutdown` with a timeout, our default) lets the child checkpoint and stop. **Kill** (OTP `brutal_kill`) fires the child's abort controller at once and drops its partial output. A cancel that is not honoured within the grace period becomes a kill, and running out of budget also kills. Everything up to the kill stays in the log. Jev can do neither.
- **Restart policy per child.** `permanent` children (the head-and-voice limb) are always restarted from their checkpoint. `transient` children (task limbs) are restarted only if they crashed, not if they finished. `temporary` children (one-off helpers) are never restarted.
- **Restart intensity.** A supervisor allows at most N restarts in T seconds. Past that, it gives up and fails upward to its own parent, and at the root the entity reports `limb_failed` and falls back to [the floor](architecture.md#the-floor-never-worse-than-a-normal-agent). This stops a crashing limb from burning budget in a loop.
- **Strategies.** `one_for_one` (restart only the crashed child) is the default. `one_for_all` (restart a group together) is available for limbs that only make sense as a set.

## Topology presets

| Preset | Shape | Status |
|---|---|---|
| Head + limbs | One root head directs; limbs work tasks and report back | v1 default, depth ≤ 2 |
| Hierarchy | Heads of sub-teams, each directing its own limbs | Later |
| Peers | Equal authority: limbs bid and an arbiter decides (see below), coordinating only through the log and version checks | Later, when models cooperate better |
| Nested entities | A child is a whole entity, attached to its parent as a channel | Later |

Rules that hold in every topology:

1. **Head and voice are roles, not the same thing.** The head decides and the voice talks. In v1 one fast limb plays both, because the head must react quickly. Later a strong head can sit behind a fast voice.
2. **One voice, through an arbiter.** User-facing effects (`say`, `speak`) go through an **arbiter** that decides which limb holds the floor. In v1 the arbiter is trivial: the limb with `speak` always wins, and others publish to state for it to relay. The interface exists from day one so later topologies can swap in a real one (see [Arbitration](#arbitration)).
3. **Conflicts.** Every effect commits against the log position its projection was built from. A later conflicting commit is rejected, and that limb re-wakes with the new state.
4. **Budgets and caps flow down the tree.** A parent gives its children part of its own budget. Depth and spawn caps apply, so a society can't grow without limit.
5. **Many Jevs.** Each limb's watches run as their own evaluator loop, in parallel. Recall, wake-gating and interrupt contracts are separate Jev streams.

## Arbitration

A head is one way to decide. The other, for the peers topology, comes from global workspace theory in cognitive science. Many specialists work in parallel and compete for a small shared "spotlight". The winner's content is broadcast to all of them.

- Any limb can **bid** for a scarce resource such as the voice, a motor channel, or the head's attention, with an urgency and a short reason: "I want to speak, urgency 0.8: the task finished".
- The **arbiter** picks the winner by urgency, recency and budget, and the decision is logged as an event.
- The winning content is **broadcast** into every limb's projection, so the whole entity knows what it just said or did.

In v1 the arbiter is the trivial one described above. The bid interface is kept so that moving from a head to peers is a configuration change, not a rewrite.

## Nested entities

An entity can contain entities. A child entity plugs into its parent through the [host API](host-api.md) as a channel. Its events are its messages, status and results. Its effects are sending it a message, pausing it and giving it budget. An entity never needs to know whether it is talking to a limb, a sub-entity or a human.

## Default v1 config

One fast head-and-voice limb that spawns strong task limbs on demand, plus one Jev attention stream.
