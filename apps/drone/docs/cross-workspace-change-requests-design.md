# Cross-checkout change requests

## Decision

Model every host checkout, container checkout, and linked Git worktree as a **repository checkout**. Creating a native change request explicitly names one source checkout and one existing authoritative destination branch.

DroneHub captures the source as immutable Git objects in a Hub-managed review repository. Merge happens entirely from Git objects. A selected destination checkout may be synchronized afterward, but checkout availability never determines whether the CR itself can merge.

```text
registered source checkout
          |
          | verified Git object transfer
          v
Hub review repository + immutable revision ref
          |
          | merge-tree + commit-tree
          v
authoritative origin branch
          |
          | optional safe fast-forward
          v
registered destination checkout
```

This provides every host/container/worktree combination through one capture path and one merge path. Environments never need direct filesystem access or credentials for one another.

## Requirements

For checkouts belonging to the same registered repository, support:

- one chat worktree to another chat worktree in the same container;
- a container checkout or worktree to a checkout or worktree in another container;
- a host checkout or worktree to a container checkout or worktree, in either direction;
- a host checkout or worktree to another host checkout or worktree;
- several worker chats forked from one published integration branch, each opening a CR back to that branch.

Also require:

- an explicitly selected, committed, clean source checkout;
- immutable CR revisions that survive checkout or container deletion;
- an existing destination branch on the registered repository's configured `origin`;
- stale and conflict handling against the latest destination;
- no host Git credentials inside containers;
- no overwrite of uncommitted or diverged destination work;
- safe concurrent CRs to the same branch;
- recoverable merge behavior across process interruption;
- user review and explicit permission for agent-driven integration.

Each linked worktree must use its own branch. DroneHub-created worker worktrees therefore receive unique branches.

Unrelated repositories are outside this feature. They use a file or patch transfer workflow instead of a CR.

## Core model

### Registered repository and review store

Give each DroneHub repository registration a stable `repositoryId`. DroneHub-created clones and worktrees inherit that identity. Attaching an existing checkout requires an explicit repository selection plus verification of its configured remote, object format, and compatible Git history.

Paths and remote URLs help verification but are not identity: paths differ across environments and remote URLs can change.

Create one Hub-managed bare **review repository** per `repositoryId`. It stores all CR source commits and immutable revisions for that repository under private refs such as:

```text
refs/drone/change-requests/<request-id>/sources/<revision>
refs/drone/change-requests/<request-id>/revisions/<revision>
refs/drone/change-requests/<request-id>/merged
refs/drone/merge-attempts/<attempt-id>
```

These refs remain local to DroneHub and are never pushed to `origin`. A repository-level store lets Git deduplicate shared history and avoids one bare repository and one copy of the base refs per CR. Removing a retained revision deletes its refs; later explicit Git garbage collection under the review-store lock may reclaim unreachable objects.

The configured `origin` remains the authoritative branch store. It may be GitHub, another Git server, or a local bare remote. The first version requires the destination branch to exist. Creating a new destination branch and choosing its start point is a separate future feature.

### Repository checkout

Use one record for both a main checkout and a linked worktree:

```ts
type RepositoryCheckout = {
  id: string;
  repositoryId: string;
  location:
    | { kind: 'host' }
    | { kind: 'container'; droneId: string };
  path: string;
  managedByDroneHub: boolean;
};
```

Branch, `HEAD`, cleanliness, shallow or partial state, and worktree status are inspected live. They are not durable checkout fields because a user can change them outside DroneHub.

DroneHub discovers main checkouts and linked worktrees using Git's worktree metadata and automatically registers valid discoveries. Managed checkouts keep their ID in Hub-owned metadata. For an unmanaged checkout, DroneHub preserves the ID after a move only when the environment and Git worktree metadata still prove it is the same checkout; otherwise it registers a new ID and marks the old checkout unavailable.

