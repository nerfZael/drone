# Phase 1 Plan: Fleet Coordination

## Goal

Enable one drone to create and communicate with other drones through the Hub, with strong safety controls:

- Not every drone can create drones.
- Creation and messaging are quota-limited.
- Message reads are paginated and context-safe by default.
- Operators can monitor and audit fleet activity.

## Phase 1 Scope (In)

- Fleet-mediated control only (no direct drone-to-drone transport).
- Capability checks for:
  - create child drones
  - send messages
  - read messages
- Basic lineage tracking (parent drone -> child drones).
- Hard limits and throttles for spawning and messaging.
- Cursor-based pagination for message reads.
- Minimal monitoring views in Drone Hub (table/list first, graph later).
- Audit log entries for create/send/read actions.

## Phase 1 Non-Goals (Out)

- Full pub/sub or event bus.
- Multi-hop autonomous delegation chains.
- Advanced policy engine with complex condition language.
- Rich graph visualization and replay UI.
- Cross-repo, multi-tenant isolation model.

## Architecture (Phase 1)

Recommended pattern: parent drones do not call Hub directly. Agents inside containers call a local `fleet` CLI, which talks to the local daemon. Hub reconciles those requests.

```text
Parent Drone Agent -> `fleet` CLI -> Local Drone Daemon (persisted fleet request queue)
             -> Hub Reconciler pulls requests
             -> policy + quota + lineage checks
             -> create/queue child drone OR send/read messages
             -> append audit event + write result
             -> `fleet` CLI polls daemon for result
```

### Why this is the recommended Phase 1 flow

- Avoids exposing Hub networking/auth directly into containers in Phase 1.
- Reuses existing daemon queue/reconcile pattern already used for prompt jobs.
- Improves reliability (requests survive restarts and can be retried idempotently).
- Gives a single enforcement point for permissions/quotas/audit.

## Security Model (Phase 1)

### Identity

- Every drone has a stable identity (`droneName` initially).
- Requests include an actor context that maps to the calling drone.

### Capabilities

Define per-drone capabilities:

- `drone:create`
- `drone:message:send`
- `drone:message:read`

Optional read scope extension for later:

- `self`, `children`, `explicit-allowlist`

### Authorization Rules

- A drone can create children only if it has `drone:create`.
- A drone can message/read only if it has the relevant capability.
- For Phase 1, default read scope is only children created by that actor.
- System/admin actor bypass remains host-side only.

## Limits and Quotas (Phase 1 Defaults)

These should be configurable by env/settings, with safe defaults:

- Max children per parent drone: `5`
- Max creations per parent per hour: `10`
- Max total pending creations global: `50`
- Max outgoing messages per parent per minute: `30`
- Max message size: `8 KB`
- Max read page size: `50` messages
- Default read page size: `20` messages
- Max read characters per request: `32,000`

## Message Read Pagination Contract

Use cursor-based pagination only (avoid offset for mutable streams).

Request:

- `limit` (bounded by max)
- `cursor` (opaque token from prior response)
- `order=desc` default (newest first)

Response:

- `items`
- `nextCursor` (null when exhausted)
- `hasMore`
- `truncated` (true when context budget was hit)
- `budget` metadata (`maxChars`, `returnedChars`)

Default behavior should return recent items only and never dump full history automatically.

## Fleet Request Contract (Container -> Local Daemon)

Primary interface for agents: `fleet` CLI.

Example command shape:

- `fleet create --name <child> --group <group> [--idempotency-key <key>]`
- `fleet send --to <drone> --chat <chat> --message "<text>"`
- `fleet read --from <drone> --chat <chat> --limit 20 [--cursor <cursor>]`
- `fleet request status --id <requestId>`
- `fleet capabilities`
- `fleet help`

Daemon-local API (implementation detail behind CLI):

- `POST /v1/fleet/requests`
  - body:
    - `idempotencyKey`
    - `type`: `create_child | send_message | read_messages`
    - `payload` (type-specific fields)
- `GET /v1/fleet/requests/:id`
  - returns current state + result/error
- `GET /v1/fleet/requests?state=queued|running|done|failed` (optional for UX/debug)

### Request state machine

- `queued -> running -> done`
- `queued|running -> failed`
- retries with same `idempotencyKey` return the same logical operation/result

## Proposed Phase 1 API Surface

### Agent-facing interface (inside container)

- `fleet` CLI (preferred, voice-friendly and agent-friendly)

### Daemon-local API (used by Fleet CLI)

- `POST /v1/fleet/requests`
- `GET /v1/fleet/requests/:id`
- `GET /v1/fleet/requests` (optional list/filter)

### Hub API (called by Drone Hub UI / operator tools)

- `GET /api/fleet/actors/:drone`
  - fleet config, limits, usage, and relationships
- `POST /api/fleet/actors/:drone/config`
  - enable/disable fleet mode, set permissions/quotas
- `POST /api/fleet/actors/:drone/assigned`
  - assign callable drones (non-lineage)
- `DELETE /api/fleet/actors/:drone/assigned/:target`
  - remove assignment
- `GET /api/fleet/audit`
  - list fleet events (filter by actor/target/action/status)

## Data Model Additions (Draft)

Persist lightweight metadata in registry (or sidecar file if preferred):

- Drone fleet policy:
  - enabled (fleet toggle)
  - capabilities
  - quota overrides
- Lineage:
  - `createdBy`
  - `createdAt`
