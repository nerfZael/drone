# Change Requests v2 implementation plan

## Status

Proposed implementation plan. This document turns
[`cross-workspace-change-requests-design.md`](./cross-workspace-change-requests-design.md)
into an executable replacement plan for the current experimental change-request implementation.

There is no compatibility requirement for existing native change requests. The cutover will delete
all current CR records, revisions, publications, subscriptions, merge attempts, review workspaces,
private refs, and per-request object stores. There will be no dual write, compatibility adapter, or
legacy read path.

## Objective

Support native change requests between any two checkouts of the same registered repository:

- container to container;
- container to host;
- host to container;
- host to host;
- main checkouts and linked Git worktrees in any of those locations.

Source and destination environments must not need direct filesystem access to one another. A
stopped or deleted source checkout must not invalidate an existing CR revision. A stopped
destination checkout must not prevent the repository-level merge from completing.

## Architectural decisions

### 1. A CR belongs to a repository, not a drone or filesystem path

Every registered repository receives an immutable `repositoryId`. Filesystem paths, remote URLs,
GitHub coordinates, drone IDs, and checkout locations are mutable attributes and are never used as
durable repository identity.

The repository catalog remains the owner of repository identity. Its current path-primary-key model
will be rebuilt so that `id` is the primary key and canonical host path is a unique mutable field.
Existing repository catalog entries are preserved and assigned generated IDs; only CR data is
discarded.

### 2. Host repositories, container repositories, and worktrees are checkouts

A checkout is a registered location at which Git operations can run:

```ts
type RepositoryCheckout = {
  id: string;
  repositoryId: string;
  location: { kind: 'host' } | { kind: 'container'; droneId: string };
  path: string;
  managedByDroneHub: boolean;
  fingerprint: string;
  createdAt: string;
  lastSeenAt: string;
};
```

Branch, `HEAD`, cleanliness, shallow state, and availability are inspected live. They are not stored
as authoritative checkout fields.

Managed checkouts and worktrees receive durable IDs in DroneHub-owned metadata. Unmanaged
checkouts receive a fingerprint based on environment identity and verified Git metadata. Moving an
unmanaged checkout preserves its ID only when the old and new locations can be proven to be the
same checkout.

### 3. Branch authority is separate from checkout synchronization

A CR merges into an authoritative repository branch, never directly from one working directory into
another working directory.

```ts
type BranchAuthority = { kind: 'remote'; remote: 'origin' } | { kind: 'hub' };

type ChangeRequestTarget = {
  repositoryId: string;
  branch: string;
  authority: BranchAuthority;
};
```

When `origin/<branch>` exists, `origin` is authoritative. The merge uses a normal, non-force push
that the remote accepts only as a fast-forward.

When a selected destination checkout contains a local-only branch, creation may explicitly seed that
branch into a Hub-owned authoritative ref. The selected checkout must be available, clean, attached
to the named branch, and successfully exported during seeding. The Hub authority then owns that
branch until it is explicitly published to a remote. Its ref lives at:

```text
refs/drone/authority/heads/<branch>
```

Hub-authority updates use transactional `git update-ref` with the expected old SHA. This makes
local-only container and host branches durable without making a transient checkout the source of
truth.

The UI must identify Hub-owned branches clearly. It must never silently choose a diverged checkout
as the authority for an existing branch.

### 4. Squash is the merge shape, not the branch safety mechanism

Every merge produces one squash commit `M` whose sole parent is the freshly observed destination
tip `O`. This keeps a CR auditable as one branch commit and makes a later revert straightforward.

Squashing does not by itself prevent branch replacement. A force push could still point the branch
at an unrelated squash commit. Before any authority mutation, DroneHub must prove all of these
invariants:

- `M` has exactly one parent;
- that parent is exactly `O`;
- `O` is an ancestor of `M`;
- the tree of `M` is the reviewed candidate tree;
- the destination branch, revision, and authority still match the review pins.

