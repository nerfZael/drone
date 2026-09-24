# Host API and channels

The library's real product is its host interface. The core knows nothing about chat, keys or voice. Those are **channels**: packaged host modules built on the same API a game would use.

A channel (or a host) provides:

| Part | Meaning |
|---|---|
| State sections | Schema and budget for its slice of `world` |
| Reducers | How its events project into its slice of state |
| Events and levels | What it senses: instant events and the levels derived from them (see [core-model.md](core-model.md#levels-and-events)), each timestamped and attributed with `by` |
| Effects | What the entity can do through it, each with a risk class (`reflex`, `limb` or `confirm`) and an optional precondition |
| Render | How its state appears in context, and whether it sits in the stable, cacheable part or the volatile tail |
| Logs | Optional append-only history plus read tools, e.g. `read_chat` |

Risk classes are explained in [architecture.md](architecture.md#jevs-authority).

## Channels

| Channel | Senses (events) | Acts (effects) | When |
|---|---|---|---|
| Chat | `chat_message`, `draft_changed` | `say`, `set_draft` | v1 |
| Keypad | `key_down`, `key_up` | `press`, `key_down`, `key_up` (all `reflex`) | v1 |
| Speech in | `transcript_partial`, `transcript_final`, `user_speech_started` / `_ended`, each word or segment timestamped | none | M4 |
| Speech out | `speech_queued`, `speech_started`, `speech_ended`, `speech_cut{at word}` | `speak(text)`, `stop_speaking` | M4 |

**Speech in** is a one-way chat. The live transcript works like the typed draft: partial segments are visible and time-stamped, and final segments land in the transcript log. It reuses the transcription path Companion already has.

**Speech out** is a lifecycle, not a fire-and-forget call. The entity sees when its speech was queued, when it actually started and ended, and where it was cut off. Combined with the user's speech events, overlap is a plain state fact: `world.speech.overlap = true`. The entity can then decide to yield, keep talking, or respond to the interruption. It is the same pattern as holds: the channel reports, the entity chooses. Overlap and "entity is speaking" are levels, so a watch can react to "user talking over me for > 1 s".

**Nested entities** attach to a parent entity as a channel too; see [topology.md](topology.md#nested-entities).

**Native realtime voice (M4).** Full-duplex speech models (OpenAI Realtime, Gemini Live, Moshi) handle barge-in and overlap natively, with latency a speech-to-text → LLM → text-to-speech chain can't match. In M4 such a model can be the **voice limb**, wired to the speech channels, while our limbs do the thinking and the core keeps the log, projections and holds. It is a limb type, not the core.

**MCP adapter (later).** MCP already has resources (state), subscriptions (events) and tools (effects). An adapter could turn any MCP server into a channel. It is not realtime-grade and has no risk classes, so it stays an adapter, not the core.

**Second host.** Once the keypad works, a second small host (tic-tac-toe or a timer) checks that the API is general and not shaped around the keypad.
