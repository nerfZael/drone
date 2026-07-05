# Assistant Parity Roadmap

## Scope

This roadmap tracks the assistant features Voice Stream Next should bring closer to Drone Hub Assistant without adding Drone Hub, drone, Docker, repo, or container control.

The goal is a standalone assistant that has strong thread, tool, approval, artifact, voice, and model behavior before any future Drone Hub adapter exists.

Out of scope for this roadmap:

- drone listing, inspection, creation, cloning, or grouping
- drone chat messaging or chat-idle subscriptions
- drone filesystem access
- Docker/container execution
- repository patching or bash commands inside drones

## Target Capabilities

| Category | Target |
| --- | --- |
| Generic tool registry | Backend exposes available assistant tools, tool metadata, enabled tools per thread, and structured tool call/result records. |
| System approval workflow | Tool calls can request approval, block safely while pending, then continue or fail based on approve/deny. |
| Rich assistant threads | Threads have run lifecycle state, streaming events, queued prompts, ASAP steering prompts, stop/cancel behavior, and structured message rendering. |
| Model controls | Users can choose provider/model per thread, set supported reasoning/thinking level, and see the model currently running. |
| Thread system prompts | Global prompt defaults, voice-specific defaults, per-thread overrides, reset-to-default, and promote-thread-to-global flows. |
| Assistant artifacts | Thread-scoped files/notes that the assistant can create, read, update, append, patch, and delete through a safe artifact tool. |
| Spoken replies | Voice-originated threads can request short spoken replies for connected Android or desktop clients. |
| Per-thread tool controls | UI can enable/disable available tools per thread and show why disabled tools are unavailable. |
| Streaming/event transport | Web dashboard receives assistant run, message, tool, approval, artifact, and voice events through SSE or WebSocket. |
| Run lifecycle | Backend stores and emits `idle`, `running`, `waiting_for_approval`, `cancelled`, and `error` states. |
| Approval audit trail | Persist requested action, arguments, requester, approver/denier, timestamps, result, and failure reason where available. |
| Voice thread mode | Voice-originated threads can have shorter response defaults, spoken reply behavior, and voice-specific system prompt defaults. |
| Better message rendering | UI renders Markdown, reasoning blocks where available, tool calls, tool results, errors, pending states, and approval cards. |
| Non-drone access/scope model | Thread permissions can limit generic capabilities such as artifacts, speech, external calls, and future integrations. |

## Suggested Implementation Phases

### Phase A: Assistant Runtime Foundation

Deliverables:

- `assistant_runs` table or equivalent persisted run records
- normalized assistant message parts for text, reasoning, tool calls, and tool results
- thread status state machine
- run start/finish/cancel APIs
- server events for thread snapshots and run deltas
- web UI support for streaming assistant text and run status

Acceptance:

- a user sees assistant output appear while a run is active
- stop cancels the active run or marks it cancelled if provider cancellation is unavailable
- refresh/reconnect can recover the latest thread/run state from persistence

### Phase B: Generic Tools And Approvals

Deliverables:

- tool registry with names, labels, descriptions, categories, input schemas, approval policy, and availability
- per-thread enabled tool list
- pending approval records
- approve/deny APIs and UI approval cards
- approval audit rows
- runtime support for tool calls that pause until approved

Initial non-drone tools:

- `assistant_artifacts`
- `speak`
- `get_system_prompt`
- `update_system_prompt`
- `set_thinking_level`

Acceptance:

- tool calls render as structured rows
- approval-required tool calls pause the run and show an approval card
- approving resumes the run
- denying records the denial and returns a clear tool result to the assistant

### Phase C: Model Controls

Deliverables:

- provider/model registry
- per-thread provider/model/reasoning settings
- default model settings
- model picker in the web dashboard
- running model indicator

Acceptance:

- new runs use the selected thread model
- changing model affects future turns without rewriting prior messages
- unsupported reasoning levels are normalized or rejected clearly

### Phase D: System Prompts

Deliverables:

- global normal assistant prompt
- global voice assistant prompt
- per-thread prompt override
- prompt source display: default, global, or thread
- reset to default
- promote thread prompt to matching global prompt

Acceptance:

- normal and voice threads can start from different prompt defaults
- current thread prompt can diverge from global defaults
- prompt changes are visible and reversible from the dashboard

### Phase E: Artifacts

Deliverables:

- thread artifact storage
- artifact list/read/write/append/patch/delete actions
- artifact UI panel
- revision or updated-at tracking
- tool result summaries for artifact changes

Acceptance:

- assistant can maintain thread-scoped notes without touching local repos or Drone Hub files
- user can inspect artifact contents in the web dashboard
- artifact writes are bounded and path-normalized

### Phase F: Spoken Replies And Voice Threads

Deliverables:

- voice thread flag or source field
- voice-specific prompt defaults
- `speak` tool or response directive
- speech response event to connected voice clients
- optional TTS audio generation path

Acceptance:

- voice-originated assistant messages can produce short spoken replies
- text remains stored in the assistant thread
- speech delivery failure does not lose the text response

### Phase H: Non-Drone Permissions

Deliverables:

- per-thread capability scope
- default permission set for normal threads
- default permission set for voice threads
- UI for toggling sensitive capabilities
- clear rejection messages when a disabled capability is requested

Initial capabilities:

- artifacts
- speech
- external provider calls
- future integrations

Acceptance:

- a thread can disable tools or capabilities without deleting history
- approval policy can be stricter for voice threads
- future Drone Hub adapter permissions can plug into the same model later

## Data Model Notes

Likely new or expanded tables:

- `assistant_threads`
- `assistant_messages`
- `assistant_runs`
- `assistant_tool_calls`
- `assistant_approvals`
- `assistant_artifacts`
- `assistant_settings`
- `assistant_thread_capabilities`

Keep rows scoped by user id. Device-originated voice threads should still resolve through the owning user profile.

## User Experience Notes

- Treat approvals as blocking system state, not normal assistant chat text.
- Keep voice replies short by default, but store full text in the thread.
- Tool rows should be useful at a glance and expandable for details.
- Artifacts should be separate from transcripts and logs.
- Model controls should be per thread, with clear defaults.
- Prompt editing should make it obvious whether the user is editing one thread or future threads.

## Open Decisions

1. Which first tool calls require approval besides future external integrations?
2. Should `speak` require approval in normal threads, voice threads, or neither?
3. Should artifact writes require approval, or only path/size validation?
4. Should ASAP prompts interrupt only before the next assistant response, or should they be allowed to inject while a tool is waiting?
5. Should model/provider defaults be global per user or per assistant profile?
