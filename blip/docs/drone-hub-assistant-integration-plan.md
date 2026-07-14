# Blip And Drone Hub Assistant Integration Plan

## Status

This document records the reviewed target architecture and migration plan for using Blip as the coding-agent implementation behind the Drone Hub assistant panel.

It is a design plan, not a claim that the current code already supports these boundaries.

Implementation status:

- Phase 0 is complete. The preservation baseline is recorded in [Drone Hub Assistant Contract Baseline](drone-hub-assistant-contract-baseline.md).
- Phase 1 is complete. `@blip/core` exposes an injected, long-lived session API and the CLI compatibility path uses it.
- Drone Hub still uses its existing assistant runtime until Phase 4.

## Decision Summary

Blip will become the single headless coding-agent runtime used by both the Blip CLI and the Drone Hub assistant.

Blip owns:

- The model and tool-calling loop.
- Session behavior, runtime events, and compaction.
- Prompt assembly, queueing, steering, and cancellation.
- Generic coding-tool definitions and target-neutral execution contracts.

Drone Hub owns:

- Drone, host, device, and workspace discovery.
- The concrete host, drone, artifact, and future device target implementations.
- Drone Hub MCP services and their authorization.
- Permission scopes and approval presentation.
- Assistant persistence, API projection, UI, app context, and voice behavior.

The CLI and Drone Hub are hosts around the same runtime. They inject their own tools, targets, storage, policy, and prompt layers into Blip. Drone Hub does not run Blip as a subprocess for the assistant panel, and Blip does not import Drone Hub concepts.

## Goals

- Replace the duplicate Drone Hub assistant agent loop with Blip.
- Reuse one model-facing set of filesystem and coding tools across every workspace target.
- Reuse Drone Hub domain operations through its MCP server.
- Keep the normal Blip CLI simple and local by default.
- Preserve useful assistant-panel behavior during migration.
- Enforce permissions where operations execute, not only in the model-facing layer.
- Make the runtime practical to embed in future applications.
- Migrate the backend without requiring a simultaneous frontend rewrite.

## Non-Goals

- Moving Drone Hub domain types or services into Blip.
- Making every host use the same storage backend or UI.
- Treating hidden tools as a security boundary.
- Exposing the entire host filesystem by default.
- Replacing realtime voice transport solely for architectural symmetry.
- Powering the assistant panel by spawning the Blip CLI.

## Current State

Both implementations already use `@mariozechner/pi-agent-core` and `@mariozechner/pi-ai`, but each builds a separate product layer around them.

Blip now exposes `createBlipSession()`, a long-lived runtime with injected storage, tools, prompts, policy preflight, and events. `runBlipTask()` is the file-backed local compatibility wrapper used by the CLI.

Drone Hub's `HubAssistantService` currently adds threads, prompt queues, steering, approvals, access scopes, assistant artifacts, voice, chat-idle continuation, and a large custom tool catalog around another agent instance.

The main differences to reconcile are:

- Blip stores append-only JSONL sessions keyed to a local workspace; Drone Hub stores bounded assistant threads and app-specific state.
- Blip tools operate against one local root; Drone Hub has separate host, drone, and artifact implementations with different schemas.
- The assistant and Drone Hub MCP server duplicate some domain tools with differing completion and result semantics.
- The MCP HTTP layer authenticates callers, but the server factory and handlers do not yet consistently receive and enforce the authenticated principal.
- The existing Drone Hub Blip transcript parser is useful for event compatibility but is not a full live assistant integration.

## Target Architecture

```text
Blip CLI ------------------+
                           |
Drone Hub Assistant -------+---- @blip/core
                           |       agent and session runtime
Future hosts --------------+       events, prompts, compaction
                                   queue, steering, cancellation
                                             |
                       +---------------------+----------------------+
                       |                                            |
              @blip/tools contracts                       Other tool providers
              and tool definitions                        MCP, web, voice,
                       |                                  app context, controls
          +------------+-------------+                              |
          |                          |                     Generic MCP adapter
   local CLI target          Drone Hub target adapters              |
   (Blip CLI package)        (Drone backend)               Drone Hub MCP server
                              host / drone / artifacts      (Drone backend)
```

The architecture has five main seams:

1. An embeddable, long-lived Blip session runtime.
2. A storage-independent session repository.
3. Capability-based workspace targets.
4. Pluggable tool providers, including MCP.
5. Permission preflight plus executor-side authorization.