- Access relationships:
  - `children` (lineage-owned)
  - `assigned` (callable but not owned)
- Fleet requests (daemon side):
  - `id`, `idempotencyKey`, `type`, `payload`, `state`, `result`, `error`, `createdAt`, `updatedAt`
- Audit events:
  - `id`, `at`, `actor`, `action`, `target`, `status`, `reason?`, `meta`

Keep audit bounded with rolling retention (for example last `N` or age-based pruning).

## Drone Hub UI (Phase 1)

### New "Fleet" tool/tab (per selected drone)

1. **Fleet toggle**
   - enable/disable fleet control for this drone
2. **Permissions + limits**
   - configure create/send/read capabilities and quotas
3. **Relationships panel**
   - `Children` list (lineage-owned drones)
   - `Assigned` list (drag-and-drop from drone list, callable but not owned)
4. **Activity feed**
   - recent create/send/read requests and denials
   - filter by action/status
5. **Chat-first message UX**
   - keep full message content in chat views
   - Fleet tab shows links/metadata/events, not duplicate transcript rendering

## Agent Fleet Discoverability and Onboarding

This must be explicit. Agents should not rely on hidden assumptions about fleet behavior.

### Recommended Phase 1 approach (CLI-first, no bootstrap requirement)

1. **CLI help as primary discoverability**
   - `fleet help`
   - `fleet <command> --help`
2. **CLI capability output (canonical runtime truth)**
   - `fleet capabilities` (backed by daemon endpoint)
   - Returns:
     - `enabled`
     - allowed operations
     - limits/quotas
     - scopes (`children`, `assigned`)
     - `apiVersion`
3. **Self-describing endpoint (optional, still available)**
   - `GET /v1/fleet/help` (or `GET /v1/fleet/capabilities?verbose=1`)
   - Returns operation docs, field descriptions, example requests, common errors.

### Why this is better than only one method

- Agents are better at invoking CLI tools than composing ad hoc curl payloads.
- `fleet --help` is immediately discoverable from a user instruction.
- Runtime capabilities still stay in sync with actual policy/limits.

### Additional options (optional)

- **Command aliases**: add short aliases for voice ergonomics (`fleet ls`, `fleet msg`, `fleet mk`).
- **Auto-reminder on repeated failures**: after N policy/validation errors, daemon posts a concise hint with endpoint examples.
- **Version mismatch warning**: if request `apiVersion` is unsupported, return actionable upgrade guidance.

### Decision for Phase 1

- Use `fleet` CLI as the default agent interface.
- Keep daemon HTTP as an implementation detail behind CLI.
- Do not require an automatic bootstrap message as a baseline behavior.

## Observability

- Add structured hub logs for policy denials and quota rejections.
- Emit counters:
  - creations requested/accepted/rejected
  - messages sent/rejected
  - paginated reads + average page size
- Surface denial reasons in UI and API errors.

## Rollout Plan

1. Add daemon Fleet request queue endpoints (`/v1/fleet/requests*`).
2. Add Hub reconciler loop for daemon Fleet requests.
3. Add backend authorization + lineage/assignment checks.
4. Add quota enforcement with defaults and config.
5. Add message pagination contract and context guards.
6. Add Fleet CLI and discoverability (`fleet help`, `fleet capabilities`, `/v1/fleet/help`).
7. Add audit event pipeline.
8. Add Fleet tab (toggle, permissions, children/assigned, activity feed).
9. Run soak test with 5-child and 100-child simulation scenarios.

## Acceptance Criteria (Phase 1)

- Unauthorized drone cannot create children.
- Authorized drone cannot exceed create/message quotas.
- Read APIs never return unbounded history.
- "Recent messages" is default everywhere.
- Duplicate retries do not create duplicate drones/messages (`idempotencyKey` behavior).
- Operators can answer:
  - who created each child
  - who messaged whom
  - why a request was denied

## Open Questions

- Should capabilities be stored in registry or separate policy file?
- Should quotas be per-drone only or also per-group?
- Should audit retention be count-based, time-based, or both?
- Do we need manual approval for create requests above threshold in Phase 1 or Phase 2?
- Should assignment grants be one-way only, or support reciprocal "team" grouping later?
- Should read permission default to `children-only` or `children+assigned`?
- Should we support command aliases optimized for voice input in v1 (`fleet msg`, `fleet mk`)?

## Implementation Checklist

- [ ] Define daemon Fleet request schema (`type`, payloads, idempotency)
- [ ] Implement daemon request queue endpoints (`/v1/fleet/requests*`)
- [ ] Implement Hub reconciler for Fleet requests
- [ ] Define fleet policy schema (toggle + capabilities + quota overrides)
- [ ] Add lineage fields for newly created drones
- [ ] Add assignment relationship model (non-lineage callable drones)
- [ ] Add create authorization check
- [ ] Add message send/read authorization checks (children vs assigned scope)
- [ ] Implement quota counters and reset windows
- [ ] Implement paginated read endpoint with cursor
- [ ] Add read context budget enforcement
- [ ] Implement Fleet CLI commands (`fleet create|send|read|request status|capabilities|help`)
- [ ] Implement `/v1/fleet/capabilities` and `/v1/fleet/help` discoverability responses
- [ ] Add audit event recording
- [ ] Add Fleet tab toggle + permissions UI
- [ ] Add children/assigned UI (including drag-and-drop assignment)
- [ ] Add activity feed UI (events + filters + denial reasons)
- [ ] Add tests for deny/allow/quota/pagination cases

