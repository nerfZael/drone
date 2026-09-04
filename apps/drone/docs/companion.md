# Companion

| Field               | Value                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Type                | Feature                                                                                                                                |
| Status              | Implemented                                                                                                                            |
| Approach confidence | 95% — the implementation composes existing Hub systems and has focused automated coverage; final UX polish should follow hands-on use. |

## Summary

Companion is a voice-first assistant opened with a keyboard shortcut on desktop or a sidebar microphone on mobile. It transcribes a short request, runs a small Blip agent with Drone Hub tools, and shows the answer in a desktop corner overlay or at the top of the mobile app.

The agent should perform UI work through real tools, not describe or return actions after it finishes. Text changes should use Blip's patch-envelope format through target-specific composer and editor tools. A dedicated Settings tab should configure its system prompt, enabled tools, provider, model, and reasoning. Reuse the existing Blip host and connect its browser-facing tools to the initiating Drone Hub client over a small authenticated WebSocket RPC channel.

## Background and Scope

The existing built-in agent belongs to a drone chat. Companion belongs to the whole app and should understand the current drone, chat, composer, and editor file without the user repeating that context.

```text
shortcut -> record -> transcribe -> one Blip run
         -> server tools and browser UI tools -> tool results back to Blip
         -> reply in overlay
```

The first version should support:

- One configurable toggle-to-talk shortcut: first press starts recording; second press stops and then transcribes once.
- Existing one-shot Groq transcription.
- Silence or an empty transcript ends locally without creating a Blip run, session, or message.
- Recording, transcribing, working, completed, cancelled, and error overlay states.
- Hub-wide inventory: repository, drone, and chat counts; repository membership; repo-less drones; and drones with multiple chats.
- Reading chats and bounded keyword search across active drone chats. Archived chats are excluded.
- Highlighting drones without navigating to or opening them.
- Drafting one repeatedly editable proposal for group, drone, chat, and message operations, with explicit review and approval before execution.
- Reading and immediately patching the active chat composer without confirmation. The patch must be one undo step.
- Reading and immediately patching the open editor buffer only while that file is in edit mode. A patch leaves the buffer dirty, does not save it, and must be one undo step.
- Awareness of the active drone, chat, composer, pane, and editor file.
- A clickable Working indicator with tool-call details, plus Markdown rendering for the final reply.
- A Companion Settings tab for the system prompt, tool checkboxes, explicit provider selection, and provider-scoped model/reasoning selection across OpenAI, Codex, and Gemini.
- A mobile entry point below the sidebar content, with the second toggle in the top overlay so the drawer can close while recording. Mobile reuses the Hub's saved Companion configuration and does not add another settings page.

Continuous transcription, silence-driven end-of-thought detection, spoken replies, recoverable run history, saving files, and archived-chat search can be added later. These do not require a different base architecture.

## Existing Code to Reuse