## Package Ownership

The dependency rule is simple: Drone Hub may depend on Blip, but Blip must never depend on Drone Hub.

### `blip/packages/core` (`@blip/core`)

Owns the headless agent runtime:

- Model interaction and session lifecycle.
- Queues, steering, cancellation, and compaction.
- Generic repository, prompt-provider, tool-provider, policy-preflight, and event-sink interfaces.
- Runtime event production.

It must not know what a drone, host target, assistant artifact, Hub approval, UI thread, or voice source is.

The root export is platform-neutral. File-backed storage, local Git/tool setup, and process
diagnostics are available only from the explicit `@blip/core/node` entry point.

### `blip/packages/tools` (`@blip/tools`)

Owns Node local coding-tool implementations and agent-tool composition:

- Tool names, schemas, result envelopes, and error categories.
- Shared path validation, patch parsing, truncation, and telemetry helpers.
- Contract tests that every target implementation must pass.

It must not contain host, drone, connected-device, or assistant-artifact implementations. A reusable local filesystem adapter may remain here; CLI-specific local setup belongs in `@blip/cli`.

### `blip/packages/workspace` (`@blip/workspace`)

Owns the platform-neutral `WorkspaceTarget`, capability, catalog, and active-target contracts. It has
no filesystem or process implementation and is shared by Node and React Native hosts.

### `blip/packages/cli` (`@blip/cli`)

Owns the command-line host:

- CLI arguments, interactive input, and terminal rendering.
- Local workspace target configuration.
- File-backed session configuration.
- CLI prompt layers and local policy presets.

It calls `@blip/core` and does not define another agent loop.

### `blip/packages/mcp` (`@blip/mcp`, add when needed)

Owns only a generic MCP-client-to-Blip-tool adapter:

- MCP connection lifecycle.
- Tool schema conversion and qualified names.
- Structured results, errors, images, and notifications.

It does not contain Drone Hub tool behavior, service calls, or authorization rules.

### `blip/packages/protocol` (`@blip/protocol`)

Owns serializable, dependency-light runtime events, prompt-stream envelopes, and paginated history DTOs shared with browser clients. It contains no runtime, filesystem, Node.js, or Drone Hub dependencies.

### `apps/drone/src/hub/assistant`

Owns the Drone Hub embedding and concrete implementations injected into Blip:

- `HubSessionRepository` and SQLite-backed assistant state.
- `HostWorkspaceTarget`, `DroneWorkspaceTarget`, and `AssistantArtifactsTarget`.
- Target discovery and active-target catalog behavior.
- Permission and approval brokering.
- Versioned runtime-event and paginated-history transport.
- App-context, web, voice, realtime voice, and UI-control providers.
- MCP client setup and principal propagation.

These modules depend on `@blip/core` and `@blip/tools`; the reverse dependency is forbidden.

### Existing Drone Hub locations

- [`apps/drone/src/hub/mcp-server.ts`](../../apps/drone/src/hub/mcp-server.ts) remains the canonical Drone Hub MCP boundary for domain actions.
- Existing Drone Hub storage and domain services remain under `apps/drone`; adapters call them instead of moving their logic into Blip.
- `apps/drone-hub` remains the browser UI. It consumes `@blip/protocol` directly for text-assistant events and history. It never executes target operations or hosts the agent runtime.

## 1. Embeddable Blip Runtime

The long-lived API is:

```ts
const session = await createBlipSession({
  model,
  sessionRepository,
  toolProviders,
  promptProvider,
  permissionPreflight,
  eventSink,
});

await session.prompt(message);
session.steer(message);
session.enqueue(message);
session.abort();
```

The runtime now supports:

- Create, load, resume, fork, and delete.
- Long-lived handles instead of one-shot-only execution.
- Text, image, and attachment-bearing prompts.
- Queueing, steering, cancellation, and clean final status.
- Injected model configuration and API-key resolution.
- Injected tools, prompt layers, persistence, and permission preflight.
- Versioned events and automatic or manual compaction.

`runBlipTask()` remains a convenience wrapper for the CLI and simple callers.

Use one canonical provider ID in persisted state. Hosts translate aliases at their configuration boundary.

Prompt assembly should accept ordered sections:

1. Core coding-agent behavior.
2. Host identity.
3. Workflow guidance.
4. Tool-provider guidance.
5. Permission and target guidance.
6. Repository instructions.
7. Dynamic host context.

