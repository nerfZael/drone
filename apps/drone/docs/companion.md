# Companion

| Field | Value |
| --- | --- |
| Type | Feature |
| Status | Implemented |
| Approach confidence | 95% — the implementation composes existing Hub systems and has focused automated coverage; final UX polish should follow hands-on use. |

## Summary

Companion is a voice-first assistant opened from anywhere in Drone Hub with a keyboard shortcut. It transcribes a short request, runs a small Blip agent with Drone Hub tools, and shows the answer in a bottom-right overlay.

The agent should perform UI work through real tools, not describe or return actions after it finishes. Text changes should use Blip's patch-envelope format through target-specific composer and editor tools. A dedicated Settings tab should configure its system prompt, enabled tools, model, and reasoning. Reuse the existing Blip host and connect its browser-facing tools to the initiating Drone Hub client over a small authenticated WebSocket RPC channel.

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
- Preparing a prefilled drone draft without creating the drone. Its placeholder is always the first drone row in the Hub sidebar.
- Reading and immediately patching the active chat composer without confirmation. The patch must be one undo step.
- Reading and immediately patching the open editor buffer only while that file is in edit mode. A patch leaves the buffer dirty, does not save it, and must be one undo step.
- Awareness of the active drone, chat, composer, pane, and editor file.
- A clickable Working indicator with tool-call details, plus Markdown rendering for the final reply.
- A Companion Settings tab for the system prompt, tool checkboxes, and model/reasoning selection across OpenAI, Codex, and Gemini.

Continuous transcription, silence-driven end-of-thought detection, spoken replies, recoverable run history, saving files, sending messages, archived-chat search, and real drone creation can be added later. These do not require a different base architecture.

## Existing Code to Reuse