| Need                                                | Existing code                                                                                                                                                                                                                                                                                                    | Change needed                                                                                                                                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Voice recording and transcription                   | [`use-chat-voice-recorder.ts`](../../drone-hub/src/droneHub/chat/use-chat-voice-recorder.ts) and [`use-voice-clipboard-recorder.ts`](../../drone-hub/src/droneHub/app/use-voice-clipboard-recorder.ts)                                                                                                           | Reuse the existing one-shot toggle flow. Let the recorder accept a `companion` microphone owner and abort an in-flight transcription on close.                                               |
| Microphone exclusion                                | [`browser-microphone-coordinator.ts`](../../drone-hub/src/droneHub/chat/browser-microphone-coordinator.ts)                                                                                                                                                                                                       | Reuse as-is apart from the new owner value and label.                                                                                                                                        |
| Configurable shortcut                               | [`shortcuts.ts`](../../drone-hub/src/droneHub/app/shortcuts.ts), [`use-drone-hub-lifecycle-effects.ts`](../../drone-hub/src/droneHub/app/use-drone-hub-lifecycle-effects.ts), and [`lifecycle-effect-helpers.ts`](../../drone-hub/src/droneHub/app/lifecycle-effect-helpers.ts)                                  | Add one action and allow it from eligible text inputs, like the existing voice-to-clipboard shortcut.                                                                                        |
| Settings navigation                                 | [`settings-tabs.ts`](../../drone-hub/src/droneHub/app/settings-tabs.ts), [`SettingsView.tsx`](../../drone-hub/src/droneHub/app/SettingsView.tsx), and [`use-drone-hub-ui-store.ts`](../../drone-hub/src/droneHub/app/use-drone-hub-ui-store.ts)                                                                  | Add a `companion` tab, render its page, and allow it in persisted active-tab state.                                                                                                          |
| Provider and model controls                        | [`CompanionSettingsTab.tsx`](../../drone-hub/src/droneHub/companion/CompanionSettingsTab.tsx) and [`ChatComposerModelPicker.tsx`](../../drone-hub/src/droneHub/chat/ChatComposerModelPicker.tsx)                                                                                                                                                                                   | Choose the provider explicitly, then reuse the picker with only that provider's models and require an explicit model when the prior selection is unavailable.                                 |
| Tool checkboxes                                     | [`AssistantSettingsPanels.tsx`](../../drone-hub/src/droneHub/assistant/AssistantSettingsPanels.tsx)                                                                                                                                                                                                              | Reuse `AssistantToolsPanel` with the smaller Companion catalog and its All/None actions.                                                                                                     |
| Active composer tools                               | [`ContinuousDictationContext.tsx`](../../drone-hub/src/droneHub/chat/ContinuousDictationContext.tsx) and [`ChatInput.tsx`](../../drone-hub/src/droneHub/chat/ChatInput.tsx)                                                                                                                                      | Extend registered composers with snapshots and revision-checked commits. Do not add a second composer registry.                                                                              |
| Active editor file                                  | [`use-file-editor-state.ts`](../../drone-hub/src/droneHub/app/use-file-editor-state.ts) and [`OpenedDroneFilePanel.tsx`](../../drone-hub/src/droneHub/files/OpenedDroneFilePanel.tsx)                                                                                                                            | Register the open buffer, revision, dirty state, and local edit/preview mode as a browser text target.                                                                                       |
| Browser workspace tools                             | [`CompanionWorkspaceContext.tsx`](../../drone-hub/src/droneHub/companion/CompanionWorkspaceContext.tsx)                                                                                                                                                                                                     | Register app context, draft preparation, highlighting, and editor targets in one typed provider shared by the runtime and Hub model.                                                        |
| Patch parsing and application                       | [`apply-patch.ts`](../../../blip/packages/tools/src/apply-patch.ts)                                                                                                                                                                                                                                              | Reuse `parsePatch` and `applyPatchHunks` on the server; restrict Companion to updates on the selected browser text target and preserve its original line endings.                            |
| Drone draft UI                                      | [`use-workspace-navigation-actions.ts`](../../drone-hub/src/droneHub/app/use-workspace-navigation-actions.ts), [`DroneSidebar.tsx`](../../drone-hub/src/droneHub/app/DroneSidebar.tsx), [`use-sidebar-read-model.ts`](../../drone-hub/src/droneHub/app/use-sidebar-read-model.ts), and the existing draft stores | Open and prefill the existing draft flow. Render its placeholder as the newest normal drone row in its selected repository and group. Do not create another draft model. |
| Overlay placement and style                         | [`HubTransientToasts.tsx`](../../drone-hub/src/droneHub/app/HubTransientToasts.tsx) and [`DroneHubOverlays.tsx`](../../drone-hub/src/droneHub/app/DroneHubOverlays.tsx)                                                                                                                                          | Reuse its visual language, but use a separate `CompanionOverlay` because the state lasts longer than a toast.                                                                                |
| Working and tool-call details                       | [`AgentRunActivityView.tsx`](../../drone-hub/src/droneHub/assistant/AgentRunActivityView.tsx), [`WorkingElapsedStatus.tsx`](../../drone-hub/src/droneHub/chat/WorkingElapsedStatus.tsx), and [`AssistantTranscript.tsx`](../../drone-hub/src/droneHub/assistant/AssistantTranscript.tsx)                         | Reuse the elapsed-time summary, tool count, chevron, tool rows, grouping, and bounded scrolling in a tools-only Companion view.                                                              |
| Reply rendering                                     | [`ChatMessageBody.tsx`](../../drone-hub/src/droneHub/chat/ChatMessageBody.tsx) and [`MarkdownMessage.tsx`](../../drone-hub/src/droneHub/chat/MarkdownMessage.tsx)                                                                                                                                                | Render the final reply with the same Markdown, code highlighting, links, tables, and copy actions as agent chat.                                                                             |
| Blip lifecycle, cancellation, and temporary history | [`blip-assistant-host.ts`](../src/hub/assistant/blip-assistant-host.ts) and [`hub-session-repository.ts`](../src/hub/assistant/hub-session-repository.ts)                                                                                                                                                        | Let the host accept a repository and run Companion on an isolated in-memory SQLite repository. Keep one thread per open overlay and delete it on close.                                      |
| Drone Hub domain tools                              | [`in-process-drone-hub-mcp.ts`](../src/hub/assistant/in-process-drone-hub-mcp.ts) and [`mcp-server.ts`](../src/hub/mcp-server.ts)                                                                                                                                                                                | Filter the catalog to the fixed Companion allow-list. Add bounded chat search.                                                                                                               |
| Chats and transcripts                               | [`transcript-store.ts`](../src/hub/transcript-store.ts)                                                                                                                                                                                                                                                          | Keep it as the source of truth. Add a derived, rebuildable keyword index over active chat turns.                                                                                             |
| Bidirectional browser RPC                           | [`terminal-websocket-upgrade.ts`](../src/hub/terminal-websocket-upgrade.ts), [`companion-transport-shared.ts`](../src/hub/companion/companion-transport-shared.ts), [`hub-http-transport.ts`](../src/hub/hub-http-transport.ts), and [`hub-auth.ts`](../src/hub/hub-auth.ts)                                 | Reuse the upgrade, origin, and authentication patterns; share pending tool-call timeout, generation, cancellation, and bounded-activity handling between desktop WebSocket and mobile mesh. |
| Model catalog and API-key resolution                | [`assistant-config.ts`](../src/hub/assistant/assistant-config.ts), [`assistant-runtime.ts`](../src/hub/assistant-runtime.ts), and [`hub-settings.ts`](../src/hub/hub-settings.ts)                                                                                                                                | Extract the OpenAI, Codex, and Gemini catalog/validation into a shared Hub Blip module; reuse credentials and model resolution while storing separate Companion defaults.                    |
| Mobile voice and UI                                 | [`MobileChatVoiceRecorderContext.tsx`](../../drone-hub-mobile/src/local-assistant/MobileChatVoiceRecorderContext.tsx), [`AppDrawer.tsx`](../../drone-hub-mobile/src/local-assistant/AppDrawer.tsx), and [`NativeMarkdown.tsx`](../../drone-hub-mobile/src/local-assistant/NativeMarkdown.tsx)                    | Share the phone microphone coordinator, add a bottom-left drawer action, and render the same run states, tool details, and Markdown in a top overlay.                                        |
| Mobile transport                                    | [`MeshContext.tsx`](../../drone-hub-mobile/src/mesh/MeshContext.tsx) and [`device-mesh-router.ts`](../src/hub/device-mesh/device-mesh-router.ts)                                                                                                                                                                 | Add an explicit, permissioned Companion capability that streams run events and relays browser tool results over the existing paired-device socket.                                           |