The UI and MCP server expose an authorized, read-only checkout catalog. This may be an MCP resource or part of existing repository-status context; it does not require a checkout-switching action tool. Agents pass checkout IDs and never arbitrary host or container paths to CR tools.

A chat may still use its normal Git and worktree operations. Checking out another branch changes the live state of that checkout; creating a worktree produces another discoverable checkout ID. Neither action changes hidden chat-wide CR state. When the chat creates a CR, it names the checkout that contains the intended committed work. It can then create or select another checkout and open another CR from that checkout.

### Change request and revisions

The durable target is repository-based:

```ts
type ChangeRequestTarget = {
  repositoryId: string;
  branch: string;
};
```

Each immutable revision records:

- source checkout ID and a durable provenance label;
- source branch and source `HEAD`;
- destination branch, destination-at-capture SHA, merge-base SHA, and snapshot SHA;
- source commit metadata;
- review-store source and revision refs;
- creator and creation time.

The snapshot commit has the source `HEAD` tree and the true merge base between the source and destination-at-capture as its parent. This represents only the worker's complete proposed tree change; it does not treat newer destination-only changes as deletions. The separate source ref preserves the worker's original commit history.

Optional checkout synchronization is stored separately:

```ts
type ChangeRequestCheckoutSync = {
  checkoutId: string;
  status: 'pending' | 'synced' | 'sync_required' | 'unavailable' | 'diverged';
  lastError: string | null;
};
```

The CR remains merged if synchronization cannot run.

## MCP contract

There is no backward-compatibility requirement for the experimental schema:

```ts
create_change_request({
  title: string;
  description?: string;
  sourceCheckout: string;
  destinationBranch: string;
  destinationCheckout?: string;
});
```

Rules:

- `sourceCheckout` is a real ID from the authorized checkout catalog; there is no omitted or `"current"` form.
- `destinationBranch` must already exist on the registered repository's authoritative `origin`.
- `destinationCheckout` only requests post-merge synchronization. At creation it must be a registered checkout for the same repository. Its availability, branch, cleanliness, and ancestry are checked immediately before synchronization, so a stopped checkout may still be selected.
- The source checkout identifies runtime and path, so the old `drone` and `chat` source selectors are unnecessary.
- The author, chat, and drone remain recorded as provenance and for permission checks.

An existing CR pins its source checkout and source branch. Refresh reads the same checkout and rejects a missing checkout, switched branch, dirty tree, or repository mismatch. Work from another checkout or branch creates a new CR.

Retargeting must name another existing branch in the same repository. It creates a new immutable revision from the already retained source ref, recomputes the merge base and synthetic snapshot for the new destination, and leaves the source checkout untouched. This keeps the proposal's source tree fixed while preventing the old destination's history from leaking into the retargeted diff. Reject retargeting when the retained source and new destination have no common history.

## Capture workflow

1. Resolve `sourceCheckout` from the authorized catalog.
2. Under the checkout mutation lock, inspect repository identity, branch, `HEAD`, status, object format, and shallow or partial state.
3. Require an attached branch, a clean tree, and a committed `HEAD`.
4. Export the source objects under a temporary named ref.
5. Reinspect the source checkout. Reject the capture if branch, `HEAD`, or cleanliness changed during export, delete the temporary source ref, and release the checkout lock.
6. Under the repository review-store mutation lock, fetch the authoritative destination and resolve its current SHA.
7. Verify the bundle, import it into a temporary review-store ref, and prove that the imported `HEAD` is exact and its required objects are present.
8. Require common history, compute the true merge base, and create the synthetic snapshot commit.
9. Reject an empty proposal.
10. Create the immutable source and revision refs together with a `git update-ref --stdin` transaction that verifies neither ref already exists.
11. Persist the revision metadata. If persistence fails, remove the new refs; startup reconciliation removes any orphan refs left by an interrupted compensation.

