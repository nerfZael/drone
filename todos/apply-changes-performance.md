# Apply Changes: Current Process and Performance Opportunities

## Summary

The current apply-to-host flow is safe and Git-native, but it does considerably more work than necessary, especially for large repositories.

The two largest structural costs are:

1. Every changed apply creates and copies a full-history Git bundle.
2. Drone Hub checks merge safety by creating a disposable worktree and performing the merge there before performing it again in the real host repository.

## End-to-end process

```text
Browser
  → Drone Hub HTTP API
  → Docker exec inside the container
  → Git bundle written inside the container
  → docker cp bundle to host
  → import bundle into temporary host ref
  → create host-authored mirror commit
  → test merge in disposable worktree
  → repeat merge in real host worktree
  → return response and clean temporary artifacts
```

### 1. Submit the request

The UI starts the durable progress toast and sends:

```http
POST /api/drones/:id/repo/pull
```

The main UI path starts in:

```text
apps/drone-hub/src/droneHub/app/use-workspace-actions.ts
```

There is a similar path for multi-chat columns.

### 2. Resolve the drone and repository

The Hub resolves the drone and its attached repository.

Host-runtime drones are a no-op because they already work directly in the host repository. Container drones continue through the repository transfer process.

The backend route starts in:

```text
apps/drone/src/hub/repository-operation-route-service.ts
```

### 3. Verify that the host repository is clean

The host repository must be completely clean before apply begins.

This protects the user's local edits and prevents the apply operation from mixing unrelated host changes into the pending merge.

### 4. Reconcile the previous apply

If a previous apply left a pending mirror candidate, Drone Hub reconciles it:

- If the user committed the previous pending host merge, the mirror is promoted to the applied baseline.
- If the user aborted the merge, the candidate mirror is discarded.
- The container's `dvm.baseSha` is advanced only after the host result has actually been committed.

### 5. Check the container working tree

The Hub runs:

```bash
git status --porcelain
```

inside the container.

If the drone has uncommitted edits, the API returns `drone_dirty`, and the UI asks whether to:

- Commit everything before applying.
- Keep the dirty edits in the drone and apply only committed changes.

Auto-commit performs:

```bash
git add -A
git commit
git rev-parse HEAD
```

If dirty changes are kept, they remain only in the container and are not included in the host apply.

### 6. Determine whether there is anything to apply

The Hub reads:

- The container repository's current `HEAD`.
- The configured `dvm.baseSha`, representing the last applied baseline.

If the two SHAs match, Drone Hub returns a no-changes response without transferring repository data.

### 7. Create a full Git bundle inside the container

If the SHAs differ, Drone Hub runs:

```bash
git bundle create /tmp/.../changes.bundle HEAD
```

This creates a full-history bundle containing every Git object reachable from `HEAD`, rather than only the commits since `dvm.baseSha`.

The helper currently lives in:

```text
apps/drone/src/hub/server.ts
```

### 8. Copy the bundle to the host

The bundle is copied from the container to a temporary host path using `docker cp`.

The heavy payload therefore travels through:

```text
container filesystem → Docker daemon → docker cp → host temporary file
```

### 9. Import the bundle

On the host, Drone Hub:

1. Reads the refs advertised by the bundle.
2. Fetches the bundle into a temporary host Git ref.
3. Resolves the imported tree.

### 10. Create a host-authored mirror commit

Drone Hub creates a new host-authored commit whose tree exactly matches the committed tree from the drone.

The mirror commit uses the previous applied mirror or drone base as its parent. This means the original drone commit history does not enter the host branch.

### 11. Preview the merge safely

Drone Hub creates a disposable Git worktree and performs a trial merge there.

This detects conflicts without modifying the user's real host working tree.

The implementation lives in:

```text
apps/drone/src/hub/repoOps.ts
```

### 12. Apply to the real host working tree

If the trial merge succeeds, Drone Hub performs the merge again in the real host repository:

```bash
git merge --no-commit --no-ff <mirror-ref>
```

This leaves a pending host merge for the user to review, commit, or abort.

### 13. Clean up

Drone Hub removes temporary:

- Bundle files.
- Import refs.
- Worktrees.
- Worktree branches.
- Unapplied mirror candidates.