The selected workspace target determines where repository instructions are read.

## 2. Session Repository

Define a `SessionRepository` interface for:

- Session metadata creation, loading, listing, and deletion.
- Appending messages and runtime events.
- Reading the raw transcript and compacted model-visible history.
- Writing compaction checkpoints.
- Persisting selected target, grants, and durable session settings.
- Updating titles, model settings, and timestamps.

Implementations:

- `FileSessionRepository`, supplied by the Blip CLI host.
- `HubSessionRepository`, under `apps/drone/src/hub/assistant`.

Use `session` as the core term. Drone Hub can continue displaying `thread` and map UI thread IDs to Blip session IDs.

Hub sessions should preserve an append-only transcript. APIs may return bounded or paginated projections without discarding source history.

The repository persists durable descriptions, not live agent instances, open MCP connections, pending promises, or abort controllers.

## 3. Workspace Targets

Use `execution target` as the broad term and `workspace target` for a target that supports coding or filesystem operations.

```ts
type WorkspaceTargetDescriptor = {
  id: string;
  kind: "local" | "host" | "drone" | "artifacts" | "remote-device";
  label: string;
  rootLabel: string;
  capabilities: WorkspaceCapability[];
};
```

Initial capabilities:

- `files.list`, `files.read`, `files.search`
- `files.write`, `files.delete`, `files.move`
- `directories.create`, `directories.delete`
- `patch.apply`
- `shell.execute`
- `git.status`

Initial implementations:

- The CLI supplies `LocalWorkspaceTarget`.
- Drone Hub supplies `HostWorkspaceTarget`.
- Drone Hub supplies `DroneWorkspaceTarget`.
- Drone Hub supplies `AssistantArtifactsTarget`.

Only the contract belongs in `@blip/tools`. The application that owns a resource owns its concrete adapter.

All model-facing paths are relative to the selected target root. Absolute host paths, container paths, and routing details remain internal.

A single-target CLI does not need target selection tools. A multi-target host supplies `list_targets`, `set_target`, and optionally an explicit `target` override on workspace tools.

The active target is convenience state, not a grant. Every tool call resolves and freezes its target ID before permission evaluation. `set_target` is a sequencing barrier and cannot redirect sibling calls already in flight.

Drone Hub should expose explicit host targets rooted at registered repositories or chosen directories. Whole-host access, if ever offered, is a separate target and permission decision.

## 4. Generic Workspace Tools

Keep one canonical model-facing set in `@blip/tools`:

- `list_files`, `read_file`, `search_files`
- `apply_patch`, `write_file`
- `create_directory`, `delete_file`, `delete_directory`, `move_path`
- `get_working_tree_status`
- `bash`

Tool profiles become presets over target capabilities and policy. A local trusted target may expose shell; a read-only target exposes inspection; artifacts expose files without shell or Git.

Every implementation shares:

- Model-facing names and argument meaning.
- Target-relative path rules.
- Error categories and result envelopes.
- Truncation and telemetry rules.

Use one patch parser and operation model. Remote mutations need revisions or content hashes to prevent stale overwrites. Multi-file changes must be atomic where possible or return explicit partial state.

Parallel reads are safe. Overlapping mutations on the same target paths must be serialized or rejected with a clear conflict.

## 5. Assistant Artifacts

Replace the model-facing `assistant_files` tool with an `AssistantArtifactsTarget`, such as `artifacts:<session-id>`.

The target supports bounded file operations and revision checks, but not shell or Git. The existing Artifacts UI can use direct Hub APIs backed by the same storage. Upload decoding remains an attachment service; text inspection and editing use the generic workspace tools.

This target and its storage stay in Drone Hub, not Blip.

## 6. Tool Providers

Blip accepts multiple tool providers per session. A provider supplies:

- Tool definitions with stable qualified IDs.
- Optional prompt guidance.
- Effect and permission metadata.
- Optional notification or follow-up handling.

Initial providers:

- Workspace tools.
- Drone Hub MCP tools.
- Web search and URL fetching.
- Current app context.
- Voice tools.
- Assistant session controls where model access is useful.

The UI derives availability from loaded catalogs rather than maintaining a second hardcoded tool list. Unavailable saved tools are shown as unavailable instead of silently replaced.

## 7. Drone Hub MCP

Drone Hub domain actions should come through its MCP server:

- Drone, repository, and group discovery.
- Drone create, clone, rename, group, and ordering actions.
- Chat list, create, read, search, and message actions.
- Whiteboard and Drone Hub UI actions.
- Durable chat-idle subscriptions.

Generic filesystem operations do not also belong in the MCP catalog when workspace targets already cover them.

Before cutover, align duplicated assistant and MCP tools on names, schemas, completion semantics, results, errors, and approval effects. If both accepted and ready completion states are useful, expose that distinction explicitly.

The generic `@blip/mcp` adapter connects, loads catalogs, qualifies names, preserves structured data, and maps notifications. The Drone Hub assistant uses that adapter, but the server and all Hub behavior remain under `apps/drone`.

MCP authorization must become a real enforcement boundary:

- Pass the authenticated principal into `createDroneHubMcpServer()`.
- Evaluate that principal in handlers or shared domain services.
- Correlate calls with the assistant session.
- Recheck authorization when the operation executes.

Move chat-idle waits from process memory into a durable Hub service that persists, restores, lists, cancels, and delivers each correlated follow-up once.

## 8. Permissions And Approvals

Permission checks happen at two levels:

1. Runtime preflight produces clear denials or UI approval requests.
2. The workspace target or MCP server performs the final authorization check.

A principal identifies the caller, such as a local CLI user, Drone Hub assistant session, host MCP token, or drone-scoped token.

Session grants separately describe readable targets, writable targets, shell execution, external effects, UI actions, and approval requirements. The current read-all/write-selected behavior becomes a policy preset. An empty write selection means no writable targets.

Tools declare effects such as `read`, `write`, `execute`, `external-side-effect`, and `ui-action`.

Approval flow:

1. Resolve the concrete tool, target, resource, and arguments.
2. Ask policy for allow, deny, or approval-required.
3. Publish a structured request if approval is needed.
4. Wait for approval or cancellation.
5. Execute with a short-lived decision.
6. Revalidate at the executor.
7. Record the decision and result in runtime events.

Approvals show the resolved target and resource, not just raw model arguments. Tool visibility and `autoApprove` are inputs, not substitutes for resource scope.

## 9. Drone Hub Assistant Host

Replace `HubAssistantService` with a smaller host around Blip. It remains responsible for:

- UI thread creation and mapping to Blip sessions.
- Model, prompt, target catalog, and grant configuration.
- MCP connections and principals.
- Approval publication.
- Runtime event projection.
- Voice behavior and thread overview generation.

It must not construct another agent loop or duplicate workspace tools.

During migration, keep the current AssistantDock shell while moving its transcript to versioned Blip events and paginated session queries. Drone Hub should project only host-owned metadata such as thread controls, approvals, targets, and artifacts.

## 10. Voice And Realtime Voice

Normal text assistant threads use Blip directly.

Realtime voice may keep a separate transport, but it must share the canonical tool catalog, target resolution, permission policy, session persistence, and tool execution events. It translates loaded tools into realtime function definitions and executes them through the shared executor instead of maintaining another catalog.

Voice-only tools such as `speak` and automatic spoken replies remain host behavior.

## Migration Plan

### Phase 0: Characterize Current Contracts — Complete

Add a parity checklist and tests for Blip events, assistant queueing and steering, approvals, scopes, artifacts, attachments, voice, chat-idle continuation, and duplicated MCP semantics.

Exit when every behavior intended for preservation has an automated or explicit manual test and conflicting semantics have a canonical decision.

### Phase 1: Extract The Embeddable Runtime — Complete

Refactor `@blip/core` to add a long-lived session handle, injected repository, tools, prompts, preflight, attachments, queueing, steering, cancellation, and event sink. Rebuild the CLI on that API.

Exit when Blip builds and tests pass, CLI one-shot and interactive flows remain compatible, and no Drone Hub concept is imported into core.

### Phase 2: Introduce Workspace Targets — Implemented

Add target descriptors and contract tests in `@blip/tools`. Move local behavior behind the CLI-supplied target. Add host, drone, and artifact targets under `apps/drone/src/hub/assistant/targets`, plus the Drone Hub catalog and active-target selection.

Exit when the same applicable contract suite passes for local, host, drone, and artifact targets; paths remain target-relative; target switching cannot redirect preflighted calls; conflicts fail clearly.