Checkout and review-store mutation locks are never held together. Fetches, imports, private-ref updates, and garbage collection are serialized per review repository. Explicit garbage collection runs only under that lock, and automatic maintenance is disabled for Hub-owned stores. This prevents concurrent captures or cleanup from racing over shared refs and objects.

### Object transfer

Start with a self-contained full-`HEAD` Git bundle for correctness. Then optimize without changing the model:

1. Choose a prerequisite commit verified to exist in both the source checkout and the review store.
2. Export an incremental bundle containing only objects after that prerequisite.
3. Run bundle verification before import.
4. Fall back to a self-contained bundle when prerequisites are unavailable.

If file-based bundles become a measured bottleneck, the same adapter boundary may later stream a negotiated pack through `git upload-pack`. That is an optimization, not a different CR model.

## Merge workflow

Merge directly inside the bare review repository without a temporary checkout or index. Acquire the destination-branch lock first and the review-store mutation lock second; no workflow acquires those locks in the opposite order.

1. Lock by `repositoryId + destination branch`.
2. Fetch and record the latest authoritative destination SHA using host credentials.
3. Run `git merge-tree --write-tree --name-only -z --messages <destination> <snapshot>`.
4. Treat exit code `0` as a clean merge, `1` as a conflict, and every other exit code as an operational failure. For a conflict, parse the NUL-delimited path records, leave the CR open, and retain the messages for display; do not infer conflicts by inspecting the result tree.
5. Create the squash commit with `git commit-tree <tree> -p <destination>` using the host identity and requested message. Create this auditable commit even when the tree is unchanged so completion still uses the same exact compare-and-swap path.
6. Create a private merge-attempt ref so the prepared commit cannot be garbage-collected.
7. Persist a prepared merge-attempt record containing request, revision, destination, expected destination SHA, prepared commit SHA, and actor.
8. Push the prepared ref with `--force-with-lease=refs/heads/<branch>:<expected-sha>` and an explicit `<prepared-ref>:refs/heads/<branch>` refspec.
9. Create the durable merged ref, mark the CR and merge attempt completed, and only then remove the temporary merge-attempt ref. Recovery performs the same promotion after an interrupted successful push.

The exact lease makes the remote update a compare-and-swap operation. A concurrent destination update fails instead of being overwritten.

An explicit lease rejection is a completed concurrent-update failure. A transport error or interrupted push is inconclusive: keep the attempt and its private ref in `prepared` state until remote inspection proves whether the update happened.

On startup, reconcile every prepared attempt:

- prepared commit equals or is an ancestor of destination: finish CR persistence, because the push succeeded and the branch may have advanced afterward;
- destination still equals expected SHA: mark the unpushed attempt failed and leave the CR open;
- destination has another SHA that does not contain the prepared commit: mark the attempt failed with a concurrent-update or branch-rewrite error;
- remote inspection is inconclusive: retain the prepared attempt for a later retry.

## Optional destination-checkout synchronization

Synchronization is a separate best-effort job after merge:

1. Under the review-store mutation lock, export the merged commit and required objects to a temporary verified bundle, then release the lock.
2. Acquire the destination checkout mutation lock.
3. Confirm that it exists, is available, is clean, and is still on the frozen destination branch.
4. Import the bundle. A container receives the bundle rather than host credentials.
5. Reinspect the checkout after import.
6. Confirm that its observed `HEAD` is an ancestor of the merged SHA.
7. Run a fast-forward-only update inside that checkout, conditioned on the observed `HEAD` still matching.
8. Record `synced`, `sync_required`, `unavailable`, or `diverged` with a clear reason and remove the temporary bundle.

Any failed check leaves the checkout untouched. The user can retry synchronization after cleaning, switching, or restarting it.

## Runtime adapters and security boundary

Only two checkout adapters are needed:

```ts
interface RepositoryCheckoutAdapter {
  discover(repositoryId: string): Promise<RepositoryCheckout[]>;
  inspect(checkout: RepositoryCheckout): Promise<CheckoutGitState>;
  exportRevision(
    checkout: RepositoryCheckout,
    input: { headSha: string; prerequisiteSha?: string },
  ): Promise<ExportedGitBundle>;
  importAndFastForward(
    checkout: RepositoryCheckout,
    input: { branch: string; observedHeadSha: string; mergedSha: string },
  ): Promise<CheckoutSyncResult>;
}
```

- The host adapter runs Git at an approved host path.
- The container adapter runs Git in the selected drone at its registered path.
- A stopped source blocks new capture but never invalidates existing revisions.
- A stopped destination delays only checkout synchronization.
- Review-store Git runs with controlled configuration. Do not copy source repository hooks or arbitrary Git configuration into it, and do not enable unapproved external merge or diff drivers.
- Automated checkout updates disable repository hooks. Any external filter needed to materialize the working tree, including Git LFS, must be explicitly allowed; otherwise synchronization reports `sync_required` without changing the checkout.
- Object IDs are treated as opaque validated Git object IDs rather than assuming SHA-1 length.
- Startup performs capability probes for the required `merge-tree`, transactional `update-ref`, bundle, and object-format behavior. A repository is unavailable for CR operations when its Git runtime lacks a required capability.

## Repository capability rules

### Shallow and partial clones

A captured revision must have a complete object closure for its source tree and required history. If the checkout is shallow or partial, DroneHub may hydrate missing objects through the host's configured remote credentials. If verification still reports missing objects, reject capture with a clear error. Do not persist an incomplete revision.

### Git LFS

Git bundles carry Git pointer blobs but not the separate Git LFS payloads. The first version identifies added or changed LFS pointer OIDs and rejects a CR when any referenced object is not already available from the authoritative LFS server.

A later host-mediated LFS upload path may transfer and publish those objects without giving credentials to containers. Until that exists, never merge a pointer whose content is unavailable.

### Submodules

Submodule changes are reviewed as Gitlink changes. DroneHub does not transfer or modify the submodule repository. The UI identifies these entries clearly; repository policy may additionally require the referenced submodule commit to be available from its configured remote.

## Permissions

Check these capabilities separately:

- discover and read the source checkout;
- capture from the source checkout;
- create, refresh, retarget, or close the CR;
- merge into the repository and destination branch;
- synchronize the optional destination checkout.

The authoring chat manages its own revisions. Add a disabled-by-default integration capability that lets a designated chat merge incoming CRs for allowed repository branches. Selecting a checkout never grants general access to its files or container.

## What already exists

The current implementation already has:

- host and container `HEAD` capture with clean-tree checks;
- bundle capture from containers;
- immutable revisions, source commit metadata, diffs, and file review;
- stale and conflict assessment using `merge-tree`;
- squash merge and exact force-with-lease pushes;
- destination locks;
- prepared merge attempts and startup recovery;
- host-side Git identity and credentials;
- user merge controls and separate chat create/merge permissions.

## What must change

1. Add stable repository IDs to existing repository registrations.
2. Add automatic checkout discovery, registration, and an authorized read-only catalog.
3. Replace per-request bare stores with one review repository per registered repository and private revision refs.
4. Capture from the explicitly selected checkout instead of `drone.repo.dest`.
5. Generalize host/container capture and sync behind the checkout adapters.
6. Replace temporary-worktree merge with `merge-tree` plus `commit-tree`.
7. Add source double-checking, checkout locks, review-store locks, transactional ref writes, and controlled maintenance.
8. Add optional destination-checkout sync records and retry.
9. Add branch-scoped integration permission instead of requiring the merger to own the CR.
10. Add shallow, partial-clone, LFS, submodule, object-format, and controlled-Git rules.
11. Require existing remote destination branches and remove the current planned-branch fallback from direct merge and GitHub mirroring.
12. Make retargeting derive a new revision against the new destination, and extend merge recovery to accept a prepared commit that the destination has advanced beyond.
13. Update UI and MCP responses to show source checkout, authoritative branch, immutable revision, and separate sync status.