| Need | Existing code | Change needed |
| --- | --- | --- |
| Voice recording and transcription | [`use-chat-voice-recorder.ts`](../../drone-hub/src/droneHub/chat/use-chat-voice-recorder.ts) and [`use-voice-clipboard-recorder.ts`](../../drone-hub/src/droneHub/app/use-voice-clipboard-recorder.ts) | Reuse the existing one-shot toggle flow. Let the recorder accept a `companion` microphone owner and abort an in-flight transcription on close. |
| Microphone exclusion | [`browser-microphone-coordinator.ts`](../../drone-hub/src/droneHub/chat/browser-microphone-coordinator.ts) | Reuse as-is apart from the new owner value and label. |
| Configurable shortcut | [`shortcuts.ts`](../../drone-hub/src/droneHub/app/shortcuts.ts), [`use-drone-hub-lifecycle-effects.ts`](../../drone-hub/src/droneHub/app/use-drone-hub-lifecycle-effects.ts), and [`lifecycle-effect-helpers.ts`](../../drone-hub/src/droneHub/app/lifecycle-effect-helpers.ts) | Add one action and allow it from eligible text inputs, like the existing voice-to-clipboard shortcut. |
| Settings navigation | [`settings-tabs.ts`](../../drone-hub/src/droneHub/app/settings-tabs.ts), [`SettingsView.tsx`](../../drone-hub/src/droneHub/app/SettingsView.tsx), and [`use-drone-hub-ui-store.ts`](../../drone-hub/src/droneHub/app/use-drone-hub-ui-store.ts) | Add a `companion` tab, render its page, and allow it in persisted active-tab state. |
| Model and reasoning picker | [`ChatComposerModelPicker.tsx`](../../drone-hub/src/droneHub/chat/ChatComposerModelPicker.tsx) | Reuse it with a settings placement and visible provider labels so identical OpenAI and Codex model names are not ambiguous. |
| Tool checkboxes | [`AssistantSettingsPanels.tsx`](../../drone-hub/src/droneHub/assistant/AssistantSettingsPanels.tsx) | Reuse `AssistantToolsPanel` with the smaller Companion catalog and its All/None actions. |
| Active composer tools | [`ContinuousDictationContext.tsx`](../../drone-hub/src/droneHub/chat/ContinuousDictationContext.tsx) and [`ChatInput.tsx`](../../drone-hub/src/droneHub/chat/ChatInput.tsx) | Extend registered composers with snapshots and revision-checked commits. Do not add a second composer registry. |
| Active editor file | [`use-file-editor-state.ts`](../../drone-hub/src/droneHub/app/use-file-editor-state.ts) and [`OpenedDroneFilePanel.tsx`](../../drone-hub/src/droneHub/files/OpenedDroneFilePanel.tsx) | Register the open buffer, revision, dirty state, and local edit/preview mode as a browser text target. |
| Patch parsing and application | [`apply-patch.ts`](../../../blip/packages/tools/src/apply-patch.ts) | Reuse `parsePatch` and `applyPatchHunks` on the server; restrict Companion to updates on the selected browser text target and preserve its original line endings. |
| Drone draft UI | [`use-workspace-navigation-actions.ts`](../../drone-hub/src/droneHub/app/use-workspace-navigation-actions.ts), [`DroneSidebar.tsx`](../../drone-hub/src/droneHub/app/DroneSidebar.tsx), [`use-sidebar-read-model.ts`](../../drone-hub/src/droneHub/app/use-sidebar-read-model.ts), and the existing draft stores | Open and prefill the existing draft flow. Render its existing placeholder in a dedicated top slot instead of inserting it into repository/group ordering. Do not create another draft model. |
| Overlay placement and style | [`HubTransientToasts.tsx`](../../drone-hub/src/droneHub/app/HubTransientToasts.tsx) and [`DroneHubOverlays.tsx`](../../drone-hub/src/droneHub/app/DroneHubOverlays.tsx) | Reuse its visual language, but use a separate `CompanionOverlay` because the state lasts longer than a toast. |
| Working and tool-call details | [`AgentRunActivityView.tsx`](../../drone-hub/src/droneHub/assistant/AgentRunActivityView.tsx), [`WorkingElapsedStatus.tsx`](../../drone-hub/src/droneHub/chat/WorkingElapsedStatus.tsx), and [`AssistantTranscript.tsx`](../../drone-hub/src/droneHub/assistant/AssistantTranscript.tsx) | Reuse the elapsed-time summary, tool count, chevron, tool rows, grouping, and bounded scrolling in a tools-only Companion view. |
| Reply rendering | [`ChatMessageBody.tsx`](../../drone-hub/src/droneHub/chat/ChatMessageBody.tsx) and [`MarkdownMessage.tsx`](../../drone-hub/src/droneHub/chat/MarkdownMessage.tsx) | Render the final reply with the same Markdown, code highlighting, links, tables, and copy actions as agent chat. |
| Blip lifecycle, cancellation, and temporary history | [`blip-assistant-host.ts`](../src/hub/assistant/blip-assistant-host.ts) and [`hub-session-repository.ts`](../src/hub/assistant/hub-session-repository.ts) | Let the host accept a repository and run Companion on an isolated in-memory SQLite repository. Delete each run afterward. |
| Drone Hub domain tools | [`in-process-drone-hub-mcp.ts`](../src/hub/assistant/in-process-drone-hub-mcp.ts) and [`mcp-server.ts`](../src/hub/mcp-server.ts) | Filter the catalog to the fixed Companion allow-list. Add bounded chat search. |
| Chats and transcripts | [`transcript-store.ts`](../src/hub/transcript-store.ts) | Keep it as the source of truth. Add a derived, rebuildable keyword index over active chat turns. |
| Bidirectional browser RPC | [`terminal-websocket-upgrade.ts`](../src/hub/terminal-websocket-upgrade.ts), [`terminal-websocket-server.ts`](../src/hub/terminal-websocket-server.ts), [`hub-http-transport.ts`](../src/hub/hub-http-transport.ts), and [`hub-auth.ts`](../src/hub/hub-auth.ts) | Reuse the upgrade, origin, authentication, message, and cleanup patterns for a separate Companion socket, including server shutdown. |
| Model catalog and API-key resolution | [`assistant-config.ts`](../src/hub/assistant/assistant-config.ts), [`assistant-runtime.ts`](../src/hub/assistant-runtime.ts), and [`hub-settings.ts`](../src/hub/hub-settings.ts) | Extract the OpenAI, Codex, and Gemini catalog/validation into a shared Hub Blip module; reuse credentials and model resolution while storing separate Companion defaults. |

The current `/api/assistant/events` stream broadcasts actions to all connected Hub clients. It must not be used for composer drafts or other browser-local state.

## Proposed Approach

### 1. Keep the frontend small

Add `apps/drone-hub/src/droneHub/companion/` with:

- `useCompanion`, which owns recording, transcription, the socket, cancellation, and result state;
- `CompanionOverlay`, mounted once from `DroneHubOverlays`;
- a browser tool executor that validates tool calls and invokes existing UI state methods.