The current `/api/assistant/events` stream broadcasts actions to all connected Hub clients. It must not be used for composer drafts or other browser-local state.

## Proposed Approach

### 1. Keep the frontend small

Add `apps/drone-hub/src/droneHub/companion/` with:

- `useCompanion`, which owns recording, transcription, the socket, cancellation, and result state;
- `CompanionOverlay`, mounted once from `DroneHubOverlays`;
- a browser tool executor that validates tool calls and invokes existing UI state methods.

Add one shortcut action with toggle-to-talk behavior. The first press only starts recording. The second press stops recording and starts one-shot transcription. Escape while starting, recording, or paused discards only that recording, does not transcribe it, and consumes the keypress before other app Escape handlers. If this was a follow-up recording, preserve the completed reply beneath it. Do not use silence to steer, submit, or end the request. If transcription is empty after trimming, return to idle without opening a Blip session or showing an assistant message. While transcribing or working, repeated shortcut presses do nothing; after completion or error, the next press erases the previous overlay state and starts a new recording.

Extend the composers already registered for continuous dictation. A registered composer should expose its ID, virtual path, text, revision, and a compare-and-set commit. This lets `read_active_composer` and `apply_composer_patch` work across normal, draft, built-in, and multi-chat composers.

Register the open editor buffer in the same small browser text-target layer. The registration must expose whether it is a normal editable text buffer, read-only, or previewing Markdown/HTML. Preview mode is read-only to Companion: `apply_editor_patch` must return `EDITOR_NOT_EDITABLE` and must never switch the user into edit mode. Recheck the mode and revision immediately before committing because either can change during a run.

