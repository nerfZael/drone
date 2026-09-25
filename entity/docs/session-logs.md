# Session logs and replay

Every entity bench session is recorded, from **Start** until **Reset**. The bench can replay any recorded session, and the files are plain JSON Lines, so an agent debugging the entity can read them directly.

Sessions are **not resumable**. The live session lives in the Hub's memory: after a Hub restart the bench starts a fresh session with the default settings, and an earlier session can only be replayed. Resuming needs worker conversations saved next to the recording; the runtime state can already be rebuilt from the log ([context-and-memory.md](context-and-memory.md)).

## Where they are

`<hub data dir>/entity-sessions/<id>/`, next to `hub.log`. On this machine's default profile that is `data/profiles/default/drone/entity-sessions/` in the drone repo; `drone profile current` prints the data root for the active profile. Folder names are `YYYYMMDD-HHMMSS-xxxx` in local time, so the newest sorts last. The newest 200 sessions are kept. A `README.md` in `entity-sessions/` repeats the format below with `jq` recipes.

The Hub also serves them: `GET /api/entity/sessions` lists them (newest first, with the folder path), and `GET /api/entity/sessions/<id>` returns one as `{ meta, events, frames }`.

## Files

| File | Contents |
|---|---|
| `meta.json` | id, status, start and end time, end reason, the bench config (models, reasoning, evaluator, review, workspace, commands, summaries), event and frame counts, the user's first chat message. Counts are written at Start, at the first message and at the end, so a live or interrupted session shows older counts. A session still marked `live` whose Hub has stopped is reported as `interrupted`. |
| `events.jsonl` | The event log, one event per line, in order: `{ seq, t, at, type, by, data }`. `t` is ms since the session started, `at` is epoch ms, `by` is `user`, `host`, `system` or a limb id (`head`, `voice`, `reviewer`, `worker-3`, `watch-5`). This is the source of truth ([core-model.md](core-model.md)). |
| `frames.jsonl` | Runtime snapshots: `{ seq, t, patch }`. `patch` holds only the snapshot sections that changed (`status`, `world`, `self`, `levels`, `stops`, `health`, `limbs`, `senses`, `jev`). `world`, `levels` and `self` are captured at every event, because the runtime reduces them before anything else sees the event; the other sections once the runtime has finished handling the events of that turn. Frame 0 (`seq` 0) is the full state at Start. |

The snapshot after event N is every frame with `seq <= N` applied in order, each patch replacing whole sections (several frames can share a `seq`). So channel state (chat, keypad, held keys) is exact at every step, while a limb's status can show the end of the turn it was part of. Frames carry what the log alone does not: channel state and levels at each step, and sense values and owners. The runtime's own state (limb status and runs, watches and programs, output stops, claims) can also be rebuilt from `events.jsonl` alone with `replayRuntime` from `@entity/core`; the bench's replay still reads it from frames.

The live view keeps the last 2000 events from the server; replay loads a session's whole log.

## Replay in the bench

The bar under the bench shows **Live** while you use the entity. **Replay** opens the current session (or the newest one) at its end; the session picker switches to earlier ones. Every pane (chat, keypad, Brain, Work, Inspector) then shows the chosen moment, and input is off until you go back to **Live**; on the Work canvas, Message, Stop and the rerouting buttons are hidden. Start, Pause and Reset in the header still act on the live session.

- **Scrub:** click or drag the timeline. Ticks show activity over time: user purple, entity green, runtime grey.
- **Step:** ◀ ▶ or the arrow keys move one event; Shift+arrow moves ten; Home and End jump to the ends. **Skip noise** (on by default) steps over drafts, the entity's own draft, sense updates, timers, program logs and run ends.
- **Play:** ▶ or Space plays at the recorded pace (0.25× to 4×), with idle gaps over 1.5 s shortened.
- The line under the timeline is the current event in full. When the live session has moved on, **↻ N new** reloads it at the same position.

Stepping forward one event at a time fires that event's edge in the Brain view, so a reflex arc can be followed hop by hop. Replay shows what happened; it does not re-run a session against changed prompts or watches.

## For agents debugging a session

1. Find the session: newest folder, or match `firstMessage` in `meta.json`.
2. Read `events.jsonl` for what happened and when. Useful filters:
   - conversation: `chat_message`, `chat_message_updated` (a batch's progress line), `draft_changed`
   - mind runs: `run_started`, `run_finished` (duration and usage), `tool_called`, `tool_done`
   - routing and workers: `limb_spawned`, `group_started`, `limb_started`, `steered`, `rerouted`, `limb_revived`, `task_continued`, `work_summary`, `task_done`, `limb_failed`
   - review: `review_queued`, `message_reviewed`
   - code limbs: `watch_installed`, `watch_woke`, `program_started`, `program_log`, `program_woke`, `program_failed`, `output_stopped`
   - Jev: `judged`, `sensed`, `jev_unavailable`
3. Rebuild state at a moment from `frames.jsonl` when you need what a limb or watch looked like then (`jq -s` over the frames up to that `seq`).

Recording lives in `apps/drone/src/hub/entity/entity-recorder.ts`; the replay UI in `apps/drone-hub/src/droneHub/entity/EntityTimeline.tsx`.
