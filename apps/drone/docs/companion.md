# Companion

Desktop Companion now includes an optional, remembered [Live voice mode](companion-live-voice.md). It defaults off and uses GPT-Live 1 with client delegation to the existing configured Companion backend. See that document for controls, lifecycle, and manual validation.

| Field               | Value                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Type                | Feature                                                                                                                                |
| Status              | Implemented                                                                                                                            |
| Approach confidence | 95% — the implementation composes existing Hub systems and has focused automated coverage; final UX polish should follow hands-on use. |

## Summary

Companion is a voice-first assistant opened with a keyboard shortcut on desktop or a sidebar microphone on mobile. It transcribes a short request, runs a small Blip agent with Drone Hub tools, and shows the answer in a desktop corner overlay or at the top of the mobile app.

### Chat focus and organization

On desktop, `get_app_context.selectedChat` identifies the focused chat, including temporary forks and detached windows. `selectedDrone` and `activeRepoPath` follow that chat's drone. `mainChat` and `mainDroneId` identify the main workspace independently, including when a detached window belongs to another drone. Opening or typing in the Companion overlay preserves the previous chat focus. A loading chat window retains its identity; closing or hiding it returns selection to the main chat. Both identities are captured with the request at recording start or text submission. Mobile reports its single selected chat in both fields.

`clone_chat` accepts `sideChat?: boolean` (default false). With true, Apply creates a temporary side chat through the existing fork backend at its latest available checkpoint at execution time. There is no checkpoint argument. The proposal explicitly identifies the side-chat destination and fork timing; `sideChat:true` and `draft:true` cannot be combined. The usual provider/checkpoint restrictions apply. On desktop, the existing workspace displays the new side chat when the drone summary refreshes. Mobile can request this on a connected Hub; phone-native chats do not have temporary side-chat presentation and reject this option explicitly.

Proposal operations also include `create_chat_group`, `rename_chat_group`, `delete_chat_group`, `set_drone_group`, and `move_chats`. Chat groups support nesting. Deleting one removes its nested folders but preserves and promotes their conversations to the parent. Drone moves preserve repository membership; an empty group clears membership, while a missing named group is created in the drone's repository. Chat moves target an existing group path or the root (`targetGroup:""`) inside the same drone, preserving relative order and appending at the destination. Temporary side chats must first be kept in the sidebar using the existing user control before they can be organized into chat groups.

`get_chat_tree` supplies ordered chat-group membership. Settings schema v6 enables it for existing configurations with `list_chats` enabled; subsequent explicit tool choices are preserved. Mutations remain proposal-only with the existing Apply/auto-approval flow. Desktop Apply and mobile's permissioned `sidebar.organize` operation share the validated `/api/companion/organization` endpoint. Devices already trusted with `sidebar.move` inherit the equivalent named organization permission. Phone-native organization uses the same shared chat-tree intents and its existing local sidebar persistence.

### Event subscriptions

Companion exposes the Hub MCP event tools: `subscribe_to_resource_events`, `subscribe_to_custom_events`, `subscribe_to_cron`, the list/get/update/cancel subscription tools, and custom-event catalog/history reads. Chat idle/failure, native change requests, GitHub pull requests, named custom events, and cron schedules use the existing Hub subscription service, including batching, retries, event delivery settings, and per-conversation limits. Settings schema v10 enables these tools for existing profiles with `list_chats`; explicit v10 disablement is preserved. Disabling a tool does not cancel existing subscriptions; cancel them through Companion or close the conversation.

Subscriptions belong to the **open Companion conversation**, independently of the selected drone chat. They act immediately without proposals. Desktop and mobile receive an **Event notification** turn, with normal tool activity, replies, and errors. Queue delivery waits for the active request; ASAP can steer an active request even when Companion's user follow-up setting is Queue. Events do not replace newer queued user requests in the visible reply. Event browser tools reuse the latest user message's captured workspace context; event resource IDs remain the authoritative target for event work.

Closing, cancelling, or disconnecting the Companion conversation ends its subscriptions. Changing the phone's device permissions also closes its Companion session and subscriptions. Hub restarts discard Companion sessions and cancel their orphaned subscriptions. These subscriptions therefore cannot provide reminders while Companion is closed. Each desktop connection gets an independent internal identity, including when clients reuse a run ID. Stored subscription/delivery records follow the Hub's normal retention policy. An unexpected desktop disconnect is shown even after a reply has completed, so it cannot silently leave Companion appearing to watch events.