Implemented in `@blip/tools` as a target-neutral catalog and canonical tool dispatcher. The CLI supplies `LocalWorkspaceTarget`; Drone Hub owns its host, drone, and artifact adapters under `apps/drone/src/hub/assistant/targets`. The feature-flagged Hub host currently catalogs visible drone workspaces plus the thread artifact target. A host target is only added when Hub supplies an explicit host filesystem grant and executor; Blip does not know how either remote target works.

### Phase 3: Harden Drone Hub MCP — Implemented

Pass principal and policy context into the server, align duplicate semantics, add missing Hub operations, make waits durable, and introduce the generic Blip MCP adapter.

Exit when principal scope and approval tests pass and the assistant can perform intended Hub actions through MCP.

The MCP server now receives its authenticated principal, enforces drone scope at the tool boundary, exposes explicit accepted-versus-ready completion for provisioning, and persists chat-idle subscriptions in SQLite with restore, list, and cancel operations. `@blip/mcp` is the generic catalog/result adapter. The Drone Hub Blip host connects to the same MCP server in process, so it uses the real MCP schemas and authorization without an HTTP transport hop.

### Phase 4: Add The Drone Hub Blip Host — Complete

Run assistant threads through Blip. Add the Hub repository, host service, target and MCP providers, permissions, voice integration, and the temporary compatibility projector used during migration.

Exit when current AssistantDock streaming, stop, queueing, steering, approvals, artifacts, model settings, and scopes work through the new path.

The Blip host is the only text-assistant path. Thread-to-session bindings, transcripts, runtime events, and Hub thread metadata are stored in `assistant-blip.sqlite`; no assistant session or transcript files are written. A compatibility projector supplies the existing AssistantDock snapshot shape, including streaming text, persisted messages, status, errors, and pending approvals. Attachments continue to use Hub artifact storage, inline images are passed into Blip, and configuration changes invalidate the cached Blip handle before the next prompt.

Drone/chat/group/repository/whiteboard actions come from the MCP provider. Canonical workspace tools dispatch to Drone Hub-owned drone and artifact targets. Remaining app-only tools stay in the Hub provider. Realtime voice keeps its audio transport but loads and executes the same Blip tool catalog. Existing legacy thread messages are intentionally not copied into new Blip sessions.

### Phase 5: Migrate Assistant State — Complete As A Clean Cutover

Current assistant thread data was explicitly disposable, so no legacy-message migration is performed. Drone Hub ignores and removes the active profile's legacy `assistant.json`, creates fresh Hub thread metadata when SQLite is empty, and stores that metadata in `assistant_hub_state` inside `assistant-blip.sqlite`. Blip session metadata, entries, runtime events, and thread bindings use normalized tables in the same database. This cutover does not read, rewrite, or migrate `hub.sqlite`, drone registries, profiles, preferences, or other non-assistant state.

Exit is satisfied when restarts reuse SQLite thread/session bindings, no assistant state file is created, and non-assistant stores remain untouched.

### Phase 6: Remove The Duplicate Runtime — Complete

After parity, remove the old agent construction, custom assistant tool catalog, duplicate filesystem and patch code, and assistant-owned copies of Hub domain tools.

Keep only the Blip host, target adapters, policy, storage, and app-specific providers. Remove the temporary projector in Phase 7.

The old Pi text-agent construction, prompt pump, runtime queues, and monolithic custom tool catalog have been removed. Drone Hub now supplies only app context, web tools, target executors, permission projection, artifacts, and voice metadata. Hub domain operations and durable chat-idle subscriptions come from MCP; filesystem operations come from the canonical workspace tools and Hub-owned targets. Local and remote targets share the parser and operation model exported by `@blip/tools` for patches. Realtime voice loads and executes the same catalog through the Blip host instead of rebuilding the legacy catalog.

### Phase 7: Simplify The Frontend — Complete

The browser-safe `@blip/protocol` package now owns versioned runtime events, prompt-stream envelopes, and paginated history contracts. AssistantDock keeps Hub snapshots only for Hub-owned thread settings, scopes, models, approvals, artifacts, and voice metadata. Text messages and run state come from `useBlipThreadSession`, which consumes direct versioned Blip events over the prompt stream and a reconnectable per-thread event stream, deduplicates delivery, and loads SQLite history in bounded pages.

The compatibility projector and per-event snapshot writes have been removed. The latest 80 messages load initially, older pages load on demand without moving the user's scroll position, and overview generation reads the native Blip history. The remaining large presentational pieces in AssistantDock can be split further as ordinary UI maintenance; they no longer interpret or own agent runtime state.