Remote updates use an ordinary push without `--force`, `+`, or any force-capable option. The remote
therefore provides an independent fast-forward check and rejects a concurrent destination update.
Hub-authority updates use expected-old-SHA compare-and-swap only after the same parent and ancestry
checks.

### 5. One bare review repository per registered repository

Create one Hub-managed bare Git repository for every `repositoryId`:

```text
<hub-storage>/change-request-repositories/<repositoryId>.git
```

It contains:

```text
refs/drone/change-requests/<request-id>/sources/<revision>
refs/drone/change-requests/<request-id>/revisions/<revision>
refs/drone/change-requests/<request-id>/merged
refs/drone/merge-attempts/<attempt-id>
refs/drone/branch-history/<attempt-id>/before
refs/drone/branch-history/<attempt-id>/after
refs/drone/authority/heads/<branch>
```

The store disables automatic maintenance and unapproved hooks, filters, merge drivers, and diff
drivers. All ref mutation, import, export, fetch, and garbage collection is serialized by a
repository-store lock.

### 6. Runtime differences live behind checkout adapters

Core CR services do not branch on host versus container runtime.

```ts
interface RepositoryCheckoutAdapter {
  discover(repositoryId: string): Promise<RepositoryCheckout[]>;
  inspect(checkout: RepositoryCheckout): Promise<CheckoutGitState>;
  exportRevision(
    checkout: RepositoryCheckout,
    input: { expectedBranch: string; expectedHeadSha: string },
  ): Promise<ExportedGitBundle>;
  applyCandidate(
    checkout: RepositoryCheckout,
    input: {
      branch: string;
      expectedHeadSha: string;
      candidateTreeSha: string;
      bundlePath: string;
    },
  ): Promise<CheckoutApplyResult>;
  importAndFastForward(
    checkout: RepositoryCheckout,
    input: {
      branch: string;
      expectedHeadSha: string;
      mergedSha: string;
      bundlePath: string;
    },
  ): Promise<CheckoutSyncResult>;
}
```

Implement `HostCheckoutAdapter` and `ContainerCheckoutAdapter`. The container adapter transfers Git
bundles; it never receives host Git or remote credentials.

### 7. Applying is a separate, non-completing delivery operation

Every open CR offers **Apply staged to checkout** independently of merge. This operation materializes
the reviewed squash candidate in a selected clean checkout's index and working tree, but creates no
commit, pushes nothing, updates no branch ref, and leaves the CR open. It is the default recommended
action when a person wants to inspect, edit, test, commit, and push the result themselves.

Applying records an immutable receipt with the request and revision, checkout ID, destination branch,
observed checkout `HEAD`, candidate tree, staged paths, actor, and timestamp. `applied` is a delivery
event, not a CR lifecycle status. A later manual commit or push must not cause DroneHub to claim that
the exact CR was merged unless the resulting authoritative history is independently verified.

The apply workflow:

1. Prepare the squash candidate tree against the selected checkout's freshly inspected `HEAD` in the
   review store.
2. Export the candidate and its objects to a temporary verified bundle, then release the review-store
   lock.
3. Acquire `checkout:<checkoutId>` and require the same repository, destination branch, clean index and
   working tree, attached `HEAD`, and unchanged expected SHA.
4. Import the bundle without changing a ref, generate the exact `HEAD^{tree}..candidateTree` binary
   delta, and preflight the complete delta.
5. Apply it to both index and working tree, verify `git write-tree` equals the candidate tree, persist
   the receipt, and release the lock.

Any failed preflight leaves the checkout untouched. Conflict materialization is not the default; a
future explicit manual-conflict mode may leave conflicts only after a separate confirmation. Applying
to a host checkout uses no remote credential. Applying to a container transfers only the verified
bundle or patch through its adapter.

### 8. Checkout synchronization is durable and retryable

The optional destination checkout is a requested synchronization target, not the merge authority.
After the authoritative branch moves, synchronization safely fast-forwards that checkout.

