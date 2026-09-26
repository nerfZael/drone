# Session logs and replay

Every entity bench session is recorded, from **Start** until **Reset**. The bench can replay any recorded session, and the files are plain JSON Lines, so an agent debugging the entity can read them directly.

Sessions **survive a Hub restart**. When the Hub closes while a session runs, its recording is marked `suspended`; when the Hub stops without closing it, it stays `live` and is reported as `interrupted`. Either way, the next Hub start picks the newest session back up (`Entity.restore`): state, levels and chat are rebuilt from `events.jsonl`, and each worker's conversation from `conversations/`. It comes back **paused**: press Resume to carry on, or Reset to start over. What cannot survive is closed in the log, after a `session_restored` event: runs in flight end as aborted, programs fail (their JavaScript state is gone), a worker that was being cancelled is cancelled, and a review in progress is queued again. Watches and `set_timer` timers are armed again, timers with the running time they had left. Sessions recorded before logs carried their setup (`session_started.setup`) can only be replayed.

## Where they are

`<hub data dir>/entity-sessions/<id>/`, next to `hub.log`. On this machine's default profile that is `data/profiles/default/drone/entity-sessions/` in the drone repo; `drone profile current` prints the data root for the active profile. Folder names are `YYYYMMDD-HHMMSS-xxxx` in local time, so the newest sorts last. The newest 200 sessions are kept. A `README.md` in `entity-sessions/` repeats the format below with `jq` recipes.

The Hub also serves them: `GET /api/entity/sessions` lists them (newest first, with the folder path), and `GET /api/entity/sessions/<id>` returns one as `{ meta, events, frames }`.

## Files

| File | Contents |
|---|---|
| `meta.json` | id, status, start and end time, end reason, the bench config (models, reasoning, evaluator, review, workspace, commands, summaries), event and frame counts, the user's first chat message. Counts are written at Start, at the first message and at the end, so a live or interrupted session shows older counts. A session still marked `live` whose Hub has stopped is reported as `interrupted`. |
| `events.jsonl` | The event log, one event per line, in order: `{ seq, t, at, type, by, data }`. `t` is ms since the session started, `at` is epoch ms, `by` is `user`, `host`, `system` or a limb id (`head`, `voice`, `reviewer`, `worker-3`, `watch-5`). This is the source of truth ([core-model.md](core-model.md)). |
| `conversations/<worker>.jsonl` | Each worker's conversation with its model, one message per line, appended as it goes, so a resumed session continues it. Removed when a worker's conversation is dropped. |
| `frames.jsonl` | Snapshots of what the log alone does not give: `{ seq, t, patch }`. `patch` holds only the sections that changed (`status`, `world`, `levels`, `senses`, `jev`). `world` and `levels` are captured at every event, because the runtime reduces them before anything else sees the event; the others once the runtime has finished handling the events of that turn. Frame 0 (`seq` 0) is the full state at Start. Recordings made before the runtime state came from the log also carry `limbs`, `stops`, `self` and `health`. |

The snapshot after event N is every frame with `seq <= N` applied in order, each patch replacing whole sections (several frames can share a `seq`). So channel state (chat, keypad, held keys) is exact at every step. The runtime's own state (limbs with their status and runs, watches and programs, output stops, claims, notes, health) is rebuilt from `events.jsonl` alone with `replayRuntime` and `snapshotLimbs` from `@entity/core/state`, which has no Node dependencies; the bench's replay does exactly that, so a limb's status is exact at every event too. Older recordings, whose logs lack the setup, are replayed from their frames.

The live view keeps the last 2000 events from the server; replay loads a session's whole log. It follows the session over `GET /api/entity/stream` (server-sent events): `state` is the whole state (on connect, after Start and after Reset), `event` is one logged event, and `snapshot` carries only the snapshot sections that changed since the last one, plus `t`; the bench merges it into what it has.

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