Add one shortcut action with toggle-to-talk behavior. The first press only starts recording. The second press stops recording and starts one-shot transcription. Do not use silence to steer, submit, or end the request. If transcription is empty after trimming, return to idle without opening a Blip session or showing an assistant message. While transcribing or working, repeated shortcut presses do nothing; after completion or error, the next press erases the previous overlay state and starts a new recording.

Extend the composers already registered for continuous dictation. A registered composer should expose its ID, virtual path, text, revision, and a compare-and-set commit. This lets `read_active_composer` and `apply_composer_patch` work across normal, draft, built-in, and multi-chat composers.

Register the open editor buffer in the same small browser text-target layer. The registration must expose whether it is a normal editable text buffer, read-only, or previewing Markdown/HTML. Preview mode is read-only to Companion: `apply_editor_patch` must return `EDITOR_NOT_EDITABLE` and must never switch the user into edit mode. Recheck the mode and revision immediately before committing because either can change during a run.

The overlay should reuse the agent-chat Working presentation. Show elapsed time and tool count in a clickable row; expanding it shows running and completed tool calls and their bounded results. Keep model reasoning hidden. Render the final response through `ChatMessageBody` so normal Markdown behavior stays consistent with agent chat.

Closing the overlay erases the run. If recording, transcription, or Blip is active, close must abort it first; then clear the audio blob, transcript, activity, reply, and browser state and delete the temporary Companion thread. Completed runs are not recoverable in the first version. Closing does not undo tool effects that already completed, such as a composer patch; those remain visible and undoable. A run-generation check must prevent a late browser tool result from mutating state after close.

### 2. Reuse the existing Blip host

Add a small Companion runtime beside `assistant-runtime.ts`. It should own a second `BlipAssistantHost` with a configuration callback built specifically for Companion. Change the host constructor to accept an optional repository, then give Companion an isolated `HubSessionRepository` opened with an explicit in-memory option. Do not point the existing path-based constructor at the string `:memory:` because it currently resolves all inputs as filesystem paths.

For each run:

1. Bind a generated run ID to the authenticated browser socket that started it.
2. Run Blip through `BlipAssistantHost.promptThread`.
3. Execute server-owned tools locally and browser-owned tools through the bound socket.
4. Return every tool result to Blip so it can continue or correct its plan.
5. Send the final answer to the overlay.
6. In a `finally` block, delete the temporary thread and remove its socket/run binding.

This reuses the complete SQLite repository behavior without writing Companion sessions to disk or creating another repository implementation. Normal completion and overlay close still call `deleteThread` in `finally`. A hard Hub crash drops the in-memory database with the process, so no startup sweep or global deletion of unbound assistant sessions is needed. Close the in-memory repository during graceful Hub shutdown.

Add a dedicated Companion WebSocket route using the existing `ws` and Hub authentication patterns. Its protocol only needs `start_run`, `cancel_run`, `tool_call`, `tool_result`, `activity`, `status`, `reply`, and `error` messages. Stream bounded Blip tool activity to the overlay. Bind runs and tool calls to that socket, apply timeouts, and reject late or mismatched results. Closing the socket aborts its active run and rejects pending browser tool calls. Use a separate no-server `WebSocketServer`, route it from the existing upgrade handler, and extend Hub transport shutdown to close both the terminal and Companion servers.

Build the final reply from assistant text parts only. Do not use `latestAssistantText` unchanged because it currently includes thinking parts; Companion must never render hidden reasoning as the answer.

### 3. Use a fixed, backend-enforced tool set

Companion is Hub-wide, so its read-only server tools may inspect every drone visible to the authenticated Hub user. That scope must be explicit in its backend principal; it must not inherit the currently open chat's narrower scope.

Reuse the in-process Drone Hub MCP client for these server-owned tools:

- `get_hub_overview`: return repository, drone, chat, group, busy, error, and repo-less-drone counts;
- `list_repos`: return the existing stable repository references and counts, with drone counts added;
- `list_drones`: add `hasRepository` and repository filters, and return an unambiguous `repository: null | {...}` plus `chatCount`;
- `list_chats` and `read_chat`: enumerate a drone's chats and inspect a selected transcript;
- `search_chat_messages`: perform bounded keyword search across active chats, optionally scoped to a repository, drone, or chat;
- optional read-only workspace tools for the active drone.

