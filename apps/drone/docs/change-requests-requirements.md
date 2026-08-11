# DroneHub Change Requests

## Goal

DroneHub should have its own change requests. They should feel similar to pull requests, but live inside DroneHub and do not require GitHub.

A chat can commit some work, open a change request, and either wait for the user to merge it or merge it itself when it has permission. GitHub pull requests remain an optional future publishing choice, not a requirement.

## Initial implementation scope

The first version intentionally stays small:

- one current, durable snapshot per change request;
- open, merged, and closed stored states, with stale and conflicted calculated when read;
- an explicit destination branch that defaults to the request's base branch;
- direct squash merge only;
- separate per-chat permissions for creating/managing and merging requests;
- user controls and file/diff review inside DroneHub;
- fixed cleanup behavior with no retention settings;
- no GitHub mirror, bulk actions, approval history, normal merge, or repository/branch-specific policy editor yet.

## Core behavior

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
- Deleting the source drone does not delete an open request in the first version because its snapshot is already independent.
- Missing or damaged snapshots are reported clearly.
- Configurable retention, storage reporting, startup recovery cleanup, and manual storage cleanup are future improvements.

## Future: optional GitHub pull-request mirror

A later version may mirror a native change request to GitHub while keeping the DroneHub request as the primary record.

Possible user-facing actions include:

- Open as pull request
- Open and merge as pull request
- Merge an existing linked pull request
- Close the linked pull request
- Manually update an out-of-date linked pull request

The mirror should update automatically by default when the native request changes, with an option to disable automatic updates and show an out-of-date state. Only remote mirror branches proven to have been created and owned by DroneHub may be deleted. DroneHub must never delete `main`, `dev`, a destination branch, or another user-created branch.

GitHub mirror actions are user-only initially when this future work is added. Agent permissions for publishing, updating, closing, and merging GitHub PRs must remain separate from native change-request permissions.

## Future: bulk actions

Bulk GitHub publishing or merging is not part of the first version. If added later, it should provide per-request results, avoid duplicates, skip requests already in the requested state, and process requests targeting the same branch in a stable order while rechecking the destination between merges.
