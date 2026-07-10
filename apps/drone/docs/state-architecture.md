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

Canonical prompt delivery is intentionally separate from transcript storage. A prompt can
be leased, retried, cancelled, or tombstoned without rewriting chat history, while transcript
turns remain ordered and independently mutable.

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

The production lifecycle, prompt, settings, catalog, workflow, Kanban, CLI, provisioning,
group-orchestration, and archived-chat paths now call canonical owners directly. A bounded
active-chat compatibility surface remains in the large Hub server: chat configuration and
the composite create, rename, draft-publish, and permanent-delete/default-recreation routes
still enter through `updateRegistry()` before their explicit chat-store operations. The
translator keeps these routes correct, but its residual write and canonical command are
separate transactions, so this is deliberately the final retirement slice rather than a
pattern for new work.

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

The remaining retirement work is intentionally narrow:

1. Replace the five composite active-chat server mutations with dedicated chat application
   commands, including prompt/default-chat coordination.
2. Add lifecycle-wide archived-chat cleanup when an entire drone is permanently deleted.
3. Remove the lifecycle/chat compatibility translator once searches find no production Node
   caller entering through `updateRegistry()`.

At that point `registry_json`, residual mutation support, and the Bun file-lock fallback can
be deprecated independently; read projection and JSON export may remain for API and backup
compatibility. Until then, all remaining direct registry mutations outside those five routes
are explicit Bun/native-SQLite-unavailable or workflow-store-unavailable fallbacks.