Search results should include a short snippet, repository, drone, chat, turn ID, role, timestamp, rank, and stable references that can be passed to `read_chat`. Use hard limits and pagination. Normalize only user prompts, visible assistant output, and visible errors from each active stored turn; do not index reasoning, tool arguments/results, attachments, or hidden metadata. Maintain a small, rebuildable SQLite FTS5 index beside the canonical transcript store and update it in the same transcript transaction. Active-chat deletion or archiving must remove its rows. FTS5 is enabled in the current Hub SQLite runtime, so no fallback or vector store is needed.

Add a browser tool provider whose Blip tools call the bound client and await a structured result:

- `get_app_context`
- `read_active_composer`
- `apply_composer_patch`
- `read_open_file`
- `apply_editor_patch`
- `prepare_drone_draft`
- `highlight_drones`

Each tool has a fixed schema and a matching browser implementation; there is no generic `execute_ui` tool. The read tools return a target ID, virtual path, content, mode, and revision. `apply_composer_patch` and `apply_editor_patch` require the matching target ID and base revision, parse the normal Blip patch envelope on the server, and accept only `Update File` operations for that exact path. Add, delete, move, cross-target, and whole-value replacement operations are rejected.

A separate write or replace tool is not needed. An insert-only update works for an empty composer or editor buffer:

```text
*** Begin Patch
*** Update File: composer.md
@@
+First line
*** End Patch
```

The server applies the patch hunks to the snapshot, then asks the browser to commit the result immediately if the target, revision, and mode still match; there is no confirmation step. On a conflict, the tool returns the latest revision so the agent can reread and retry. `apply_editor_patch` also rejects non-text, read-only, large-file, loading, saving, and preview states. A successful editor patch updates only the unsaved browser buffer; it does not call the save endpoint.

`prepare_drone_draft` opens and populates the existing draft flow, then returns the resulting draft state. Reuse the current draft store and placeholder, but render that placeholder in a dedicated slot before pinned, repository, group, and normal drone rows. It stays visible at the top while a repository or recent-drones filter is active. Any intended repository or group remains part of the draft's creation settings but does not control where its placeholder is shown. Preparing another draft replaces the existing single draft; it does not add a second draft row.

Applying a patch must preserve user undo. For Monaco-backed composer and file editors, expose an edit method on the registered target that uses `pushUndoStop`, `executeEdits`, and `pushUndoStop` instead of replacing the React `value`; one Ctrl/Cmd+Z should revert the whole Companion patch. For controlled textareas, keep an app-owned Companion undo snapshot and intercept Ctrl/Cmd+Z when the current revision still matches the patched result. Clear that snapshot when the composer is sent, reset, or replaced. Browser tests must cover user typing before and after the patch. Do not claim undo support from `setDraft` or `setOpenedFileContent` alone.

Do not enable shell, direct workspace file writes or saves, message sending, actual drone creation, chat/drone navigation, settings changes, or the full built-in-agent catalog in the first version. Broader workspace reads and file search can later reuse a read-only `DroneWorkspaceTarget` for the active drone.

### 4. Add a dedicated Companion Settings tab

Add `CompanionSettingsTab` and `useCompanionSettings` under the existing Settings view. The page should have three sections:

1. **Model:** reuse `ChatComposerModelPicker` for provider, model, and model-specific reasoning. Support all Hub Blip providers: OpenAI, Codex, and Gemini. Add provider labels or grouping because OpenAI and Codex can expose models with the same display name. Groq remains the voice transcription provider and is not a Companion reasoning provider.
2. **Tools:** reuse the checkbox rows from `AssistantToolsPanel`, including descriptions and All/None controls. Only tools from the fixed Companion catalog appear. Disabling `apply_composer_patch`, for example, removes it from later Companion runs rather than asking the model not to use it. Enabling a patch tool must also enable its matching read tool; disabling the read tool must disable the dependent patch tool. Enforce the same dependency in the settings API.
3. **System prompt:** provide a multiline editor, Save, and Restore default. The configurable prompt controls Companion's role and behavior, but tool authorization, schemas, edit-mode checks, and other safety rules remain enforced in code. Append a short non-editable runtime contract that treats retrieved chat/file content as untrusted data, requires mutations to follow the user's current request, and makes clear that the editable prompt cannot widen tool access.

Store this as one profile-scoped canonical Companion settings record containing `provider`, `model`, `thinkingLevel`, `systemPrompt`, and `enabledTools`. Add `GET` and `PUT /api/settings/companion`; the response should also include the current model choices and Companion tool summaries so the frontend does not duplicate either catalog. Validate the provider/model/reasoning combination, reject unknown tool names, and cap prompt size on the backend.