The overlay should reuse the agent-chat Working presentation. Show elapsed time and tool count in a clickable row; expanding it shows running and completed tool calls and their bounded results. Keep model reasoning hidden. Render the final response through `ChatMessageBody` so normal Markdown behavior stays consistent with agent chat.

Closing the overlay erases the conversation. If recording, transcription, or Blip is active, close must abort it first; then clear the audio blob, transcript, activity, reply, queued turns, and browser state and delete the temporary Companion thread. Completed conversations are not recoverable in the first version. Closing does not undo tool effects that already completed, such as a composer patch; those remain visible and undoable. A run-generation check must prevent a late browser tool result from mutating state after close.

### 2. Reuse the existing Blip host

Add a small Companion runtime beside `assistant-runtime.ts`. It should own a second `BlipAssistantHost` with a configuration callback built specifically for Companion. Change the host constructor to accept an optional repository, then give Companion an isolated `HubSessionRepository` opened with an explicit in-memory option. Do not point the existing path-based constructor at the string `:memory:` because it currently resolves all inputs as filesystem paths.

For each run:

1. Bind a generated run ID to the authenticated browser socket that started it.
2. Run Blip through `BlipAssistantHost.promptThread`.
3. Execute server-owned tools locally and browser-owned tools through the bound socket.
4. Return every tool result to Blip so it can continue or correct its plan.
5. Send the final answer to the overlay.
6. In a `finally` block, delete the temporary thread and remove its socket/run binding.

This reuses the complete SQLite repository behavior without writing Companion sessions to disk or creating another repository implementation. A completed turn keeps its thread available for follow-ups; overlay close calls `deleteThread`. Turns submitted while one is active queue in order on that thread. A hard Hub crash drops the in-memory database with the process, so no startup sweep or global deletion of unbound assistant sessions is needed. Close the in-memory repository during graceful Hub shutdown.

Add a dedicated Companion WebSocket route using the existing `ws` and Hub authentication patterns. Its protocol only needs `start_run`, `cancel_run`, `tool_call`, `tool_result`, `activity`, `status`, `reply`, and `error` messages. Stream bounded Blip tool activity to the overlay. Bind runs and tool calls to that socket, apply timeouts, and reject late or mismatched results. Closing the socket aborts its active run and rejects pending browser tool calls. Use a separate no-server `WebSocketServer`, route it from the existing upgrade handler, and extend Hub transport shutdown to close both the terminal and Companion servers.

Build the final reply from assistant text parts only. Do not use `latestAssistantText` unchanged because it currently includes thinking parts; Companion must never render hidden reasoning as the answer.

Mobile starts the same runtime over the paired-device mesh instead of opening the browser-only WebSocket. The mesh capability binds one temporary conversation to the initiating phone, queues its turns, streams the same status/activity/reply events, relays phone-local composer and editor tools, and deletes the conversation on overlay close or device revocation. The phone uses its existing one-shot transcription setup; Companion model, prompt, and enabled tools remain canonical on the Hub.

### 3. Use a fixed, backend-enforced tool set

Companion is Hub-wide, so its read-only server tools may inspect every drone visible to the authenticated Hub user. That scope must be explicit in its backend principal; it must not inherit the currently open chat's narrower scope.

Reuse the in-process Drone Hub MCP client for these server-owned tools:

