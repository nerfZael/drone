# Hub state architecture

## Decision

`hub.sqlite` is the canonical persistence boundary for newly migrated Hub domains. The Hub remains a modular monolith: API handlers and background workers call explicit repositories, and repositories perform short transactions through the shared Hub database coordinator.

The registry snapshot remains a compatibility source for domains that have not yet migrated. It must not be extended with new high-frequency state.

## Database boundary

`host/hub-database.ts` owns the shared Node `better-sqlite3` connection and configures:

- WAL journaling
- normal synchronous durability
- foreign-key enforcement
- a bounded SQLite busy timeout
- a fair in-process FIFO for write transactions
- independently versioned migration scopes

Transaction callbacks are synchronous by design. Network, Docker, filesystem, and daemon work must happen before or after a database transaction, never inside it.

## Canonical domains

### Prompt queue

`host/prompt-queue-repository.ts` owns prompt delivery state. Enqueue, claim, retry, cancellation, and lease recovery are database transitions. Claims are conditional and FIFO within a chat; unrelated chats may progress independently.

The registry and legacy transcript prompt rows are import-only compatibility sources. They may seed a missing prompt but cannot overwrite a canonical row. Cancellation is a durable terminal tombstone so a stale snapshot cannot resurrect work.

Daemon delivery occurs outside the transaction. A lease makes an interrupted `sending` prompt recoverable after Hub restart. Retry state includes an attempt count and bounded backoff.

### Assistant

`host/assistant-store.ts` owns assistant preferences, threads, messages, queued prompts, and chat-idle subscriptions. State is stored in normalized rows and saved with conditional upserts, so unchanged message history is not rewritten.

An existing `assistant.json` is imported once. Its fingerprint is recorded in the same canonical transaction, then the file is renamed as a recovery backup. Once canonical state exists, a reappearing file is archived but never re-imported.

The file backend selected when SQLite is unavailable under Bun exists only for the Bun test runtime. Production Node fails loudly when the canonical database is unavailable.

### UI preferences

`host/hub-settings-repository.ts` stores one canonical row per migrated setting key. UI preferences are the first migrated key. Writes are versioned and support compare-and-swap conflicts while preserving unconditional writes for older clients.

Legacy registry UI preferences are backfilled only when the canonical row is absent. Other settings remain registry-backed until migrated as separate vertical slices.

## Compatibility rules

1. Canonical rows always win over registry snapshots.
2. Compatibility imports insert missing rows only.
3. A failed canonical database open is an error in production; it must not silently create a second source of truth.
4. Failed first-open probes must not leave an empty `hub.sqlite`, because legacy paths use file existence to detect canonical ownership.
5. JSON snapshots are for migration, backup, and export—not live read/modify/write operations.

## Next migration slices

Migrate remaining domains independently rather than recreating a global registry repository:

1. Drone lifecycle and archived drones
2. Chat metadata and transcript reconciliation
3. Groups, repositories, playbooks, skills, and MCP configuration
4. Remaining settings keys
5. CLI writes through Hub application commands
6. Transactional outbox for post-commit SSE and background work

After all writers use explicit repositories, generate registry-shaped JSON only as an export/backup projection and remove the global registry lock.

## Verification expectations

Each migrated domain must cover:

- migration idempotency
- canonical precedence over legacy state
- rollback behavior
- concurrent writers or claims
- restart/crash recovery
- data-directory switching in tests
- Node production-binding behavior
- Bun compatibility behavior where the existing test harness requires it
