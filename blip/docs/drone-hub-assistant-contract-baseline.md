# Drone Hub Assistant Contract Baseline

## Purpose

This is the Phase 0 migration baseline for replacing the Drone Hub assistant runtime with Blip. It records behavior that must remain stable, where that behavior is tested, and the canonical decisions for overlapping assistant and MCP tools.

The baseline describes the old assistant from the user's point of view. It does not require Blip core to own Drone Hub behavior.

## Automated Contract Coverage

| Area | Contract to preserve | Current coverage |
| --- | --- | --- |
| Blip lifecycle | Stable session, turn, assistant, tool, error, finish, timing, and compaction event order | `blip/packages/core/tests/runtime.test.ts` |
| Embedded Blip lifecycle | One session handle can run multiple prompts; `session_started` is emitted once and `session_finished` once per prompt | `blip/packages/core/tests/runtime.test.ts` |
| Steering and follow-up | Steering is consumed before queued follow-up work; only the initial turn carries the original prompt field | `blip/packages/core/tests/runtime.test.ts` |
| Cancellation | Aborting an embedded prompt settles cleanly with `session_finished.status = cancelled` | `blip/packages/core/tests/runtime.test.ts` |
| Attachments into Blip | Image blocks reach the model and are persisted in the session transcript | `blip/packages/core/tests/runtime.test.ts` |
| Injected tools and policy | Hosts can supply tools and deny a validated call before execution | `blip/packages/core/tests/runtime.test.ts` |
| Thread isolation | Threads retain separate controls, model choices, prompt delivery modes, app context, and active runs | `apps/drone/tests/assistant-thread-isolation.test.ts` |
| Prompt delivery | Queue mode follows up after the active turn; ASAP mode steers the active turn | `apps/drone/tests/blip-assistant-host.test.ts` |
| Access scopes | Empty selection remains a valid no-write scope; new threads default to limited write access; newly created drones are added explicitly | `apps/drone/tests/assistant-thread-isolation.test.ts` |
| File authorization | Read and write scopes are checked before drone file access | `apps/drone/tests/assistant-drone-files.test.ts` |
| Approval behavior | Drone bash requests approval; disallowed host-runtime bash is blocked before approval | `apps/drone/tests/assistant-drone-files.test.ts` |
| File operations | Reads, searches, changed-file listing, patches, ambiguity, atomic preflight, moves, and invalid directory operations | `apps/drone/tests/assistant-drone-files.test.ts` |
| Artifact isolation | Files are private to a thread; paths cannot escape the artifact root; stale and ambiguous edits fail | `apps/drone/tests/assistant-artifacts.test.ts` |
| Artifact uploads | Images and binary files retain bytes and MIME behavior; invalid batches do not leave partial files | `apps/drone/tests/assistant-artifact-uploads.test.ts` |
| Chat attachments | Staged paths, text instructions, image flags, mixed inputs, and duplicate names remain deterministic | `apps/drone/tests/chat-attachments.test.ts` |
| Prompt configuration | The global default, per-thread prompts, migrations, and tool toggles remain separate | `apps/drone/tests/assistant-system-prompt.test.ts` |
| Chat-idle continuation | Any/all waits, pending prompts, unknown targets, cancellation, non-blocking subscriptions, and firing behavior | `apps/drone/tests/assistant-chat-idle.test.ts` |
| MCP authentication | Hub API and MCP credentials are separate; named tokens can be revoked; drone identities cannot be minted publicly | `apps/drone/tests/mcp-http-api.test.ts` |
| MCP result helpers | Text, image, and summary result shapes remain stable | `apps/drone/tests/mcp-server.test.ts` |

## Canonical Domain-Tool Decisions

These decisions resolve behavior that currently differs between custom assistant tools and Drone Hub MCP tools. Phase 3 should implement them at the MCP boundary.

| Operation | Canonical behavior |
| --- | --- |
| Create or clone a drone | Default completion means the drone is ready, matching current assistant behavior. If accepted-only completion is needed, expose it as an explicit option and return a distinct phase. |
| Create or clone runtime | Assistant-created and cloned drones use the container runtime. Host cloning is rejected unless a future explicit policy says otherwise. |
| Send a chat message | Success means the message was durably accepted or queued. Waiting for the answer is a separate chat-idle subscription. |
| Create a chat | Success means the chat exists and can receive messages; it does not imply that an agent has responded. |
| Chat-idle subscription | Subscription creation returns immediately. Delivery is correlated to one assistant session, fires once, and records fired, cancelled, expired, or failed state. |
| Filesystem operations | Generic coding file operations use workspace targets, not duplicate MCP tools. |
| Result envelope | Human-readable text is accompanied by stable structured details. Accepted, provisioning, ready, and failed phases are never collapsed into the same success shape. |
| Authorization | Every handler receives the authenticated principal and revalidates resource scope at execution time. Tool visibility alone never grants access. |
| Approvals | Create/clone/chat-create remain non-approval actions under current policy. Rename, grouping changes, user-visible message sending, and shell execution retain their current approval effects. |

## Explicit Manual Checks

The following behavior is visual, device-dependent, or impractical to prove completely in a unit test. Run these checks before enabling the Blip-backed assistant by default:

- Confirm the panel clearly distinguishes loading, empty, streaming, queued, waiting, approval, stopped, disconnected, and failed states.
- Confirm approval cards show the resolved drone or workspace and the concrete operation.
- Upload and preview an image, a text file, and a binary file in the assistant panel.
- Exercise desktop and Android microphone input and hear both standard and realtime spoken output.
- Stop a model response and a long-running tool from the panel and confirm both settle without a stuck running state.
- Restart Drone Hub with queued work and with an active chat-idle subscription, then confirm the correct thread resumes once.
- Run equivalent edits in the Blip CLI, a host target, and a drone target and confirm every mutation lands in the displayed target.
- Resume and compact a long migrated thread and confirm older history remains queryable.

## Phase 0 Exit Decision

The migration baseline is complete when this document stays linked to the integration plan, the listed suites pass, and changes to any listed behavior update its test or manual check before the old runtime is removed.
