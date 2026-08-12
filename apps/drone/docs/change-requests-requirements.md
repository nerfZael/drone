# DroneHub Change Requests

## Goal

DroneHub should have its own change requests. They should feel similar to pull requests, but live inside DroneHub and do not require GitHub.

A chat can commit some work, open a change request, and either wait for the user to merge it or merge it itself when it has permission. A user may optionally mirror an individual request to GitHub, but GitHub remains a publishing choice rather than a requirement.

## Initial implementation scope

The first version intentionally stays small:

- one current, durable snapshot per change request;
- open, merged, and closed stored states, with stale and conflicted calculated when read;
- an explicit destination branch that defaults to the request's base branch;
- direct squash merge only;
- separate per-chat permissions for creating/managing and merging requests;
- user controls and file/diff review inside DroneHub;
- fixed cleanup behavior with no retention settings;
- optional user-only GitHub mirroring for one request at a time;
- no bulk actions, agent mirror access, approval history, normal native merge, or repository/branch-specific policy editor.

## Core behavior

- Change requests receive a Hub-wide auto-incrementing number starting at 1. This number is their
  only public identifier in the UI, HTTP API, and MCP tools; opaque storage keys remain internal.
- A change request records the chat and drone that created it.
- It contains a fixed snapshot of committed changes. Later work in the chat does not silently change an existing request.
- Refreshing a request deliberately replaces its snapshot and increases its revision number.
- It records the repository, source and base commits, destination, title, description, status, creator, merger, final merge commit, errors, and relevant timestamps.
- Stored states are open, merged, and closed. Opening a request fetches its remote before stale and conflicted are assessed against the destination.
- The snapshot is stored outside the source container, so an open request remains reviewable if that container is deleted.
- DroneHub provides file and diff review for the captured snapshot.

## Creating and updating a change request

- A chat can create a request through the DroneHub MCP server.
- Creation and management are enabled by default for managed chats and can be disabled on that chat's existing DroneHub permissions page.
- The user can also create, update, refresh, retarget, and close a request in the Requests panel.
- The source working tree must be clean. The chat or user commits the work before capturing it.
- Creating or updating a request does not give the container host Git or GitHub credentials.
- A refresh keeps only the newest snapshot. Earlier snapshots are not retained as revision history in the first version.

## Permissions and merge policy

Creating/managing and merging are separate per-chat permissions:

- **Create and update change requests:** enabled by default. This also permits refreshing, retargeting, and closing requests owned by that chat.
- **Merge change requests:** disabled by default. When enabled, the chat may merge one of its own requests when explicitly instructed.
- The user can always use the DroneHub UI actions.
- Host credentials are used inside DroneHub and are never handed to the chat or container.
- Background “merge automatically when checks pass” behavior is not included.
- Repository-specific and destination-branch-specific permission rules can be added later if needed.
- GitHub mirror actions are not MCP tools and have no agent permissions. They are user-only UI actions.

## Destinations and branches

- The chat or user can explicitly choose the destination branch.
- If no destination is supplied, DroneHub uses the request's base branch.
- DroneHub does not invent or suggest destination branch names.
- The user can retarget the request in the UI, and the chat can retarget its own request through MCP.
- Retargeting recalculates the stale/conflict assessment.
- The destination can be an existing branch such as `dev`, `main`, or a release branch.
- The destination can also be a named branch that does not exist yet.
- A nonexistent destination is treated as a planned branch. It is created only during merge, from the latest available head of the request's base branch.
- DroneHub does not silently fall back to an unrelated branch if the base branch is unavailable.
- Several requests can target an aggregate branch so selected work can be collected there.
- A separate “starting branch” option is not included initially because it would introduce a second base concept. A user can create that branch first and retarget the request to it.

## Direct merge inside DroneHub

“Direct merge” describes where the merge happens: DroneHub merges straight to the destination branch without going through a GitHub pull request. “Squash” describes how the commits are combined.

- The first version supports direct squash merge only.
- Immediately before merging, DroneHub fetches the remote and recalculates the result against the latest destination.
- The merge is prepared in an isolated temporary worktree, so the normal host working tree is not changed.
- A concurrent remote update is allowed to make the push fail instead of being overwritten.
- The final commit and push use the configured host Git identity and credentials, not the container identity.
- The request records the DroneHub actor that requested the merge and the final commit SHA.
- The user can supply a final commit message. Otherwise the request title is used.
- Normal merge and rebase can be considered later if squash proves insufficient.

## MCP tools

The initial focused tools are:

- `create_change_request`
- `update_change_request`
- `close_change_request`
- `merge_change_request`

A managed chat can only update, close, or merge a request belonging to that same chat and drone. Change-request permissions are checked separately from ordinary read/write/execute drone scope.

## Cleanup and disk usage

- Temporary bundles, import refs, and merge worktrees are removed after each operation.
- An open request retains one Git snapshot ref, not another repository or permanent worktree.
- Closing or merging immediately removes the stored snapshot ref while keeping the small metadata record.
- DroneHub deletes a remote mirror branch after its linked pull request is closed or merged only when the stored mirror record proves that DroneHub created and owns that branch.
- Deleting the source drone does not delete an open request in the first version because its snapshot is already independent.
- Missing or damaged snapshots are reported clearly.
- Configurable retention, storage reporting, startup recovery cleanup, and manual storage cleanup are future improvements.

## Optional GitHub pull-request mirror

A user can mirror a native change request to GitHub while keeping the DroneHub request as the primary record. Mirror actions are available only in the request UI; they are not exposed through MCP and are not available to agents.

User-facing actions include:

- Open as pull request
- Open and merge as pull request
- Merge an existing linked pull request
- Close the linked pull request
- Manually update an out-of-date linked pull request

The mirror updates automatically by default when the native request changes. The user can disable automatic updates, see when the mirror is out of date, and update it manually. Updates use a force-with-lease against the last known mirror head, so an unexpected external branch change is not overwritten.

DroneHub generates and records a unique mirror head branch. Only a branch proven by that record to have been created and owned by DroneHub, and whose remote head still matches DroneHub's last known head, may be deleted. DroneHub never deletes `main`, `dev`, a destination branch, an externally changed mirror branch, or another user-created branch. If the selected destination does not exist, it is created from the latest remote head of the request's base branch and is not treated as a disposable mirror branch.

Opening and immediately merging a pull request, or merging an existing linked pull request, uses the merge method selected by the user. A successful GitHub merge marks the native request merged, records the GitHub merge commit, and cleans up the native snapshot and owned mirror branch. Closing a linked pull request leaves the native request open so it can still be updated or directly merged.

If a native request is closed or directly merged while its GitHub mirror is open, DroneHub closes the linked pull request and cleans up its owned mirror branch on a best-effort basis. Any failure remains visible on the mirror record so the user can retry cleanup.

## Future: bulk actions

Bulk GitHub publishing or merging is not included. If added later, it should provide per-request results, avoid duplicates, skip requests already in the requested state, and process requests targeting the same branch in a stable order while rechecking the destination between merges.