```ts
type ChangeRequestCheckoutSync = {
  requestId: string;
  checkoutId: string;
  branch: string;
  expectedPreviousSha: string;
  mergedSha: string;
  status:
    | 'pending'
    | 'synced'
    | 'sync_required'
    | 'unavailable'
    | 'dirty'
    | 'switched'
    | 'diverged';
  lastError: string | null;
  updatedAt: string;
};
```

A CR is `merged` once the authoritative branch update is durable. Destination synchronization may
remain pending or require user action. UI wording must distinguish repository merge state from
checkout synchronization state.

## Product contract

### Checkout catalog

Add an authorized read-only checkout catalog to the API and Drone Hub MCP server:

```ts
list_repository_checkouts({ repository?: string, includeUnavailable?: boolean })
```

Each result includes checkout ID, repository ID and label, runtime/location, drone provenance,
current branch and HEAD when available, cleanliness, and availability. It does not expose an
unapproved host path or grant new read/write access.

### Create tool

Replace the current `drone` and `chat` source selectors:

```ts
create_change_request({
  title: string;
  description?: string;
  sourceCheckout: string;
  destinationBranch: string;
  destinationCheckout?: string;
  destinationAuthority?: 'origin' | 'hub';
})
```

Rules:

- `sourceCheckout` is required and must be visible and capturable by the caller.

### Apply and merge actions

The UI exposes three distinct actions: **Preview in review workspace**, **Apply staged to checkout**,
and **Merge authoritative branch**. Applying requires checkout-write permission but not remote-merge
permission. Automated remote merge remains a separately authorized action and may be disabled by
repository or branch policy. For protected branches, repository policy may make apply the default or
the only DroneHub landing action.

- Source and destination checkout, when supplied, must have the same `repositoryId`.
- The source must be clean, committed, and on an attached branch.
- `destinationAuthority` defaults to `origin` when the branch exists there.
- `hub` authority is allowed only when seeding from the selected destination checkout or targeting
  an already registered Hub-authority branch.
- Selecting a destination checkout requests synchronization after merge.
- The returned result instructs the agent to include `CR #<number>` in its response.

### Update and retarget

A CR pins its source checkout and source branch. Refresh recaptures that exact checkout and rejects a
missing checkout, switched branch, dirty tree, or repository mismatch.

Retargeting creates a new immutable revision from the retained source ref. It recomputes destination
SHA, merge base, and snapshot without requiring the original checkout to be available.

### Merge and sync tools

Keep merge permission separate from create permission. Add explicit synchronization operations:

```ts
retry_change_request_checkout_sync({ requestNumber: number, checkout?: string })
sync_change_request_to_checkout({ requestNumber: number, checkout: string })
create_change_request_revert({ requestNumber: number })
```

The second operation may add another same-repository follower checkout after merge. Neither tool
may reset, clean, stash, switch, or rebase a checkout automatically.

`create_change_request_revert` creates a new reviewable CR that reverses the selected CR on top of
the authority's current tip. It never moves a branch backward. If later changes overlap the inverse,
the revert CR reports a conflict and requires normal review.

## Persistent model

### Repository catalog

Rebuild `catalog_repositories` around immutable identity:

```text
catalog_repositories
  id                         TEXT PRIMARY KEY
  canonical_path             TEXT NOT NULL UNIQUE
  remote_url                 TEXT
  object_format              TEXT
  github_owner               TEXT
  github_repo                TEXT
  environment_json           TEXT
  agents_json                TEXT
  added_at                   TEXT NOT NULL
  updated_at                 TEXT NOT NULL
```

Add repository checkout storage in the catalog boundary:

```text
catalog_repository_checkouts
  id                         TEXT PRIMARY KEY
  repository_id              TEXT NOT NULL
  location_kind              TEXT NOT NULL
  drone_id                   TEXT
  path                       TEXT NOT NULL
  managed                    INTEGER NOT NULL
  fingerprint                TEXT NOT NULL
  created_at                 TEXT NOT NULL
  last_seen_at               TEXT NOT NULL
  unavailable_at             TEXT
```

Repository and checkout IDs are copied into CR records but are not cross-database foreign keys.
Application services validate catalog identity before CR mutations.

