# Hub background work consolidation plan

Status: implemented

Last reviewed: 2026-08-10 against `origin/main` at `9c98c5d9`

## Goal

Make Hub background work easier to stop, test, and reason about without creating a
general-purpose job framework. Durable state remains owned by each domain's SQLite repository.

## Problems addressed

- Startup and shutdown are assembled manually in `hub/server.ts`, and several workers do not
  stop or wait for active work consistently.
- Prompt delivery, chat reconciliation, and drone provisioning each implement their own
  bounded keyed FIFO.
- Backups, archive cleanup, status refresh, subscriptions, and the outbox each implement a
  variation of a non-overlapping timer loop.
- Resource subscriptions run cron checks, local chat polling, GitHub network polling, delivery,
  and cleanup sequentially. A slow external poll can delay time-sensitive local work.

## Design decision

Introduce only two shared primitives:

1. `ManagedLoop` owns one non-overlapping task, optional startup execution, periodic or manual
   wake-ups, error reporting, and stop-and-wait behavior.
2. `KeyedWorkQueue<T>` owns bounded FIFO execution, key deduplication, queued-item removal,
   active counts, and stop/drain behavior.

Have `server.ts` keep an explicit list of named async stop functions and invoke them in reverse
order. Do not add a service container, exported lifecycle framework, or worker registry class.

Domain code continues to own:

- SQLite claims, leases, retries, recovery, and dead-letter rules
- whether an enqueue during active work is ignored or requests another run
- delayed retry deadlines and key migration
- workflow, prompt, subscription, and outbox state machines

## Sequential implementation

1. [x] Add characterization tests for current concurrency, deduplication, retry, and shutdown
       behavior. Include a slow-GitHub test proving the desired cron and delivery isolation.
2. [x] Make existing workers expose complete, awaitable shutdown and register their stop functions
       in `server.ts`. Fix the missing backup stop path, wait for active archive and subscription
       work, abort active workflows, and stop prompt, reconciliation, and provisioning intake
       cleanly.
3. [x] Extract `ManagedLoop` from the proven outbox pattern. Migrate backups, archive cleanup, and
       drone status refresh first. Keep domain-specific wrappers where they make call sites clearer,
       and move the outbox only if doing so removes code without changing its lease behavior.
4. [x] Split resource subscriptions into two lanes using `ManagedLoop`:
   - a local one-second lane for cron, chat observation, delivery, and due maintenance;
   - a separately scheduled GitHub lane for external network polling.

   Keep the existing periodic fallback; add event-driven wake-ups only if measured delivery
   latency requires them.

5. [x] Extract `KeyedWorkQueue<T>`. Migrate chat reconciliation first, provisioning second, and the
       pending-prompt pump last. Keep each domain's retry wrapper and active-key policy outside the
       shared queue.
6. [x] Remove superseded queue and timer plumbing after all callers and tests use the shared
       primitives.

## Verification completed

- [x] Unit-test both primitives with short intervals and deferred promises.
- [x] Preserve prompt retry deadlines, rerun-after-active behavior, reconciliation coalescing, and
      provisioning concurrency.
- [x] Verify `server.close()` stops intake, clears timers, and waits for or aborts active work using
      each domain's declared policy.
- [x] Verify partial startup failure unwinds started workers and a later server can start cleanly.
- [x] Verify workflow shutdown aborts active execution and rejects new run requests and approvals.
- [x] Verify a slow GitHub poll does not delay cron events or subscription delivery.
- [x] Verify GitHub fetches and daemon prompt requests receive shutdown cancellation.
- [x] Verify cancelled prompt claims are requeued without consuming a delivery attempt.
- [x] Verify pre-create provisioning remains recoverable while critical creation drains safely.
- [x] Run the targeted Hub tests and the Drone TypeScript typecheck.

## Cancellation policies

| Domain                              | Current shutdown                                                                                          | Recommendation                                                                                                  | Priority |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------- |
| Drone provisioning                  | Cancels during safe pre-create phases and drains once create/import begins                                | Keep the critical create/import phase non-interruptible until provisioning has more durable resume checkpoints. | Done     |
| Pending prompt delivery             | Aborts daemon HTTP and readiness waits, then releases the durable claim without consuming a retry attempt | Keep daemon recovery itself drain-only because interrupting recovery can lose required runtime metadata.        | Done     |
| Resource subscriptions              | Aborts GitHub polling but continues draining local delivery work                                          | Keep external polling cancellation separate from claimed delivery batches.                                      | Done     |
| Workflows                           | Aborts active execution and waits for it to settle                                                        | Keep the current cooperative abort policy and reject new run requests and approvals after shutdown starts.      | Done     |
| Chat reconciliation                 | Drops queued work and waits for the active database operation                                             | Keep graceful draining; the work is short and later events can recreate dropped work.                           | Low      |
| Backups and archive cleanup         | Waits for the active operation                                                                            | Keep graceful draining to avoid partial files or half-finished destructive cleanup.                             | Low      |
| Status refresh and chat maintenance | Clears pending timers and waits for short active work                                                     | Keep the current behavior.                                                                                      | Low      |
| Durable outbox                      | Stops polling and waits for the claimed batch                                                             | Keep lease-aware draining; only add cancellation if the dispatcher gains a safe claim-release operation.        | Low      |

Provisioning intentionally has a narrower cancellation boundary than prompts and GitHub polling.
Interrupting container creation can leave external state that cannot yet be resumed reliably, so
shutdown waits once that critical phase begins.

## Explicitly deferred

- A shared persisted job table or external worker process
- Unifying the domain-specific durable state machines
- SSE heartbeat/broadcaster consolidation
- Replacing cron polling with a precise next-deadline timer
- A background-worker diagnostics or control API

These can be reconsidered only if the two primitives leave meaningful duplication or measured
operational problems.