Manual validation: ask Companion to report when a busy chat finishes, finish that chat, and verify an event reply appears without another user prompt. Try a named custom event and a one-minute cron schedule; inspect, update, and cancel them through Companion. Exercise Queue and ASAP during a running request, then close/reopen Companion and confirm old subscriptions do not resume. Repeat on mobile, including disconnect/reconnect.

### Persistent instructions

The desktop Companion header includes **Edit Companion instructions**, beside the system-prompt editor. Instructions start empty and use the same editor with Save and Discard. They are stored independently as the versioned Hub setting `companion.instructions`, with a 50,000-character limit. Clearing the text is a valid save. Closing a conversation does not erase instructions.

Companion exposes the built-in `companion-instructions` skill through `read_skill` and `apply_instructions_patch`. These tools are available independently of the optional Hub/browser tool selection. The skill's name and description are managed by the app; its text is editable by the user and Companion. The system prompt and user directions determine when Companion should update it. Instructions are behavioral guidance subject to the system prompt and runtime rules.

Before the first model request, the runtime reads the skill and persists a matching assistant tool call and tool result immediately after the first user message. This supplies the content and revision without a model round trip, including when the document is empty. Follow-ups and settings-driven session-handle rebuilds do not repeat the initial read. After compaction, the latest read or successfully patched snapshot is restored in model context when absent, without rewriting historical results. Manual edits become available through a fresh `read_skill` call or at the start of the next conversation.

Agent patches use one Update File operation for the virtual path `companion-instructions.md` and save immediately. Both agent patches and desktop saves require the revision they read. A stale write fails; the agent must reread, and the editor preserves the unsaved draft while offering to load the latest version.

The instructions API is `GET`/`PUT /api/companion/instructions`; PUT accepts `{ content, revision }` and returns HTTP 409 for stale revisions. Mobile Companion uses the same Hub runtime, so it reads and updates the selected Hub's instructions without a mobile editor. Instructions are scoped to that Hub and are not synchronized between separate Hubs.

The agent should perform UI work through real tools, not describe or return actions after it finishes. Text changes should use Blip's patch-envelope format through target-specific composer and editor tools. A dedicated Settings tab should configure its system prompt, enabled tools, provider, model, and reasoning. Reuse the existing Blip host and connect its browser-facing tools to the initiating Drone Hub client over a small authenticated WebSocket RPC channel.

## Background and Scope

The existing built-in agent belongs to a drone chat. Companion belongs to the whole app and should understand the current drone, chat, composer, and editor file without the user repeating that context.

On desktop, each Companion recording captures the repository, drone, chat, selection, pane, and file context when recording starts, before microphone startup. Pause/resume, navigation, transcription, and ASAP follow-ups do not replace that recording's context. Each new recording captures a fresh context. Text submissions capture at Send; the Dictation scratchpad's Companion destination captures as soon as the destination button/shortcut is pressed, before awaiting outstanding transcriptions.

`get_app_context` returns the message's captured selection. Composer and editor tools remain bound to the captured target IDs, read current contents/revisions of those targets, and fail if the original target is no longer available. New proposals inherit their default repository from the originating message rather than the current UI selection; an existing proposal keeps its original default when revised. Tool executors are correlated by message ID so follow-up requests cannot overwrite one another's context. Captures are discarded on completion, cancellation, or close. Navigation tools still act on the UI, and workspace access grants remain current.

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
- A Companion Settings tab for the system prompt, tool checkboxes, explicit provider selection, and provider-scoped model/reasoning selection across OpenAI, Codex, Gemini, and OpenRouter.
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
| Model catalog and API-key resolution                | [`assistant-config.ts`](../src/hub/assistant/assistant-config.ts), [`assistant-runtime.ts`](../src/hub/assistant-runtime.ts), and [`hub-settings.ts`](../src/hub/hub-settings.ts)                                                                                                                                | Extract the OpenAI, Codex, Gemini, and OpenRouter catalog/validation into a shared Hub Blip module; reuse credentials and model resolution while storing separate Companion defaults.        |
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

Closing the overlay erases the conversation. If recording, transcription, or Blip is active, close must abort it first; then clear the audio blob, transcript, activity, reply, pending follow-ups, and browser state and delete the temporary Companion thread. Completed conversations are not recoverable in the first version. Closing does not undo tool effects that already completed, such as a composer patch; those remain visible and undoable. A run-generation check must prevent a late browser tool result from mutating state after close.

### 2. Reuse the existing Blip host

