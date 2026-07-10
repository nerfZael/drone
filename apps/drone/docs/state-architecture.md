# Hub state architecture

## Decision

The Hub is a modular monolith with one canonical persistence boundary: `hub.sqlite`.
HTTP handlers, CLI commands, and background workers call domain application commands or
repositories; those components perform short transactions through the shared database
coordinator. JSON is a migration, backup, and export format, not a live database.

This replaces the former architecture in which unrelated features acquired one global
registry lock and rewrote a multi-megabyte JSON aggregate. That lock coupled file views,
prompt delivery, lifecycle changes, settings, and catalog edits, so an unrelated writer
could make any of them fail after the ten-second lock deadline.

## Database boundary

`host/hub-database.ts` owns the production Node `better-sqlite3` connection and configures:

- WAL journaling and normal synchronous durability
- foreign-key enforcement and a bounded SQLite busy timeout
- a fair in-process FIFO for write transactions
- independently versioned migration scopes
- connection replacement when the configured data directory changes

Transaction callbacks are synchronous by design. Network, Docker, filesystem, and daemon
work happen before or after a database transaction, never inside it.

## Domain ownership

Each aggregate has one canonical owner:

- `host/drone-lifecycle-repository.ts`: real, pending, and archived drone identity and lifecycle
- `host/transcript-store.ts`: active/archived chat metadata, ordered transcript turns, and archive tombstones
- `host/prompt-queue-repository.ts`: prompt enqueue, claim, retry, cancellation, and lease recovery
- `host/assistant-store.ts`: assistant preferences, threads, messages, prompts, and subscriptions
- `host/hub-settings-repository.ts`: provider secrets and all Hub/UI/voice/agent/backup settings, one row per key
- `host/catalog-store.ts`: groups, repositories, skills, MCP servers and tokens, and playbooks
- `host/fleet-workflow-store.ts`: sync sets, durable playbook work, and append-only workflow audit
- `host/hub-outbox.ts`: post-commit notifications and background effects

Cross-domain group rename/delete is coordinated by `hub/group-orchestration.ts`, which
composes catalog subtree changes, lifecycle membership batches, and canonical Kanban
transforms without returning to a global aggregate.

Application commands compose repository changes with an outbox append in the same SQLite
transaction. External effects are dispatched after commit using FIFO claims, leases,
bounded retries, and dead-lettering. A process restart can reclaim an expired lease without
replaying an acknowledged event.

Active-chat commands are owned by the transcript store and coordinate chat metadata,
transcript rows, prompt-queue rows, tombstones, and outbox events in one database transaction.
Creating, renaming, publishing a draft, deleting a chat, and recreating the protected default
chat no longer pass through the registry compatibility layer.

Permanent drone deletion is coordinated by `hub/drone-deletion-service.ts`. On the Node
SQLite path it atomically removes the lifecycle row, every active and archived chat, transcript
turns, prompt rows, and chat tombstones, then appends the deletion event. This command is shared
by the HTTP, CLI, prune, and archived-drone deletion paths.

Canonical prompt delivery is intentionally separate from transcript storage. A prompt can
be leased, retried, cancelled, or tombstoned without rewriting chat history, while transcript
turns remain ordered and independently mutable.

## Read models and hot paths

The Hub uses purpose-built read models for interactive traffic. `loadRegistry()` is an
export/compatibility boundary, not a general-purpose query API: assembling it requires
joining every canonical domain into the legacy aggregate shape, so request handlers and
recurring workers must not use it for bounded reads.

- `hub/canonical-drone-read-model.ts` builds the active/pending Drone Hub summary with a
  fixed set of targeted SQL queries. It reads only active lifecycle rows, chat metadata,
  the latest 60 turns per chat (plus active queue-gate turns), and the bounded prompt
  data required by the UI. The model is read-only and may be shared briefly across
  simultaneous summary, status, SSE, and assistant-idle
  consumers.