### Change-request database

Recreate the CR tables rather than altering legacy rows.

```text
change_requests
  sequence                   INTEGER PRIMARY KEY AUTOINCREMENT
  id                         TEXT NOT NULL UNIQUE
  state_version              INTEGER NOT NULL
  status                     TEXT NOT NULL
  repository_id              TEXT NOT NULL
  source_checkout_id         TEXT NOT NULL
  source_branch              TEXT NOT NULL
  destination_branch         TEXT NOT NULL
  destination_authority      TEXT NOT NULL
  destination_checkout_id    TEXT
  revision                   INTEGER NOT NULL
  title                      TEXT NOT NULL
  description                TEXT NOT NULL
  provenance_json            TEXT NOT NULL
  created_by_json            TEXT NOT NULL
  merged_by_json             TEXT
  merge_commit_sha           TEXT
  last_error                 TEXT
  created_at                 TEXT NOT NULL
  updated_at                 TEXT NOT NULL
  merged_at                  TEXT
  closed_at                  TEXT

change_request_revisions
  request_id                 TEXT NOT NULL
  revision                   INTEGER NOT NULL
  source_checkout_id         TEXT NOT NULL
  source_branch              TEXT NOT NULL
  source_head_sha            TEXT NOT NULL
  destination_branch         TEXT NOT NULL
  destination_authority      TEXT NOT NULL
  destination_sha            TEXT NOT NULL
  merge_base_sha             TEXT NOT NULL
  snapshot_sha               TEXT NOT NULL
  source_ref                 TEXT NOT NULL
  snapshot_ref               TEXT NOT NULL
  commits_json               TEXT NOT NULL
  created_by_json            TEXT NOT NULL
  created_at                 TEXT NOT NULL
  PRIMARY KEY (request_id, revision)

change_request_merge_attempts
  id                         TEXT PRIMARY KEY
  request_id                 TEXT NOT NULL
  revision                   INTEGER NOT NULL
  repository_id              TEXT NOT NULL
  destination_branch         TEXT NOT NULL
  destination_authority      TEXT NOT NULL
  expected_target_sha        TEXT NOT NULL
  merge_commit_sha           TEXT NOT NULL
  actor_json                 TEXT NOT NULL
  status                     TEXT NOT NULL
  error                      TEXT
  created_at                 TEXT NOT NULL
  updated_at                 TEXT NOT NULL

change_request_checkout_syncs
  request_id                 TEXT NOT NULL
  checkout_id                TEXT NOT NULL
  branch                     TEXT NOT NULL
  expected_previous_sha      TEXT NOT NULL
  merged_sha                 TEXT NOT NULL
  status                     TEXT NOT NULL
  last_error                 TEXT
  created_at                 TEXT NOT NULL
  updated_at                 TEXT NOT NULL
  PRIMARY KEY (request_id, checkout_id)
```

Recreate provider-neutral publication storage against the new CR IDs. Preserve the publication
abstraction, but do not preserve existing publication records.

Index CR lists and events by `repository_id`, status, and update time. Repository-wide UI and linked
message lookup must query `repository_id`; they must not compare `repoRoot` paths.

## Service decomposition

Create these boundaries under `apps/drone/src/hub/change-requests/`:

- `repository-identity-service.ts`: resolves repositories and verifies identity.
- `repository-checkout-catalog.ts`: discovery, registration, authorization, and live inspection.
- `checkout-adapters/host-checkout-adapter.ts`.
- `checkout-adapters/container-checkout-adapter.ts`.
- `branch-authority.ts`: common compare-and-swap interface.
- `origin-branch-authority.ts`.
- `hub-branch-authority.ts`.
- `repository-review-store.ts`: per-repository bare store and private refs.
- `change-request-capture-service.ts`: immutable revision creation.
- `change-request-assessment-service.ts`: stale/conflict/diff calculation.
- `change-request-merge-service.ts`: worktree-free preparation and authority update.
- `change-request-sync-service.ts`: checkout delivery and retry.
- `change-request-recovery-service.ts`: startup merge and sync reconciliation.
- `change-request-repository.ts`: v2 persistence only.

