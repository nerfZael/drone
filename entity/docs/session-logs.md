# Session logs and replay

Every entity bench session is recorded, from **Start** until **Reset** (or until the Hub shuts down). The bench can replay any recorded session, and the files are plain JSON Lines, so an agent debugging the entity can read them directly.

## Where they are

`<hub data dir>/entity-sessions/<id>/`, next to `hub.log`. On this machine's default profile that is `data/profiles/default/drone/entity-sessions/` in the drone repo; `drone profile current` prints the data root for the active profile. Folder names are `YYYYMMDD-HHMMSS-xxxx` in local time, so the newest sorts last. The newest 200 sessions are kept. A `README.md` in `entity-sessions/` repeats the format below with `jq` recipes.

The Hub also serves them: `GET /api/entity/sessions` lists them (newest first, with the folder path), and `GET /api/entity/sessions/<id>` returns one as `{ meta, events, frames }`.

## Files

| File | Contents |
|---|---|
| `meta.json` | id, status, start and end time, end reason (`reset`, `hub closed`), the bench config (models, evaluator, mode, workspace), event and frame counts, the user's first chat message. A session still marked `live` whose Hub has stopped is reported as `interrupted`. |
| `events.jsonl` | The event log, one event per line, in order: `{ seq, t, at, type, by, data }`. `t` is ms since the session started, `at` is epoch ms, `by` is `user`, `host`, `system` or a limb id. This is the source of truth ([core-model.md](core-model.md)). |
| `frames.jsonl` | Runtime snapshots: `{ seq, t, patch }`. `patch` holds only the snapshot sections that changed (`status`, `world`, `self`, `levels`, `stops`, `health`, `limbs`, `senses`, `jev`). `world`, `levels` and `self` are captured at every event, because the runtime reduces them before anything else sees the event; the other sections once the runtime has finished handling the events of that turn. Frame 0 (`seq` 0) is the full state at Start. |

The snapshot after event N is every frame with `seq <= N` applied in order, each patch replacing whole sections (several frames can share a `seq`). So channel state (chat, keypad, held keys) is exact at every step, while a limb's status can show the end of the turn it was part of: a watch that fired and released a key in one turn shows its fire count already raised at the key-down step. Frames carry what the log alone does not: limb status and runs, watch and program definitions, sense values and owners, output stops.

## Replay in the bench

The bar under the bench shows **Live** while you use the entity. **Replay** opens the current session (or the newest one) at its end; the session picker switches to earlier ones. Every pane (chat, keypad, brain, inspector) then shows the chosen moment, and input is off until you go back to **Live**. Start, Pause and Reset in the header still act on the live session.

- **Scrub:** click or drag the timeline. Ticks show activity over time: user purple, entity green, runtime grey.
- **Step:** ◀ ▶ or the arrow keys move one event; Shift+arrow moves ten; Home and End jump to the ends. **Skip noise** (on by default) steps over drafts, sense updates, program logs and run ends.
- **Play:** ▶ or Space plays at the recorded pace (0.25× to 4×), with idle gaps over 1.5 s shortened.
- The line under the timeline is the current event in full. When the live session has moved on, **↻ N new** reloads it at the same position.

Stepping forward one event at a time fires that event's edge in the brain, so a reflex arc can be followed hop by hop.

## For agents debugging a session

1. Find the session: newest folder, or match `firstMessage` in `meta.json`.
2. Read `events.jsonl` for what happened and when. Useful filters: `chat_message`, `run_started` and `run_finished` (mind runs and their duration), `watch_installed`, `watch_woke`, `program_started`, `program_log`, `limb_spawned`, `task_progress`, `task_done`, `limb_failed`, `output_stopped`, `judged` and `sensed`.
3. Rebuild state at a moment from `frames.jsonl` when you need what a limb or watch looked like then (`jq -s` over the frames up to that `seq`).

Recording lives in `apps/drone/src/hub/entity/entity-recorder.ts`; the replay UI in `apps/drone-hub/src/droneHub/entity/EntityTimeline.tsx`.
