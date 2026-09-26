# Host API and channels

The library's real product is its host interface. The core knows nothing about chat, keys or files. Those are **channels**: host modules built on the same API a game would use.

## The entity

A host creates an `Entity` and drives it:

```ts
const entity = new Entity({
  mind,                 // runs LLM limbs (see below)
  channels: [chatChannel(), keypadChannel(), workspaceChannel({ root })],
  models: { head, task, voice? },   // voice: an optional fast front limb
  evaluator?,           // backs judge / sense (Jev or a small LLM)
  summarizer?,          // writes work summaries of busy workers
  config?,              // e.g. { review: 'separate', maxTasks: 6 }
});
entity.start();
entity.input('chat_message', { text: 'hi' });   // only a channel's declared inputs, by 'user'
entity.subscribe(event => …);                     // every logged event
```

| Method | Does |
|---|---|
| `start`, `pause`, `resume`, `reset`, `close` | The user controls ([architecture.md](architecture.md#user-controls)); `reset` returns the archived log |
| `input(type, data)` | A user event from a channel, e.g. `chat_message`, `draft_changed`, `key_down` |
| `hostEvent(type, data)` | An event from the host itself (`by: 'host'`), not validated |
| `snapshot()` | Status, world, levels, stops, health, limbs (with their links, blocks, questions and usage), senses, Jev calls and model usage, for UIs |
| `restore(events)` | Rebuilds a session from its log, paused ([session-logs.md](session-logs.md)) |
| `subscribe(listener)` | Events as they are logged |
| `messageWorker(id, text)`, `stopWorker(id)`, `renameWorker(id, name)` | The Work view's Message, Stop and rename |
| `reroute(seq, 'separate' \| 'fork')` | Move a user message to its own worker or a fork ([parallel-conversation.md](parallel-conversation.md#when-routing-is-a-guess)) |

The host also supplies these:

| Interface | Does | Drone Hub's |
|---|---|---|
| `Mind` | `run(input)`: one LLM run with a system prompt, a rendered context, tools and a step limit; returns its usage (tokens by kind and cost, also attached to a thrown error) and whether it ran out of steps; stops after the step in which the limb ended its turn (`ended()`). Optional `forget(key)` and `fork(from, to)` for worker conversations | `PiAiMind`: pi-ai with Codex models, conversations in memory |
| `Evaluator` | Answers a batch of questions about the world with probabilities, and may report what that cost | Jev through the AI Gateway, or qwen on Cerebras |
| `Summarizer` | Turns a worker's task and activity into done / doing / next steps, and may report what that cost | gpt-6-luna on low reasoning |

## Channels

A channel provides:

| Part | Meaning |
|---|---|
| `name`, `describe` | How it is named and described to the LLM limbs |
| `init`, `reduce(world, event, { levels, now })` | Its slice of state, and how events change it; it can set levels (`user.typing`, `key.5.held`) |
| `inputs` | The event types a user may send through it |
| `enrich(type, data)` | Derived fields added to its events as they are logged, e.g. `held_ms` on `key_up` |
| `effects` | What the entity can do through it, each with a schema and a risk class (`reflex`, `limb` or `confirm`), and optionally `dependsOn` (a staleness check), `paths` (files it writes, for claims), `output: false` (not blocked by output stops), `voice` (needs the speak capability), `readonly`, and a `shorthand` argument for programs |
| `render(world, ctx)` | How its state appears in context: `stable` (cacheable) and `volatile` parts |

Channels keep no logs of their own: read tools such as `read_chat` are read-only effects over the core log. Risk classes are explained in [architecture.md](architecture.md#risk-classes).

| Channel | Senses (events) | Acts (effects) | Status |
|---|---|---|---|
| Chat | `chat_message`, `draft_changed`; also reduces `entity_draft`, `chat_message_updated` (a batch's progress line) and `message_reviewed` (a corrected answer is marked wrong in context) | `say` (`reply_to`; `thread` keeps a batch worker's reply in its own thread), `set_draft`, `read_chat` | Built |
| Keypad | `key_down` (with `gap_ms`), `key_up` (with `held_ms`); level `key.N.held` | `press`, `key_down`, `key_up` (all `reflex`) | Built |
| Workspace | `file_written`, `command_ran` | `list_files`, `read_file`, `search` (read-only); `write_file`, `edit_file` (claim the path); `run` (off unless commands are allowed) | Built (core; one folder) |
| Workspaces (Hub) | `workspaces_changed` (host event: the granted workspaces) | blip's workspace tools with a `target`: reads read-only, writes claim `<target>:<path>`, `bash` needs Run | Built |
| Speech in | `transcript_partial`, `transcript_final`, `user_speech_started` / `_ended`, each segment timestamped | none | M4 |
| Speech out | `speech_queued`, `speech_started`, `speech_ended`, `speech_cut{at word}` | `speak(text)`, `stop_speaking` | M4 |

The workspace channel is confined to one folder: paths are resolved inside its root (symlinks included), `.git` is never written, and writes and commands are not output, so output stops don't block them. The Hub replaces it with its workspaces channel: the workspaces the user grants the session in the picker, the Companion's service behind them. See [parallel-conversation.md](parallel-conversation.md#workspace).

**Speech in** will be a one-way chat. The live transcript works like the typed draft: partial segments are visible and time-stamped, and final segments land in the transcript log. It reuses the transcription path Companion already has.

**Speech out** will be a lifecycle, not a fire-and-forget call. The entity sees when its speech was queued, when it actually started and ended, and where it was cut off. Combined with the user's speech events, overlap is a plain fact: a level a watch can react to ("user talking over me for > 1 s"). The entity can then decide to yield, keep talking, or respond. It is the same pattern as output stops: the channel reports, the entity chooses.

**Native realtime voice (M4).** Full-duplex speech models (OpenAI Realtime, Gemini Live, Moshi) handle barge-in and overlap natively, with latency a speech-to-text → LLM → text-to-speech chain can't match. In M4 such a model can be the **voice limb**, wired to the speech channels, while our limbs do the thinking and the core keeps the log and output stops. It is a limb type, not the core.

**Not built yet:** a second small host (tic-tac-toe or a timer) to check that the API is general, nested entities as channels, an MCP adapter and a game host; see [future.md](future.md#channels-and-hosts).