`ChangeRequestService` remains an application-level orchestrator. It should not execute runtime Git
commands directly.

Delete or replace the current runtime-coupled snapshot service, per-request object store, and
temporary-worktree merger after v2 is complete.

## Workflows

### Repository and checkout registration

1. Assign IDs to existing repository catalog entries while preserving their settings.
2. Create the host main-checkout record for each repository.
3. Discover container main checkouts from registered drones.
4. Discover linked worktrees with `git worktree list --porcelain` through the appropriate adapter.
5. Verify object format, remote compatibility, and common history before associating a checkout.
6. Persist managed checkout identity metadata where DroneHub controls the checkout.
7. Mark missing checkouts unavailable rather than deleting them automatically.

### CR capture

1. Resolve and authorize `sourceCheckout`.
2. Acquire its checkout mutation lock.
3. Inspect repository identity, attached branch, HEAD, cleanliness, object format, shallow state, and
   partial-clone state.
4. Resolve the destination authority. If seeding a Hub branch, inspect and export the selected
   destination checkout first.
5. Export the source under a temporary named ref.
6. Reinspect source branch, HEAD, and cleanliness. Reject if any changed.
7. Release the checkout lock.
8. Acquire the repository review-store lock.
9. Verify and import the bundle into a temporary ref.
10. Resolve the authoritative destination SHA and require common history.
11. Compute the true merge base and create the synthetic snapshot commit.
12. Reject an empty proposal.
13. Atomically create immutable source and snapshot refs with `git update-ref --stdin`.
14. Persist the CR and revision. Compensate refs if persistence fails.
15. Emit the committed domain event through the shared outbox.

Checkout and repository-store locks are never held simultaneously.

### Review and assessment

1. Read the immutable revision from the repository store.
2. Refresh only the selected branch authority.
3. Use `git merge-tree --write-tree --messages` against the latest destination SHA.
4. Persist no mutable assessment cache unless profiling proves it necessary.
5. Materialize review workspaces by exporting the exact candidate to the reviewer checkout adapter.
6. Keep review pins: revision, destination branch, destination SHA, and candidate tree SHA.

### Merge

1. Acquire `repositoryId + authority + destinationBranch` lock.
2. Acquire the repository-store lock.
3. Refresh and resolve the latest authoritative SHA.
4. Reject mismatched review pins.
5. Run `merge-tree`; distinguish conflict exit code from operational failure.
6. Create squash commit `M` with `commit-tree`, giving it exactly one parent: the latest destination
   `O`.
7. Verify the parent list, `O..M` ancestry, prepared tree, and all review pins independently.
8. Create the private prepared ref for `M` and a durable branch-history `before` ref for `O`.
9. Persist a prepared attempt before external mutation.
10. Compare-and-swap the authority:
    - push `<prepared-ref>:refs/heads/<branch>` normally, without force, for `origin`;
    - transactionally `update-ref <branch> M O` for Hub authority after the ancestry checks.
11. Read the authoritative ref back. Require `M`, or during recovery a descendant containing `M`,
    before treating the update as successful.
12. Create durable merged and branch-history `after` refs for `M`, then mark the CR and attempt
    completed.
13. Remove only the temporary prepared ref. Retain before/after history refs for rollback and audit.
14. Create a pending sync record for the requested destination checkout.
15. Release locks, then run or enqueue synchronization.

No normal merge path may invoke `--force`, `--force-with-lease`, a `+` refspec, branch deletion, or an
unvalidated arbitrary refspec.

### Revert and recovery history

Retain the authoritative SHA before and after every completed merge in both database metadata and
Hub-owned Git refs. Garbage collection must treat those refs as roots. At minimum, retain them for
the lifetime of the CR; the default policy should retain them indefinitely because their storage cost
is normally only the ref plus already shared objects.

User-facing rollback creates a new revert CR on the current branch tip. Merging that revert produces
another ordinary single-parent squash commit and another non-force fast-forward. DroneHub never
rolls a branch back by resetting it to the `before` SHA.