- `get_hub_overview`: return repository, drone, chat, group, busy, error, and repo-less-drone counts;
- `list_repos`: return the existing stable repository references and counts, with drone counts added;
- `list_drones`: add `hasRepository` and repository filters, and return an unambiguous `repository: null | {...}` plus `chatCount`;
- `list_agent_models`: return available models and reported reasoning levels for a Built-in or CLI agent on the requested runtime;
- `list_groups`: return existing group names and repository scope so proposal operations can target them exactly;
- `list_chats` and `read_chat`: enumerate a drone's chats with their explicit agent/model configuration and inspect a selected transcript;
- `search_chat_messages`: perform bounded keyword search across active chats, optionally scoped to a repository, drone, or chat;
- optional read-only workspace tools for the active drone.

Search results should include a short snippet, repository, drone, chat, turn ID, role, timestamp, rank, and stable references that can be passed to `read_chat`. Use hard limits and pagination. Normalize only user prompts, visible assistant output, and visible errors from each active stored turn; do not index reasoning, tool arguments/results, attachments, or hidden metadata. Maintain a small, rebuildable SQLite FTS5 index beside the canonical transcript store and update it in the same transcript transaction. Active-chat deletion or archiving must remove its rows. FTS5 is enabled in the current Hub SQLite runtime, so no fallback or vector store is needed.

Add a browser tool provider whose Blip tools call the bound client and await a structured result:

- `get_app_context`
- `read_active_composer`
- `apply_composer_patch`
- `read_open_file`
- `apply_editor_patch`
- `read_companion_proposal`
- `apply_companion_proposal_patch`
- `open_drone_chat`
- `highlight_drones`

Each tool has a fixed schema and a matching browser implementation; there is no generic `execute_ui` tool. The read tools return a target ID, virtual path, content, mode, and revision. The three patch tools require the matching target ID and base revision, parse the normal Blip patch envelope on the server, and accept only `Update File` operations for that exact path. Add, delete, move, cross-target, and whole-value replacement operations are rejected.

A separate write or replace tool is not needed. An insert-only update works for an empty composer or editor buffer:

```text
*** Begin Patch
*** Update File: composer.md
@@
+First line
*** End Patch
```

The server applies the patch hunks to the snapshot, then asks the browser to commit the result immediately if the target, revision, and mode still match; there is no confirmation step. On a conflict, the tool returns the latest revision so the agent can reread and retry. `apply_editor_patch` also rejects non-text, read-only, large-file, loading, saving, and preview states. A successful editor patch updates only the unsaved browser buffer; it does not call the save endpoint.

`read_companion_proposal` exposes one session-owned JSON document plus a compact list of supported operation shapes. `apply_companion_proposal_patch` updates that document but never performs the proposed operations. The browser validates the complete document after every edit, including strict fields, unique operation IDs, limits, and references to drones created earlier in the same proposal. This keeps the provider tool schema small while still giving the review and execution boundary a typed contract.

The proposal supports creating, renaming, and deleting groups, drones, and chats; creating normal or draft drones/chats; cloning container drones; cloning chat history; copying chat configuration without history; and sending ASAP or queued messages. Drone creation can optionally override runtime, volume persistence, branch source/remote branch, and the initial chat's agent, provider, model, reasoning, permission mode, and approval policy. Chat creation supports the same chat-scoped overrides. Every omitted setting continues to use the saved creation or chat default. Operations execute top-to-bottom after explicit user approval and stop after the first failure. A later operation can target a newly created or cloned drone with `$<operation id>`. Repository omissions resolve against the active repository captured when the proposal is first created, so later navigation cannot silently retarget it. Any execution attempt, including a partial failure, is terminal for that proposal; the user must discard it before Companion can create a fresh retry, preventing already-completed operations from being replayed. The review card stays to the left of the desktop Companion window across follow-up turns, so Companion can discuss and patch the same proposal repeatedly before the user applies or discards it.

Desktop and mobile Companion use the same proposal document and validation contract. Desktop shows the review card beside the Companion window; mobile shows it inside the Companion overlay. By default, neither surface executes proposal edits until the user explicitly applies the reviewed proposal.