## Feature-Parity Checklist

Before removing the old runtime, confirm:

- Sessions create, activate, resume, fork, delete, compact, title, and render full history.
- User, assistant, thinking, tool, and result messages stream correctly.
- Follow-up prompts queue or steer according to thread mode, stop, and recover after errors.
- Provider, model, reasoning, global prompt, and per-thread prompt settings survive.
- Tool settings and target selection remain visible and stable.
- Local, host, drone, and artifact operations land in the displayed target.
- Read-all/write-selected, empty write scope, approvals, and auto-approve are enforced server-side.
- Images, uploads, pasted text, private artifacts, revision-safe edits, and retention work.
- Standard and realtime voice use the shared executor and policy.
- Drone and chat actions work through MCP.
- Chat-idle continuation resumes the correct session once and survives restart.
- Loading, empty, disabled, waiting, stopped, disconnected, and error states remain explicit.

## Verification Strategy

Run one generic workspace contract suite against each backend. Cover traversal rejection, bounded reads, binary files, revisions, patches, moves, parallel reads, conflicts, cancellation, timeouts, and stable error shapes.

Authorization tests cover host and drone principals, revoked credentials, reduced scopes, approvals, and attempts to substitute a target after approval.

Runtime tests cover event and transcript order, queueing, steering, cancellation, restart recovery, and compaction with target metadata.

UI tests cover compatibility projection, streaming, approvals with resolved targets, tool and MCP errors, and all non-happy-path states.

Before cutover, manually complete equivalent tasks locally, on a host target, and on a drone target; switch targets and inspect every mutation; restart during queued work and a chat-idle wait; exercise voice; resume and compact a migrated long session.

## Risks And Mitigations

### Target confusion

Freeze the target during preflight, include its ID in events and approvals, make changes sequencing barriers, and display the resolved target everywhere a user authorizes a mutation.

### MCP scope leaks

Inject principals into server handlers, enforce policy in shared services, and test every credential kind against cross-scope operations.

### Tool semantic drift

Share schemas, parsers, result types, and contract tests. Keep backend-specific diagnostics out of the common result contract.

### Partial remote writes

Use transactions where possible. Otherwise preflight all operations and report exact partial state without claiming full success.

### Lost waits after restart

Persist Hub subscriptions and one-time delivery state.

### ESM And CommonJS boundary

`apps/drone` is CommonJS while Blip is ESM. Isolate the required runtime loading in one adapter module initially; do not spread dynamic imports through the backend. Treat a broader module-system migration separately.

### Large simultaneous rewrite

The migration was split across runtime, targets, MCP, state, duplicate-runtime removal, and frontend phases. The temporary compatibility projector was retained only until the frontend could consume the native protocol, then removed in Phase 7.

## Expected Code Organization

Names may evolve, but ownership should trend toward:

```text
blip/packages/core/
  runtime/
  sessions/
  prompts/
  events/
  compaction/

blip/packages/tools/
  definitions/
  contracts/
  patch/
  contract-tests/

blip/packages/mcp/             # generic adapter only
  client/
  tool-adapter/
  notifications/

blip/packages/protocol/        # dependency-light browser-safe DTOs
  src/index.ts

blip/packages/cli/
  local-workspace-target.ts
  file-session-configuration.ts
  CLI configuration, prompts, and rendering

apps/drone/src/hub/assistant/
  blip-assistant-host.ts
  hub-session-repository.ts
  hub-assistant-state-store.ts
  blip-runtime-loader.ts
  in-process-drone-hub-mcp.ts
  mcp-idle-subscription-store.ts
  targets/
    workspace-targets.ts
    assistant-artifacts-target.ts

apps/drone/src/hub/
  mcp-server.ts                 # Hub domain operations and authorization

apps/drone-hub/src/
  droneHub/assistant/
    AssistantDock.tsx
    useBlipThreadSession.ts
```

Do not create empty directories or packages in advance. This layout describes ownership and dependency direction.

## Final Architectural Rule

Blip owns how the coding agent runs, remembers, calls injected tools, and reports progress.

`@blip/tools` owns what generic coding operations mean.

Each host owns where those operations execute.

Drone Hub MCP owns Drone Hub domain actions.

The executor-side policy owns whether a principal may perform an operation on a resource.

The CLI and Drone Hub own how users configure, observe, and interact with the shared Blip runtime.