If an exact pre-merge tree restoration is requested, create a new restoration CR whose candidate
tree restores the retained `before` tree on top of the current tip. Later non-overlapping work remains
in history; overlapping work must surface as a conflict rather than being discarded.

Git recovery does not reverse external effects such as deployments, database migrations, published
artifacts, leaked credentials, or data changes. The UI must state this when offering a revert.

### Destination synchronization

1. Read the merged commit and requested checkout without holding its lock.
2. Export a verified bundle from the repository store.
3. Acquire the checkout mutation lock.
4. Inspect availability, repository, branch, HEAD, cleanliness, and active Git operations.
5. Require the checkout HEAD to equal or be an ancestor of the merged SHA.
6. Import the bundle to a temporary ref.
7. Reinspect the checkout and require the observed state to be unchanged.
8. Fast-forward only, conditioned on the observed SHA.
9. Record `synced`, or a precise retryable/non-retryable status.
10. Remove temporary refs and bundles.

Never switch, reset, clean, stash, rebase, or force-update a destination checkout.

### Recovery

At startup:

- reconcile every prepared authority update;
- retain attempt refs until authority state proves success or failure;
- promote successful attempts into CR state;
- retry pending/unavailable synchronization when its checkout becomes available;
- reconcile orphan private refs against database rows;
- never infer a failed push solely from an interrupted client connection.

## Destructive cutover

The replacement lands as one coordinated cutover. Intermediate implementation commits may exist on
a development branch, but production code never dual-writes or serves mixed v1/v2 data.

### Database reset

Add one explicit `change requests v2 reset` migration or startup maintenance transaction that:

1. Records the known legacy `repo_root`, request ID, and private refs needed for filesystem cleanup.
2. Deletes Drone Hub subscriptions and subscription events whose resource type is
   `change_request`.
3. Deletes pending shared-outbox rows with topic `change-request.events`.
4. Drops legacy publication, merge-attempt, revision, and request tables in foreign-key-safe order.
5. Recreates only the v2 tables and indexes.
6. Resets public CR numbering naturally with the new table.
7. Stores a durable reset-complete marker so cleanup is idempotent.

Do not preserve or translate old CR numbers, links, revisions, mirrors, or subscriptions.

### Git and filesystem reset

Using the cleanup manifest and only DroneHub-owned namespaces:

- delete legacy `refs/drone/change-requests/**` and merge-attempt refs from known host repositories;
- delete `<hub-storage>/change-request-objects/`;
- delete old change-request export, review-bundle, review-preparation, and temporary-worktree data;
- best-effort remove managed review workspaces from available containers;
- leave stopped containers untouched and let their managed-workspace cleanup run when they return;
- create the new `change-request-repositories/` namespace empty.

Cleanup must be implemented as a narrow idempotent maintenance routine. It must not recursively
delete a user repository, workspace root, home directory, or unresolved path.

### Code removal

After the v2 tests pass, remove:

- legacy schema migrations and row adapters that exist only to read v1 CRs;
- per-request object-store creation;
- the temporary-worktree direct merger;
- source selection by `droneRef + chatName`;
- repository scoping by `repoRoot` path;
- any UI or MCP fallback accepting legacy CR identifiers or source fields.

## Implementation sequence

This is build order, not a gradual production migration.

### Work package 1: identity and contracts

- Add repository IDs to the catalog while preserving repository settings.
- Add checkout records, discovery, fingerprints, and authorization.
- Replace shared hub-model CR types with v2 types.
- Define checkout adapter and branch-authority interfaces.
- Add checkout catalog API and MCP tool.
- Add contract tests before Git orchestration work begins.

Exit criteria: every active host/container checkout and worktree has a stable checkout ID and resolves
to exactly one repository ID.

### Work package 2: repository review store and capture

- Implement one bare store per repository.
- Implement host and container inspection/export adapters.
- Implement origin and Hub-authority branch resolution and Hub-branch seeding.
- Implement full-bundle import, verification, immutable refs, and capture compensation.
- Implement v2 repository persistence.