On desktop, one press of the proposal shortcut applies the ready review card. A double press of its default Caps Lock binding toggles session-only auto-approve, which is off when the Companion session starts. While enabled, complete proposals execute after the Companion turn finishes without opening the review card. Every manual and automatic execution remains available from the Companion header's execution-history button until the session closes, including partial failures and per-operation results.

The proposal card is the single preview surface for pending operations. It shows each structural change and its execution status without inserting speculative groups, drones, or chats into the live sidebar model. The sidebar continues to render confirmed and ordinary optimistic application state, and applied proposal changes appear there through the normal registry refresh.

Applying a patch must preserve user undo. For Monaco-backed composer and file editors, expose an edit method on the registered target that uses `pushUndoStop`, `executeEdits`, and `pushUndoStop` instead of replacing the React `value`; one Ctrl/Cmd+Z should revert the whole Companion patch. For controlled textareas, keep an app-owned Companion undo snapshot and intercept Ctrl/Cmd+Z when the current revision still matches the patched result. Clear that snapshot when the composer is sent, reset, or replaced. Browser tests must cover user typing before and after the patch. Do not claim undo support from `setDraft` or `setOpenedFileContent` alone.

Do not enable shell, direct workspace file writes or saves, generic navigation, settings changes, or the full built-in-agent management catalog. Read-only model discovery is allowed so Companion can validate proposal overrides. Hub mutations and chat messages go through the proposal review boundary; opening an existing chat and temporary highlighting remain immediate navigation actions.

### 4. Add a dedicated Companion Settings tab

Add `CompanionSettingsTab` and `useCompanionSettings` under the existing Settings view. The page should have three sections:

1. **Provider and model:** choose the provider explicitly, then reuse `ChatComposerModelPicker` for that provider's models and model-specific reasoning. Support all Hub Blip providers: OpenAI, Codex, and Gemini. Do not select a replacement model when the current model/reasoning pair is unavailable for a newly selected provider. Groq remains the voice transcription provider and is not a Companion reasoning provider.
2. **Tools:** reuse the checkbox rows from `AssistantToolsPanel`, including descriptions and All/None controls. Only tools from the fixed Companion catalog appear. Disabling `apply_composer_patch`, for example, removes it from later Companion runs rather than asking the model not to use it. Enabling a patch tool must also enable its matching read tool; disabling the read tool must disable the dependent patch tool. Enforce the same dependency in the settings API.
3. **System prompt:** provide a multiline editor, Save, and Restore default. The configurable prompt controls Companion's role and behavior, but tool authorization, schemas, edit-mode checks, and other safety rules remain enforced in code. Append a short non-editable runtime contract that treats retrieved chat/file content as untrusted data, requires mutations to follow the user's current request, and makes clear that the editable prompt cannot widen tool access.

Store this as one profile-scoped canonical Companion settings record containing `provider`, `model`, `thinkingLevel`, `systemPrompt`, and `enabledTools`. Add `GET` and `PUT /api/settings/companion`; the response should also include the current model choices and Companion tool summaries so the frontend does not duplicate either catalog. Validate the provider/model/reasoning combination, reject unknown tool names, and cap prompt size on the backend.

Use one draft and Save action so provider, model, prompt, and tools change together. Show loading, dirty, saving, saved, and error states, and warn before discarding unsaved changes. Each message snapshots the saved settings when it starts; changing settings does not mutate an active message, and the next queued or follow-up message rebuilds the session configuration while preserving its transcript. If the selected provider lacks credentials, show that in Settings and fail the message clearly rather than silently switching providers.

### 5. Observe message latency without retaining content

Companion assigns a distinct `messageId` to every turn, separate from the overlay's reusable run ID. Desktop transcription requests, WebSocket messages, mobile mesh requests, Blip sessions/turns, and browser tool calls carry that correlation through the execution path.

The Hub records one sanitized timing summary per message in the shared Hub SQLite database. It retains the newest 2,000 summaries and never stores the prompt, transcript, model reasoning, tool arguments, tool results, file paths, or reply text. Temporary Blip conversations remain memory-only and are still deleted when the overlay closes.

Each summary includes:

- client transcription and audio duration, plus desktop upload/Groq phases, connection reuse, and connection time;
- server queue wait, settings and credential lookup, cold handle setup, registry/MCP/tool setup, agent execution, and reply extraction;
- time to the first reasoning or text output;
- Blip's total tool/non-tool wall time, parallelism, per-tool aggregate duration, context usage, and terminal status;
- browser-tool round-trip duration and the desktop WebSocket or mobile device-mesh transport;
- a bounded failure category instead of the raw error text.

Every completed or failed message also writes a structured `Companion message timing` entry to the Hub log. `GET /api/companion/telemetry?limit=200` returns recent sanitized records plus p50/p95/max distributions, phase and tool summaries, and breakdowns by transport, provider/model, warm/cold start, and status. The route uses the normal authenticated Hub API boundary and does not expose a separate public metrics listener.

## Success Criteria

- The shortcut and microphone work from normal local Drone Hub screens and report conflicts clearly.
- Escape during a desktop Companion recording discards the audio without transcription or another Escape side effect.
- On mobile, the microphone stays at the bottom-left of the sidebar (after a bottom-pinned section), and the run overlay appears at the top of the app with a stop control while recording.
- Companion can combine server-owned Drone Hub tools and browser-owned UI tools in one Blip turn.
- Every UI tool result is visible to the agent before it produces its final answer.
- Composer and editor changes use the normal Blip patch envelope and fail safely when the text or revision is stale.
- Companion cannot patch an editor in preview, read-only, non-text, loading, saving, or large-file mode, and it never saves the file automatically.
- The overlay shows a clickable Working summary with elapsed time, tool count, and expandable tool-call details without exposing model reasoning.
- The final Companion reply renders with the same Markdown component used by agent chat.
- Settings can save and restore a Companion system prompt, toggle each allowed tool, explicitly choose OpenAI, Codex, or Gemini, and choose a valid model/reasoning combination scoped to that provider.
- Disabled tools are absent from the runtime catalog, unknown tools cannot be enabled through the API, and setting changes affect the next run only.
- Retrieved chat and file content cannot override the fixed runtime contract or grant additional tools.
- Missing provider credentials produce a clear Settings and overlay error without provider fallback.
- It can report Hub counts, identify repo-less drones and drones with multiple chats, and show each drone's repository membership without scanning the UI.
- Keyword search finds matching content in active chats, returns traceable chat references, and never returns archived chats.
- It can propose multiple durable draft drones without publishing or starting them; approved drafts appear in their selected repositories and groups, subject to normal sidebar filtering and ordering.
- It can propose true chat-history clones separately from configuration-only chat copies, and can clone ready container drones while rejecting host-drone clones.
- Optional runtime, branch, volume, agent, provider/model/reasoning, permission, and approval overrides are reviewed explicitly and leave saved defaults in effect when omitted.
- Pending structural operations remain in the proposal card until they are applied or discarded; the sidebar shows them after they become real state.
- Companion can propose creation, deletion, and renaming of chats, and can open an existing chat or highlight matching drones immediately, but it cannot perform generic navigation.
- The proposal card exposes exact prompts, messages, delivery mode, and repository scope before approval; every execution attempt is single-shot, and a failed or partial proposal must be discarded before creating a fresh retry.
- A changed composer is never overwritten, and one browser cannot receive another browser's tool calls.
- Follow-up turns reuse the open Companion thread, and turns submitted while it is working run in order.
- Closing the overlay cancels any active stage, deletes the temporary session, and leaves no recoverable Companion conversation.
- Closing never rolls back completed tool effects, but no browser mutation may land after the run was closed.
- Silence and empty transcripts never create a run, session, message, or tool call.
- Companion session data is memory-only, and a forced mid-run Hub crash leaves no Companion session, binding, or transcript on disk.
- The backend rejects every tool outside the fixed Companion allow-list.
- Message telemetry can distinguish transcription, transport/queue, cold setup, model/non-tool, individual tool, and reply-extraction latency without retaining user or tool content.

## Progress and Next Steps

