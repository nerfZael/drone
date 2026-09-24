# Plan

## Codebase plan

We remove Companion's Jev voice mode so that `@drone/reflex` has one owner, then build the entity on top of reflex.

1. **Remove Jev voice from Companion.** This covers:
    - `use-companion-jev.ts`
    - `packages/assistant-chat/src/companion-reflex/*`
    - the Jev and Decisions tabs in `CompanionTranscriptDialog`
    - `CompanionAgentInsight` and `CompanionJevRequests`
    - the Jev settings and the mobile Jev rejection
    - `/api/reflex/compile`

    Keep `/api/reflex/evaluate` and the Jev gateway call as the server-side evaluator. Keep the live transcription path for the speech-in channel.
2. **Evolve `@drone/reflex`** into the attention layer:
    - watch tables that the mind authors and that are scoped to one run (the interrupt contract)
    - triggers on raw events next to the existing `fact:` answers
    - an outcome for events that arrive mid-run: ignore, redirect or parallel

    Keep the loop's coalescing, early cancellation, stale-decision check, recorder and stories.
3. **New `entity/packages/core` (`@entity/core`)**, with no UI and no blip dependency. The `entity/packages/*` glob gets added to the root workspaces, like `blip/packages/*`.
    - the event log, reducers, per-limb projections, and effect commit
    - levels derived from events
    - watch conditions and behaviour-tree motor programs, with their guardrails
    - the host and channel API, and the chat and keypad channels
    - the orchestrator, limbs with OTP-style supervision, the arbiter interface, and user controls
    - `Mind` and `Evaluator` interfaces
    - story tests using a fake mind
4. **Blip mind adapter** in the Hub, reusing `blip-runtime-loader`. It runs one blip session per reactive wake, or one per task for task limbs, with an in-memory repository and the effect tools, and exposes `abort` and `steer`. Tool calls commit as effects as soon as they stream.
5. **Hub routes.** Create a session, post events (key, chat), and stream state, events and mind activity over SSE. The orchestrator runs on the server, next to the LLM and Jev calls.
6. **Popup.** A `DesktopChatWindow kind="tool"` holding the chat (with both drafts), keypad, inspector with latency readouts, and Start / Pause / Resume / Reset controls. It reuses the assistant chat components where they fit.

## Milestones

The M0.5 spike comes first and is thrown away; it exists to measure before we build. Jev comes in at milestone 3, but the attention layer is designed around it from day one. Scenarios 1–4 don't need Jev; scenarios 5–8 exist to prove it. Scenarios are in [demo.md](demo.md).

| Milestone | Delivers | Done when |
|---|---|---|
| M0 | Jev voice removed from Companion | Companion tests green, no reflex imports left in assistant-chat |
| M0.5 | Throwaway spike: one LLM, the keypad, holds and one code watch, hacked together in a few days | We have measured real latencies for scenarios 2–4 and 9, and know which parts of the design they confirm or break |
| M1 | `@entity/core`: event log and projections, levels, watches and behaviour trees, supervision, host API, chat and keypad channels, guardrails, fake mind | Scenarios 1–4 and 9 pass as stories in tests |
| M2 | Blip limbs (fast voice + strong task), Hub routes, popup with Start / Pause / Resume / Reset | Scenarios 1–4 and 9 pass live, within the latency targets |
| M3 | Jev watches, interrupt contracts, event routing | Scenarios 5–8 pass live, and 1–4 still pass with Jev and programs disabled (the floor); wrongful and missed interrupts measured; Jev compared against a small fast LLM behind the same `Evaluator` interface |
| M4 | Speech in and speech out channels, plus a native full-duplex realtime model as an optional voice limb | The user talks, the entity talks back, and it reacts to overlap, with both the chained and the native voice limb |
| M5 | Memory: episodic log, long-term store, Jev recall | The entity recalls a fact or a program from an earlier session |

## Decided

- The system is called **entity**. It lives in `entity/`, with docs in `entity/docs/` and packages in `entity/packages/`.
- State budget is configurable per section.
- State can be written by the host (any schema) and by the entity (self, scratchpad), plus external tools and storage.
- The recent chat and the draft are always in state and go into every context. Older history is paged in with tools.
- The entity sees the user's unsent draft, marked as unsent. Entity chat arrives as whole messages, with an optional visible entity draft.
- Chat, keypad and speech are channels built on the host API, not core.
- Interrupts hold effects and notify the limb. Thoughts are never killed by default. Jev signals rather than commands, and can only fire reflex-safe effects.
- Multiple models run as limbs. The default is a fast head-and-voice limb plus strong task limbs.
- Limbs see each other's status and committed results, not each other's context. In v1 only the voice limb spawns task limbs.
- Work flows through state, lifecycle through signals, and parents can cancel or kill their children.
- Context is kept per task, and checkpoints replace compaction.
- The user has Start, Pause, Resume and Reset.
- Scenarios test capabilities, not scripted behaviour.
- The event log is the only source of truth; state is a projection of it, and each limb has its own projection.
- The world has events (instants) and levels (values held over time); watches can condition on both, with durations.
- Motor programs are behaviour trees. Watches are conditions extending reflex's shapes. No new DSL.
- Limb lifecycle follows OTP supervision: shutdown vs. brutal kill, restart policies, restart intensity.
- The voice sits behind an arbiter interface; v1's arbiter is trivial, and bidding arrives with peers.
- Why we chose these, and what we rejected, is in [alternatives.md](alternatives.md).

## Open questions

- [ ] Which exact models go in the default voice and task limbs, and which backup model?

## Later (not v1)

These are pinned for after the first version:

- **Real sessions into test stories.** Record live sessions and promote interesting ones to regression stories, replayed with a fake clock.
- **The entity sees its own spending.** Its spend rate against its budget is part of state, so it can choose cheaper limbs or slower heartbeats.
- **Consolidation ("sleep").** Background runs that turn episodes into durable facts and programs.
- **Several Jevs voting** on the same question for more reliable signals.
- **MCP adapter.** Any MCP server as a channel (see [host-api.md](host-api.md)).
- **Richer topologies.** Free spawning by any limb, deeper hierarchies, peers with a bidding arbiter, and nested entities, all within budget caps.