Exit criteria: clean committed revisions can be captured from every source-runtime/worktree variant
and remain reviewable after the source checkout is deleted.

### Work package 3: review, merge, and recovery

- Port revision history, file changes, diffs, and review workspace preparation to the repository
  store.
- Replace temporary-worktree merge with `merge-tree + commit-tree`.
- Implement authority-specific compare-and-swap updates.
- Port prepared-attempt persistence and strengthen startup recovery.

Exit criteria: concurrent updates never overwrite an authoritative branch, and interruption before or
after authority mutation converges to the correct CR state.

### Work package 4: checkout synchronization

- Implement host and container staged-apply operations and immutable application receipts.
- Enforce clean/attached/expected-branch/expected-HEAD preconditions and exact candidate-tree
  verification.
- Implement host and container bundle import.
- Implement safe conditional fast-forward.
- Persist sync states and retry rules.
- Trigger retries when drones/checkouts become available.
- Expose retry/add-checkout operations.

Exit criteria: every host/container target can receive an exact candidate as staged, uncommitted,
unpushed changes, and all destination combinations synchronize safely while dirty, switched, or
diverged checkouts remain unchanged.

### Work package 5: API, MCP, UI, and permissions

- Replace create/update/review/merge route contracts atomically.
- Update agent instructions to select checkout IDs and link `CR #<number>`.
- Make list, lookup, SSE, and message cards repository-ID scoped.
- Add source checkout, branch authority, and checkout sync state to the CR UI.
- Present apply and merge as separate actions, keep applied CRs open, and display the application
  receipt without calling it merged.
- Add destination checkout and authority selectors.
- Add branch-scoped merge permission and checkout-sync permission.
- Add a separate checkout-apply permission; it never implies authority mutation permission.
- Update GitHub publication to read v2 revision and target fields.

Exit criteria: an agent and a user can create, review, merge, and synchronize a CR without seeing or
supplying a raw runtime path.

### Work package 6: reset and deletion

- Implement and test the destructive reset routine.
- Remove all legacy implementation code and compatibility assumptions.
- Run the reset against disposable populated v1 fixtures.
- Verify old links are unavailable and no old refs, stores, subscriptions, or outbox rows remain.

Exit criteria: a fresh v2 system starts with zero CRs and no reachable v1 storage.

## Concurrency and lock order

Use these lock keys:

- checkout mutation: `checkout:<checkoutId>`;
- review store: `repository-store:<repositoryId>`;
- authoritative branch: `branch:<repositoryId>:<authority>:<branch>`;
- CR mutation: `change-request:<requestId>`.

Global order when more than one lock is unavoidable:

1. CR mutation;
2. authoritative branch;
3. repository store.

Checkout locks must not overlap repository-store locks. Object transfer is staged between those
critical sections. Sync similarly exports before acquiring the checkout lock.

Document and test lock order centrally. Reject attempts to acquire locks out of order in development
and test builds.

## Security and integrity rules

- Resolve only registered repository and checkout IDs; never accept arbitrary Git paths.
- Enforce source read/capture, CR management, merge, and destination-sync permissions separately.
- Keep host remote credentials out of containers.
- Disable hooks for automated commits and fast-forwards.
- Reject dirty, detached, changing, missing-object, or repository-mismatched sources.
- Reject destination histories with no common ancestor.
- Verify every bundle before import and prove the imported HEAD matches the inspected source.
- Treat object IDs according to the repository's object format rather than assuming SHA-1.
- Reject unavailable changed Git LFS objects until host-mediated LFS publication exists.
- Represent submodules as Gitlink changes and never mutate submodule repositories automatically.
- Do not use Git alternates for durable storage.

## Test plan

### Unit tests