- [x] Map the existing voice, shortcut, Blip, tool, transcript, repository, composer, editor, draft-drone, and overlay code.
- [x] Simplify the design around the existing Blip host and composer registration.
- [x] Replace post-run UI actions with browser tools that return results to the agent.
- [x] Confirm that repository/drone/chat enumeration exists and only keyword search is required.
- [x] Confirm that Blip's patch engine, agent-chat run details, and shared Markdown renderer can be reused.
- [x] Confirm that the Settings shell, tool checkbox panel, model/reasoning picker, and all three provider mappings can be reused.
- [x] Define the authenticated socket protocol, server/browser tool schemas, and Companion settings schema.
- [x] Implement the frontend recording hook, overlay, Markdown reply, tool-call activity, shortcut, target registrations, and browser tool executor.
- [x] Implement Settings, profile persistence, the in-memory Blip runtime, WebSocket cleanup, fixed tools, keyword index, top-slot draft, and undo-safe patch targets.
- [x] Add focused coverage for shortcut migration, editable dispatch, textarea undo guards, tool dependencies, the fixed catalog, memory-only session isolation, keyword results, and archived-chat exclusion; run server and frontend typechecks.
- [x] Add the mobile sidebar microphone, top overlay, paired-device run transport, mobile UI tool targets, and focused mesh lifecycle coverage without adding mobile Companion settings.
- [x] Consolidate desktop UI tools behind one typed workspace provider, derive execution and dependency rules from the fixed tool catalog, and share browser-tool lifecycle bookkeeping across desktop and mobile transports.
- [x] Add revision-checked, repeatedly editable proposal review and explicit execution on desktop and mobile; retire the direct mobile draft-creation tool.
- [x] Add privacy-safe per-message latency telemetry, bounded SQLite retention, structured Hub logging, and an aggregate diagnostics API across desktop and mobile transports.

## Feedback and Decisions

- **Decided:** The feature is called Companion, is voice-first, uses Blip, appears as an overlay, and only receives Drone Hub-related tools.
- **Decided:** UI work is performed through tools whose structured results return to the agent during the run.
- **Decided:** Companion can search across Drone Hub chats and inspect Hub-wide repository, drone, and chat relationships through read-only tools.
- **Decided:** Composer and open-editor changes use separate `apply_composer_patch` and `apply_editor_patch` tools; editor patches are allowed only in edit mode and remain unsaved.
- **Decided:** The overlay has expandable tool-call activity and renders the final response as Markdown using existing agent-chat UI.
- **Decided:** Companion has its own Settings tab and profile-scoped system prompt, enabled-tool list, model, and reasoning configuration.
- **Decided:** Companion supports OpenAI, Codex, and Gemini through the existing Hub provider credentials and model mappings.
- **Decided:** The only first-version voice behavior is toggle-to-talk. The second toggle stops recording and then transcribes; silence never submits automatically.
- **Decided:** Escape cancels only the active desktop recording and is consumed before other app Escape handlers; it preserves any earlier completed Companion reply.
- **Decided:** Closing the overlay cancels and permanently erases the conversation. Recoverable history is deferred.
- **Decided:** Both patch tools commit immediately without confirmation and must remain reversible with one Ctrl/Cmd+Z. Insert-only patches handle empty targets, so no separate write tool is needed.
- **Decided:** Chat search is keyword-only and excludes archived chats in the first version.
- **Decided:** Companion sessions use an isolated in-memory SQLite repository. Normal close deletes them, while a Hub crash removes them with process memory.
- **Decided:** Companion maintains one revision-checked, fully validated proposal document that can be patched over multiple turns without blocking the conversation.
- **Decided:** Proposal approval executes ordered group, drone, chat, clone, and message operations; later operations can reference a drone created or cloned earlier in the same proposal.
- **Decided:** Companion can open an existing chat with `open_drone_chat` and can highlight drones immediately, but creation, deletion, renaming, and messaging require proposal approval.
- **Decided:** Mobile uses a sidebar microphone and top overlay, reuses the existing phone voice recorder and Hub Companion settings, and reaches the same runtime through a permissioned device-mesh capability.
- **Decided:** Companion takes the backtick default shortcut. Existing users with the old default voice-to-clipboard binding are migrated to Companion and voice-to-clipboard becomes unbound; custom bindings are preserved.