The feature is still experimental and has one user, so this change does not need a compatibility adapter, dual-write period, or migration for existing CR records and per-request stores. Development data may be reset when the new schema lands.

## Failure rules

- Unknown or unauthorized checkout: reject before running Git.
- Dirty, detached, changed-during-capture, missing, or stopped source: reject capture; retain earlier revisions.
- Missing destination branch: reject creation or retargeting.
- Source and destination with no common history: reject creation or retargeting.
- Repository or Git object-format mismatch: reject creation, refresh, or retargeting.
- Missing required Git or LFS objects: reject capture.
- Destination changed during merge: fail the exact lease and reassess.
- Merge conflict: leave the CR open and report paths.
- Interrupted push or persistence: reconcile the prepared attempt on startup.
- Dirty, switched, missing, stopped, or diverged sync checkout: keep the CR merged and report the sync state.
- Deleted checkout or drone: retain the CR and all immutable revisions.

## Delivery and verification

1. Repository IDs, checkout discovery, registration, and catalog.
2. Repository-level review stores and full-bundle explicit checkout capture.
3. Worktree-free merge with prepared-attempt recovery.
4. Host and container synchronization adapters.
5. Incremental bundle optimization.
6. Integration-chat permissions and final UX.
7. Host-mediated LFS support only if rejecting new LFS objects proves insufficient.

Unit-test capture, review-store, merge, and synchronization services independently. End-to-end coverage must include:

- the full host/container/main-checkout/worktree matrix;
- automatic discovery of a worktree created after the drone starts;
- two concurrent CRs to one branch;
- source mutation during capture;
- retargeting across branches with shared, diverged, and unrelated history;
- dirty, behind, switched, and diverged destination checkouts;
- stopped containers and deleted checkouts;
- process interruption before and after remote push;
- shallow, partial, LFS, submodule, and non-default object-format cases;
- repository mismatch and permission isolation;
- ref retention, cleanup, garbage collection, and orphan-ref reconciliation;
- concurrent capture, merge, synchronization, and garbage collection in one review store;
- Git capability-probe failures and structured `merge-tree` conflict parsing.

## Non-goals

- capturing uncommitted changes;
- creating destination branches in the first version;
- directly mounting or copying one environment's working directory into another;
- merging between unrelated repositories;
- automatically rebasing, resetting, stashing, or cleaning a destination checkout;
- giving host Git or LFS credentials to a container;
- treating checkout synchronization failure as merge failure;
- adding chat-wide active-checkout state for CR selection;
- using Git alternates as durable revision storage.

## Git patterns used by this design

- [Git worktrees](https://git-scm.com/docs/git-worktree) identify linked checkouts and normally prevent one branch from being checked out in more than one worktree.
- [Git bundles](https://git-scm.com/docs/git-bundle) provide verified full or incremental transfer of refs and objects without a live Git server.
- [Gerrit patch-set refs](https://gerrit-review.googlesource.com/Documentation/intro-user.html) demonstrate durable immutable review revisions in a private Git ref namespace.
- [Git merge-tree](https://git-scm.com/docs/git-merge-tree) performs a real merge and writes the result as a tree without touching a checkout or index.
- [Git commit-tree](https://git-scm.com/docs/git-commit-tree) creates the final single-parent squash commit directly from that tree.
- [Transactional update-ref](https://git-scm.com/docs/git-update-ref) creates related private refs together while checking their expected old values.
- [Exact force-with-lease](https://git-scm.com/docs/git-push#Documentation/git-push.txt---force-with-leaseltrefnamegtltexpectgt) updates the remote only when its branch still has the observed value.
- [Fast-forward-only merge](https://git-scm.com/docs/git-merge#Documentation/git-merge.txt---ff-only) safely advances a follower checkout only when its history has not diverged.
- [Git LFS](https://git-lfs.com/) stores large-file payloads outside the Git object database, requiring a separate availability policy.