Add a small Companion runtime beside `assistant-runtime.ts`. It should own a second `BlipAssistantHost` with a configuration callback built specifically for Companion. Change the host constructor to accept an optional repository, then give Companion an isolated `HubSessionRepository` opened with an explicit in-memory option. Do not point the existing path-based constructor at the string `:memory:` because it currently resolves all inputs as filesystem paths.

For each run:

1. Bind a generated run ID to the authenticated browser socket that started it.
2. Run Blip through `BlipAssistantHost.promptThread`.
3. Execute server-owned tools locally and browser-owned tools through the bound socket.
4. Return every tool result to Blip so it can continue or correct its plan.
5. Send the final answer to the overlay.
6. In a `finally` block, delete the temporary thread and remove its socket/run binding.

This reuses the complete SQLite repository behavior without writing Companion sessions to disk or creating another repository implementation. A completed turn keeps its thread available for follow-ups; overlay close calls `deleteThread`. Settings → Companion → Follow-up delivery selects ASAP (default) or Queue, using the normal Save button and canonical Hub settings. Both record-and-transcribe and Live mode use this setting. ASAP delivers follow-ups to the running agent through its steering channel; Queue runs them in order after the current request finishes. Changes apply to new backend runs, while an active run keeps its saved delivery mode. Tool activity and elapsed time remain attached to that active run; its final answer is correlated with the latest message. In ASAP mode, follow-ups wait only for runtime startup or teardown when no agent can accept steering. Steering takes effect at the next agent processing point and does not undo completed tool actions. A hard Hub crash drops the in-memory database with the process, so no startup sweep or global deletion of unbound assistant sessions is needed. Close the in-memory repository during graceful Hub shutdown.

Add a dedicated Companion WebSocket route using the existing `ws` and Hub authentication patterns. Its protocol only needs `start_run`, `cancel_run`, `tool_call`, `tool_result`, `activity`, `status`, `reply`, and `error` messages. Stream bounded Blip tool activity to the overlay. Bind runs and tool calls to that socket, apply timeouts, and reject late or mismatched results. Closing the socket aborts its active run and rejects pending browser tool calls. Use a separate no-server `WebSocketServer`, route it from the existing upgrade handler, and extend Hub transport shutdown to close both the terminal and Companion servers.

Build the final reply from assistant text parts only. Do not use `latestAssistantText` unchanged because it currently includes thinking parts; Companion must never render hidden reasoning as the answer.