- Chat state reads resolve lifecycle identity directly, read the transcript version first,
  and honor `If-None-Match` before loading transcript rows. A normal chat load requests one
  bounded transcript tail together with pending prompts; complete history is fetched only
  for an explicit copy or download action.
- Prompt-queue reads and background reconciliation use their canonical repositories and
  already-resolved lifecycle rows. Reads do not import legacy chat state or perform a
  compatibility backfill.
- Repository change scans are single-flight per repository, use a short-lived result cache,
  batch changed-file hashing into one Git invocation, and are invalidated by repository
  mutation commands. The browser schedules the next poll only after the current request
  completes and only while the relevant view is visible.
- Local development uses the Vite same-origin proxy unless a direct API origin is explicitly
  configured, avoiding unnecessary CORS preflight requests.

Read-path tests should assert both the returned projection and that SQLite `total_changes`
does not increase. Performance-sensitive handlers expose phase-level `Server-Timing` values
so storage work can be distinguished from network scheduling or external Docker/Git work.

## Compatibility and migration

`loadRegistry()` is now a compatibility read projection assembled from canonical domain
rows. Existing API code may consume the registry-shaped result during migration, but it is
not reading a canonical registry aggregate.

The old `registry_json` value is retained only as an insert-only migration seed and recovery
artifact. A small `legacy_residual_state` row preserves fields that do not yet have a typed
owner; canonical namespaces and chats are stripped before it is stored. Manual and scheduled
backups export a fresh registry-shaped projection from canonical state.

Compatibility follows these rules:

1. Canonical rows always win over legacy snapshots.
2. Imports insert missing identities only; tombstones prevent resurrection.
3. Production Node fails loudly if the canonical database cannot be opened.
4. The old file-lock implementation is available only when the native SQLite binding is
   unavailable, principally for the existing Bun test/fallback path.
5. No new domain or high-frequency state may be added to the residual JSON shape.
6. On production Node, `updateRegistry()` rejects mutations to every canonical namespace,
   canonical setting, and fleet audit with `CanonicalRegistryMutationError`; the surrounding
   residual transaction rolls back.

The production lifecycle, prompt, settings, catalog, workflow, Kanban, CLI, provisioning,
group-orchestration, active-chat, archived-chat, and permanent-drone-deletion paths now call
canonical owners directly. The former lifecycle/chat registry-mutation translator has been
deleted. Searches still find `updateRegistry()` in compatibility-only features and explicit
Bun/native-SQLite-unavailable or store-unavailable branches; those calls cannot mutate
canonical-owned state on production Node.

## Command and concurrency rules

- Use stable IDs as identity; display names are mutable attributes.
- Enforce invariants such as active display-name uniqueness inside the canonical transaction.
- Use targeted updates or domain transforms instead of read/modify/write of a global object.
- Keep compatibility backfills idempotent and non-destructive.
- Represent deletion with a durable row or tombstone when stale imports could otherwise
  resurrect data.
- Publish work through the transactional outbox rather than performing effects before commit.
- Make queue claims conditional and leased; do not hold a database transaction while work runs.

## Verification expectations

Every canonical domain covers the relevant subset of:

- migration idempotency and canonical precedence
- transaction rollback and concurrent writers/claimants
- restart, lease, retry, and tombstone recovery
- cross-process contention for shared invariants
- data-directory switching in tests
- production Node binding behavior
- explicit Bun fallback behavior where the existing harness requires it
- canonical JSON backup/export without a live registry rewrite

## Retirement gate

The canonical-write retirement gate is complete:

1. Composite active-chat mutations use dedicated transcript-store commands, including prompt
   coordination and protected default-chat recreation.
2. Permanent drone deletion performs lifecycle-wide active chat, archived chat, transcript,
   prompt, and tombstone cleanup through one application command.
3. The lifecycle/chat compatibility translator is gone, and production Node rejects canonical
   mutations attempted through `updateRegistry()`.

`registry_json`, residual mutation support, the compatibility read projection, and the Bun
file-lock fallback can now be deprecated independently. Keeping the read projection and JSON
export is a product/API compatibility decision rather than a persistence-integrity requirement.