An applied mirror candidate remains until a later reconciliation can determine whether the user committed or aborted it.

## How Drone Hub communicates with the container

The apply path does not use SSH or the chat/agent protocol.

For commands, Drone Hub calls DVM, which uses Dockerode over the local Docker daemon socket:

- `runGitInDrone()` becomes a Docker exec running `git -C ...`.
- Dockerode creates an exec session and streams multiplexed stdout and stderr.
- DVM inspects the exec session to obtain the exit code.
- Bundle transfer currently spawns the `docker cp` CLI.

The relevant implementations are:

```text
apps/drone/src/hub/drone-repo.ts
apps/drone/src/host/dvm.ts
apps/dvm/src/docker/client.ts
```

If the UI is on another device, the request still needs to reach the Hub that owns the container. The container interaction itself remains local to that Hub.

## Performance opportunities

### Priority 1: Capture a stable snapshot ref

There is currently a consistency window:

1. The Hub reads the drone's `HEAD`.
2. The short operation lock is released.
3. The Hub later runs `git bundle create ... HEAD`.

Because chat remains available, the agent could create another commit between those steps. The metadata could describe one SHA while the exported bundle contains another.

Before making the operation more parallel, create an immutable temporary ref under a short lock:

```bash
git update-ref refs/drone/exports/<operation-id> HEAD
```

The Hub can then export that stable ref while the user and agent continue chatting.

This improves correctness and provides a safe foundation for the other performance work.

### Priority 2: Export an incremental bundle

The current command is:

```bash
git bundle create changes.bundle HEAD
```

The normal fast path could instead use:

```bash
git bundle create changes.bundle "$baseSha..$snapshotRef"
```

DVM already contains an incremental bundle export implementation, but the apply route currently bypasses it in favor of a full-history helper.

A robust implementation should:

1. Create an incremental bundle against the captured base SHA.
2. Verify that the host has the prerequisite base.
3. Fall back to a full bundle only when the host is missing required history.

For a mature repository with only a few new commits, this could reduce packing and transfer from hundreds of megabytes to kilobytes or a few megabytes.

### Priority 3: Avoid the disposable worktree

Each apply currently:

1. Creates a unique worktree.
2. Checks out the complete host tree.
3. Resets and cleans it.
4. Performs a trial merge.
5. Performs the real merge.
6. Removes the worktree and temporary branch.

For a large monorepo, filesystem materialization can dominate the operation.

On sufficiently recent Git versions, `git merge-tree --write-tree` can perform a virtual three-way merge directly against Git objects.

This would preserve safe conflict detection without checking out every file. The real host worktree would only be touched after the virtual merge succeeds.

A compatibility fallback can retain the existing worktree behavior for older Git versions.

### Priority 4: Reduce Docker round trips

Every Docker command currently resolves the target container by listing all containers first.

A normal changed apply performs several Docker execs plus a copy operation. Dirty auto-commit adds more.

Possible improvements:

- Resolve or cache the Docker container handle once per apply.
- Address exact container names directly and only fall back to container listing for abbreviated IDs.
- Combine status, HEAD, base SHA, and snapshot-ref creation into one exec.
- Use Docker's archive API or a binary-safe exec stream instead of spawning `docker cp`.

This will matter most for smaller repositories where Docker and process startup overhead form a larger percentage of total apply time.

### Priority 5: Add stage timing and byte instrumentation

The current progress toast is indeterminate because the backend does not publish stage progress.

Record at least:

- Container status duration.
- Bundle creation duration.
- Bundle byte size.
- Container-to-host copy duration.
- Bundle import duration.
- Mirror creation duration.
- Conflict-preview duration.
- Real host merge duration.
- Cleanup duration.

This will show which optimization matters most for each repository and can later support meaningful progress labels in the toast.

## Recommended implementation order

1. Add per-stage timing and bundle-size instrumentation.
2. Capture a stable snapshot ref under the short drone operation lock.
3. Use incremental bundles with a safe full-bundle fallback.
4. Replace disposable-worktree conflict preview with a virtual merge where supported.
5. Reduce Docker container lookup, exec, and copy overhead.

The first implementation tranche should be stable snapshot refs, incremental bundles with fallback, and stage timing. It offers the best likely speedup while also making interactive chat during apply race-safe.