Mobile starts the same runtime over the paired-device mesh instead of opening the browser-only WebSocket. The mesh capability binds one temporary conversation to the initiating phone, uses the same saved ASAP/Queue delivery choice, streams the same status/activity/reply events, relays phone-local composer and editor tools, and deletes the conversation on overlay close or device revocation. The phone uses its existing one-shot transcription setup when Live is off, or buffered native PCM audio relayed through the Hub with client delegation when Live is enabled in Settings → Built-in → Companion Live voice. See [Companion Live voice](companion-live-voice.md#mobile) for native setup and lifecycle. Companion model, prompt, and enabled tools remain canonical on the Hub.

### 3. Use a fixed, backend-enforced tool set

Companion is Hub-wide, so its read-only server tools may inspect every drone visible to the authenticated Hub user. That scope must be explicit in its backend principal; it must not inherit the currently open chat's narrower scope.

Reuse the in-process Drone Hub MCP client for these server-owned tools:

- `get_hub_overview`: return repository, drone, chat, group, busy, error, and repo-less-drone counts;
- `list_repos`: return the existing stable repository references and counts, with drone counts added;
- `list_drones`: add `hasRepository` and repository filters, and return an unambiguous `repository: null | {...}` plus `chatCount`;
- `list_agent_models`: return available models and reported reasoning levels for a Built-in or CLI agent on the requested runtime;
- `list_groups`: return existing group names and repository scope so proposal operations can target them exactly;
- `list_chats` and `read_chat`: enumerate a drone's chats with their explicit agent/model configuration and inspect recent prompts, final replies/errors, pending messages, and compact activity/file-change counts. `read_chat` defaults to 10 turns (maximum 20) and 4,000 characters per prompt/output/error (maximum 8,000). It requests only that tail with summary activity, and does not return nested agent messages, plans, attachments, or arbitrary turn metadata. To inspect detailed reasoning and tool calls/results, explicitly pass `includeActivity: true`, preferably with `limit: 1`; shared Blip output budgets still apply to model requests. Original chat records remain unchanged;
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

On desktop, one press of the proposal shortcut applies the ready review card. A double press of its default Caps Lock binding toggles session-only auto-approve, which is off when the Companion session starts. While enabled, complete proposals execute after the Companion turn finishes without opening the review card. After every operation completes successfully, the proposal is automatically discarded, whether manually or automatically approved. Failed or partially applied proposals remain until explicitly discarded. Every manual and automatic execution remains available from the Companion header's execution-history button until the session closes, including partial failures and per-operation results.

The proposal card is the single preview surface for pending operations. It shows each structural change and its execution status without inserting speculative groups, drones, or chats into the live sidebar model. The sidebar continues to render confirmed and ordinary optimistic application state, and applied proposal changes appear there through the normal registry refresh.

Applying a patch must preserve user undo. For Monaco-backed composer and file editors, expose an edit method on the registered target that uses `pushUndoStop`, `executeEdits`, and `pushUndoStop` instead of replacing the React `value`; one Ctrl/Cmd+Z should revert the whole Companion patch. For controlled textareas, keep an app-owned Companion undo snapshot and intercept Ctrl/Cmd+Z when the current revision still matches the patched result. Clear that snapshot when the composer is sent, reset, or replaced. Browser tests must cover user typing before and after the patch. Do not claim undo support from `setDraft` or `setOpenedFileContent` alone.

Do not enable shell, direct workspace file writes or saves, generic navigation, settings changes, or the full built-in-agent management catalog. Read-only model discovery is allowed so Companion can validate proposal overrides. Hub mutations and chat messages go through the proposal review boundary; opening an existing chat and temporary highlighting remain immediate navigation actions.

### 4. Add a dedicated Companion Settings tab

Add `CompanionSettingsTab` and `useCompanionSettings` under the existing Settings view. The page should have three sections:

1. **Provider and model:** choose the provider explicitly, then reuse `ChatComposerModelPicker` for that provider's models and model-specific reasoning. Support all Hub Blip providers: OpenAI, Codex, Gemini, and OpenRouter. Do not select a replacement model when the current model/reasoning pair is unavailable for a newly selected provider. Groq remains the voice transcription provider and is not a Companion reasoning provider.
2. **Tools:** reuse the checkbox rows from `AssistantToolsPanel`, including descriptions and All/None controls. Only tools from the fixed Companion catalog appear. Disabling `apply_composer_patch`, for example, removes it from later Companion runs rather than asking the model not to use it. Enabling a patch tool must also enable its matching read tool; disabling the read tool must disable the dependent patch tool. Enforce the same dependency in the settings API.
3. **System prompt:** provide a multiline editor, Save, and Restore default. The configurable prompt controls Companion's role and behavior, but tool authorization, schemas, edit-mode checks, and other safety rules remain enforced in code. Append a short non-editable runtime contract that treats retrieved chat/file content as untrusted data, requires mutations to follow the user's current request, and makes clear that the editable prompt cannot widen tool access.

Store this as one profile-scoped canonical Companion settings record containing `provider`, `model`, `thinkingLevel`, `systemPrompt`, and `enabledTools`. Add `GET` and `PUT /api/settings/companion`; the response should also include the current model choices and Companion tool summaries so the frontend does not duplicate either catalog. Validate the provider/model/reasoning combination, reject unknown tool names, and cap prompt size on the backend.

Use one draft and Save action so provider, model, prompt, and tools change together. Show loading, dirty, saving, saved, and error states, and warn before discarding unsaved changes. Each fresh backend run snapshots the saved settings when it starts. ASAP follow-ups keep the active run's settings; changes rebuild the session configuration for the next fresh run while preserving its transcript. If the selected provider lacks credentials, show that in Settings and fail the message clearly rather than silently switching providers.

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
- Settings can save and restore a Companion system prompt, toggle each allowed tool, explicitly choose OpenAI, Codex, Gemini, or OpenRouter, and choose a valid model/reasoning combination scoped to that provider.
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
- **Decided:** Companion supports OpenAI, Codex, Gemini, and OpenRouter through the existing Hub provider credentials and model mappings. OpenRouter uses `OPENROUTER_API_KEY` or the saved Hub OpenRouter API-key setting.
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

Companion appears above the numpad-plus Dictation recorder when both panels are open. `read_recorder` reads the open scratchpad and its revision; `apply_recorder_patch` applies an undoable strict patch to that same revision. Closing the recorder or changing its text invalidates earlier reads. Recorder patches do not send text and are blocked while a send is being finalized.


## Workspace access

The desktop Companion header has a Workspaces button next to the system prompt editor. It opens the shared workspace picker above the overlay, grouped by device and by repositories, folders, host drones, and container drones. Host drones sharing one directory use one entry. Other devices expose the workspaces they share with this Hub. Unavailable targets remain explicit; tools never silently fall back to a different workspace.

The desktop header also offers **Allow Read · <workspace name>** for the currently open drone. A host drone resolves to its canonical repo/folder (shared host directories share one grant); a container resolves to its drone name and workspace. The device is shown beside the shortcut. Clicking grants Read only, preserves other workspace grants and any existing Write/Execute permissions, and makes this workspace the default. When already selected it offers **Use workspace** to change the default, or shows **Read enabled**. Navigation updates the shortcut’s label, but never changes saved access automatically. Loading, unavailable workspaces, and save failures are explicit, with retry on errors. The full Workspaces picker remains available.

Companion starts with no selected filesystem workspaces. Selections persist in the profile's `companion.workspace-access` settings record, separately from model and prompt settings. Selecting a workspace grants Read (including transfer sources). Write independently permits file edits and transfer destinations. Execute independently permits commands, including the existing local command tool for host folders. Commands run with the runtime's authority and may modify files even when the file-tool Write permission is disabled. A selected workspace cannot have Read disabled; remove the selection instead.

These workspace tools execute directly and do not use proposals or approval prompts. Existing browser tools and Drone Hub proposals retain their behavior, including session-only proposal auto-approval. The runtime reuses Blip's workspace tool schemas, selection tools, patch engine, transfer engine, and local/remote adapters, plus the built-in assistant's filesystem executor.

Tool visibility follows the union of selected workspace capabilities. Every actual target operation and transfer adapter call checks current grants. Changes invalidate cached workspace calls, and the next Companion message rebuilds the tool catalog while preserving the conversation. Revoking access prevents subsequent operations; it does not undo completed effects or erase already-read conversation content. Remote devices additionally enforce their own sharing grants.


The native mobile Companion overlay also has a Workspaces button. It opens a full-screen editor with safe-area spacing, search, device/category grouping, and separate 44-point Write/Execute controls. Save applies the workspace selection to the connected Hub; closing with unsaved changes requires explicit discard. Saving blocks dismissal. The destination Hub is pinned when the editor opens.

Mobile workspace configuration uses the independently permissioned Companion `workspaces.list` and `workspaces.update` mesh operations. Existing grants for `run.start`, `run.cancel`, and `tool.result` continue to allow normal Companion use without automatically granting settings access. Older Hubs or phones lacking the settings grants get an explanatory message. Desktop and mobile share the same saved workspace record and server validation.

Mobile proposals retain their originating device ID and reject application after the target changes. Successful and partially failed proposals refresh the sidebar. Phone-local organization resolves each operation inside the storage write queue so consecutive creates, moves, and renames use the latest layout.

## Floating chat arrangement

Desktop Companion has two immediate browser tools, separate from proposal execution and `get_app_context`:

- `get_chat_window_layout` reads the visible workspace ID, layout revision, viewport, and floating window IDs, chat identities, pixel bounds, minimum sizes, focus and layer order.
- `arrange_chat_windows` requires that workspace ID and revision. `tile` fills the area with equal-sized cells, `pack` packs against a corner without overlap, `stack` intentionally overlaps windows, and `custom` accepts a rectangle for each selected window. `undo` restores the last arrangement while its revision remains current. The workspace also shows an Undo arrangement button.

`windows` defaults to `all_floating`; an explicit ID list controls ordering. Area and custom rectangles use workspace fractions; gap, stack offset and preferred size use pixels. Invalid, stale and non-fitting requests fail before any change. Tile and pack avoid unselected windows. An arrangement returns the actual layout and updated revision. Positions persist through existing workspace storage; drafts and focus are preserved.

Only single-tab, unmaximized floating groups are movable. Main chat and tools are not moved. Filling the workspace with floating chats covers the main chat. Detached chats retain their existing layer above side chats; stack/custom requests that reverse that layer order fail explicitly. Stacking order is session-local, while window bounds persist. Native mobile sessions do not advertise either tool; narrow desktop workspaces return unsupported. Settings v7 enables the tools for existing profiles with chat navigation enabled and preserves explicit v7 disablement.

## Workspace panel arrangement

`get_workspace_window_layout` reads the visible desktop workspace's existing chat, editor, explorer, browser, terminal, and extracted-file panels. It returns panel IDs, titles, displayed file paths, locations, minimum sizes, bounds, tab groups, a split tree, and a layout revision. It also returns `editorTabs`: exact tab IDs, paths/names, loaded status, `tabs`/`panes` presentation, and the hosting panel ID (null when the editor is closed). File contents and drafts are omitted. Geometry remains separate from `get_app_context`; no file contents are read and no filesystem permissions are added.

`arrange_workspace_windows` is immediate and requires the workspace ID and current layout revision. `rows` and `columns` arrange ordered panel IDs vertically or horizontally. `custom` accepts a nested tree: `{panels:[id]}` is a pane, multiple IDs in a leaf retain tabs, and `{direction:"row"|"column",children:[...],weights:[...]}` splits space proportionally. For three files above a chat, use a column whose first child is a row of the three file leaves and whose second child is the chat leaf.

Every docked panel must appear exactly once. This avoids implicitly closing or hiding tools that are omitted from the request. Existing floating panels can be included to dock them; omitted floating panels remain unchanged. File tabs must already have been extracted into workspace panels. This feature does not open files or create new content panels. Empty grid slots may be replaced when arranging the grid.

Existing panel instances are moved without deserializing their content, preserving editor state, terminals, focus, and transcript scroll. Layout changes persist through the existing workspace storage. `undo` and the existing Undo arrangement button restore the prior split/tab layout and any floating panels that were docked. Stale revisions, duplicate/missing panels, and layouts outside any tab’s own minimum or maximum size fail before mutation. Arrangements reject requests during pointer gestures; retry after the gesture finishes. Intermediate moves do not publish partial panel state to the UI. Restore a maximized panel before arranging. Native mobile sessions do not advertise these tools. Settings v8 adds them for existing window-arrangement profiles, while explicit v8 disablement is respected.


## Opening and extracting editor files

`open_workspace_files({droneId, paths, presentation?: "tabs" | "panes", workspaceId?})` opens up to 20 existing files in the currently visible desktop drone. Tabs are the default; panes extract each file into its own workspace panel. The optional `workspaceId` is the filesystem target ID from `list_targets`, not a window-layout revision or ID. It must match the current drone’s canonical workspace. Paths may be absolute or relative to that workspace. Existing list/search tools discover paths once Read is granted; no separate file-search implementation is added.

The server resolves the canonical workspace and checks its current Companion Read grant before resolving each file. Host paths use the existing workspace boundary checks, including symlink escape prevention; symlinks to files inside the selected workspace are supported. A new editor read is checked again before its payload is applied. Loaded tabs are reused without replacing unsaved buffers. A batch reports each file’s status, requested/resolved path, tab ID, panel ID, and any error, alongside the updated layout. A failed presentation may leave a successfully loaded tab open; the response includes that tab’s ID. Navigation interrupts pending opening, including navigation away and back to the same drone. A workspace that becomes hidden or switches to a narrow layout during a read cannot receive a new tab. These tools cannot open a different drone or silently use another selected workspace.

`set_editor_file_presentation({droneId, tabIds, presentation: "tabs" | "panes"})` extracts already-open tabs or returns file panes to the editor. Obtain exact tab IDs from `get_workspace_window_layout.editorTabs`. It preserves unsaved buffers and does not require filesystem access because it only changes the presentation of existing tabs. Returning panes does not run the file-close callback. Both tools act immediately, without proposals, and return the current layout for a subsequent `arrange_workspace_windows` call. The existing editor flow may also open File Explorer when the editor is first shown.

For example, open three paths with `presentation: "panes"`, then arrange their returned panel IDs in a row above the main chat. Include any other docked panels in the requested layout, possibly as tabs in a shared group. Native mobile does not advertise the file tools; narrow/hidden desktop workspaces reject them before opening files. Native mobile retains its existing workspace picker. Settings v9 enables the new tools for previous workspace-arrangement profiles and preserves explicit v9 disablement.


### Auto-approve proposals

Desktop and mobile Companion offer an **Auto-approve proposals** toggle. It defaults off and is saved per Hub in the canonical backend settings repository, shared by both clients. Closing Companion or restarting the app or Hub preserves the preference. Clients restore it when they reconnect to their Hub. Only completed, nonempty proposals with an execution context are auto-applied, and each proposal runs at most once; failed and cancelled turns remain available for manual review.

Desktop uses `GET`/`PUT /api/settings/companion/auto-approve`; mobile uses the `auto-approve.settings.get` and `auto-approve.settings.update` Companion capability operations. These mesh operations require their own grants (or a wildcard Companion grant).