Use one draft and Save action so model, prompt, and tools change together. Show loading, dirty, saving, saved, and error states, and warn before discarding unsaved changes. Each run snapshots the saved settings when it starts; changing settings does not mutate an active run. If the selected provider lacks credentials, show that in Settings and fail the run clearly rather than silently switching providers.

## Success Criteria

- The shortcut and microphone work from normal local Drone Hub screens and report conflicts clearly.
- Companion can combine server-owned Drone Hub tools and browser-owned UI tools in one Blip turn.
- Every UI tool result is visible to the agent before it produces its final answer.
- Composer and editor changes use the normal Blip patch envelope and fail safely when the text or revision is stale.
- Companion cannot patch an editor in preview, read-only, non-text, loading, saving, or large-file mode, and it never saves the file automatically.
- The overlay shows a clickable Working summary with elapsed time, tool count, and expandable tool-call details without exposing model reasoning.
- The final Companion reply renders with the same Markdown component used by agent chat.
- Settings can save and restore a Companion system prompt, toggle each allowed tool, and choose a valid model/reasoning combination from OpenAI, Codex, or Gemini.
- Disabled tools are absent from the runtime catalog, unknown tools cannot be enabled through the API, and setting changes affect the next run only.
- Retrieved chat and file content cannot override the fixed runtime contract or grant additional tools.
- Missing provider credentials produce a clear Settings and overlay error without provider fallback.
- It can report Hub counts, identify repo-less drones and drones with multiple chats, and show each drone's repository membership without scanning the UI.
- Keyword search finds matching content in active chats, returns traceable chat references, and never returns archived chats.
- It can prefill the existing single drone draft without creating or sending anything; the draft remains the first drone row regardless of grouping, pinning, repository selection, or recent-drones filtering.
- Companion can highlight matching drones, but its runtime catalog contains no tool that opens or navigates to a drone or chat.
- A changed composer is never overwritten, and one browser cannot receive another browser's tool calls.
- Cancelling stops audio, transcription, or the Blip run and removes its temporary session.
- Closing the overlay cancels any active stage, deletes the temporary session, and leaves no recoverable Companion run.
- Closing never rolls back completed tool effects, but no browser mutation may land after the run was closed.
- Silence and empty transcripts never create a run, session, message, or tool call.
- Companion session data is memory-only, and a forced mid-run Hub crash leaves no Companion session, binding, or transcript on disk.
- The backend rejects every tool outside the fixed Companion allow-list.

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

## Feedback and Decisions

- **Decided:** The feature is called Companion, is voice-first, uses Blip, appears as an overlay, and only receives Drone Hub-related tools.
- **Decided:** UI work is performed through tools whose structured results return to the agent during the run.
- **Decided:** Companion can search across Drone Hub chats and inspect Hub-wide repository, drone, and chat relationships through read-only tools.
- **Decided:** Composer and open-editor changes use separate `apply_composer_patch` and `apply_editor_patch` tools; editor patches are allowed only in edit mode and remain unsaved.
- **Decided:** The overlay has expandable tool-call activity and renders the final response as Markdown using existing agent-chat UI.
- **Decided:** Companion has its own Settings tab and profile-scoped system prompt, enabled-tool list, model, and reasoning configuration.
- **Decided:** Companion supports OpenAI, Codex, and Gemini through the existing Hub provider credentials and model mappings.
- **Decided:** The only first-version voice behavior is toggle-to-talk. The second toggle stops recording and then transcribes; silence never submits automatically.
- **Decided:** Closing the overlay cancels and permanently erases the run. Recoverable history is deferred.
- **Decided:** Both patch tools commit immediately without confirmation and must remain reversible with one Ctrl/Cmd+Z. Insert-only patches handle empty targets, so no separate write tool is needed.
- **Decided:** Chat search is keyword-only and excludes archived chats in the first version.
- **Decided:** Companion sessions use an isolated in-memory SQLite repository. Normal close deletes them, while a Hub crash removes them with process memory.
- **Decided:** `prepare_drone_draft` reuses the single existing draft but always shows it in a dedicated slot at the top of the Hub sidebar, outside repository/group/filter ordering.
- **Decided:** Companion can highlight drones but has no `open_drone_chat` or other chat/drone navigation tool.
- **Decided:** Companion takes the backtick default shortcut. Existing users with the old default voice-to-clipboard binding are migrated to Companion and voice-to-clipboard becomes unbound; custom bindings are preserved.