- repository identity and checkout fingerprint stability;
- checkout authorization and runtime adapter routing;
- attached/detached, clean/dirty, available/unavailable inspection;
- full and incremental bundle verification;
- immutable revision ref transactions and compensation;
- origin and Hub authority compare-and-swap behavior;
- rejection of non-fast-forward, multi-parent, wrong-parent, wrong-tree, and arbitrary-ref updates;
- retained before/after refs and revert-CR construction;
- structured `merge-tree` result and conflict parsing;
- staged apply preflight, exact-tree verification, no-commit/no-push behavior, and receipt persistence;
- sync status classification;
- reset idempotency and path-boundary safety.

### Integration matrix

Exercise every source/destination combination:

| Source                    | Destination               | Authority |
| ------------------------- | ------------------------- | --------- |
| Host main checkout        | Host main checkout        | Origin    |
| Host worktree             | Container main checkout   | Origin    |
| Host main checkout        | Container worktree        | Hub       |
| Container main checkout   | Host main checkout        | Origin    |
| Container worktree        | Host worktree             | Hub       |
| Container A main checkout | Container B main checkout | Origin    |
| Container A worktree      | Container B worktree      | Hub       |

For each applicable row, test clean success plus stopped, deleted, dirty, switched, behind,
fast-forwardable, and diverged destination states.

For each source/destination runtime pairing, also test staged apply. Assert that `HEAD`, local and
remote refs, and CR lifecycle state do not move; only the selected checkout's index and working tree
may change, and `git write-tree` must equal the prepared candidate tree.

### Failure and recovery tests

- source mutation during export;
- source deletion after capture;
- destination mutation during merge;
- attempted unrelated-history branch replacement;
- force-capable option or refspec rejection;
- two concurrent CRs targeting one branch;
- interruption before prepared-attempt persistence;
- interruption after attempt persistence but before authority update;
- successful authority update followed by process death before CR persistence;
- remote transport ambiguity;
- destination synchronization interruption before and after ref movement;
- revert after later non-overlapping and overlapping branch changes;
- orphan private refs and missing database rows;
- shallow and partial clones;
- missing LFS payloads;
- SHA-256 repositories when supported by the installed Git;
- stopped containers returning after merge;
- v1 reset with populated CRs, mirrors, subscriptions, outbox events, refs, and object directories.

## Observability

Emit structured operation logs with correlation IDs for capture, review preparation, merge attempt,
authority update, recovery, and checkout sync. Never log credentials, bundle contents, full diffs, or
private host paths in user-visible errors.

Expose diagnostics in the CR detail view:

- repository and source checkout labels;
- immutable revision number and source HEAD;
- destination authority and observed SHA;
- merge-attempt state;
- requested checkout sync state and last safe error;
- retry actions when the user can resolve the condition.

Metrics should include operation latency, transferred bundle bytes, conflict rate, non-fast-forward
rejection, recovery outcomes, and sync-state counts.

## Definition of done

The replacement is complete when:

- every CR is keyed by `repositoryId` and explicit checkout IDs;
- a CR can be captured from any registered host/container checkout or worktree;
- origin-backed and Hub-backed destination branches both use compare-and-swap updates;
- origin merges use ordinary fast-forward pushes and no force-capable option;
- every merge retains its before and after SHAs and can produce a reviewable revert CR;
- merged commits survive deletion of every participating checkout;
- requested host/container destinations safely synchronize or report an actionable state;
- no operation silently overwrites dirty, switched, or diverged checkout state;
- review conclusions and merge actions remain pinned to an immutable revision and destination;
- repository lists, live events, and agent-message cards are repository-ID scoped;
- agents discover checkout IDs, never invent paths, and link created requests in chat;
- interruption recovery is proven before and after every external mutation boundary;
- the v1 database and Git storage are wiped without a compatibility path;
- all legacy CR implementation code is removed.

## Non-goals

- preserving existing CRs, CR numbers, mirrors, or subscriptions;
- merging between unrelated repositories;
- capturing uncommitted source changes;
- silently creating or publishing remote branches;
- automatically cleaning, stashing, switching, resetting, rebasing, or force-updating a checkout;
- copying credentials between runtimes;
- making destination checkout availability part of repository-level merge success;
- optimizing bundle transfer before correctness and recovery are complete.
