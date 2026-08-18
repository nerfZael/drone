# DroneHub Change Requests

## Goal

DroneHub should have its own change requests. They should feel similar to pull requests, but live inside DroneHub and do not require GitHub.

A chat can commit some work, open a change request, and either wait for the user to merge it or merge it itself when it has permission. A user may optionally mirror an individual request to GitHub, but GitHub remains a publishing choice rather than a requirement.

## Current implementation scope

The native model intentionally stays focused:

- immutable, durable revisions with one current revision per change request;
- optional source-commit history within each captured revision;
- open, merged, and closed stored states, with stale and conflicted calculated when read;
- an explicit destination branch that defaults to the request's base branch;
- direct squash merge only;
- separate per-chat permissions for creating/closing and merging requests, with updates available to every agent;
- user controls and file/diff review inside DroneHub;
- public, read-only agent review of metadata, revisions, changed files, and diffs;
- isolated container review worktrees for inspecting, executing, and optionally fixing an exact prepared merge candidate;
- retained review history with no retention settings yet;
- optional user-only GitHub mirroring for one request at a time;
- provider-neutral publication persistence with GitHub as the current adapter;
- no approvals, checks, merge queues, bulk actions, agent publication access, normal native merge, or repository/branch-specific policy editor.

## Core behavior

- Change requests receive a Hub-wide auto-incrementing number starting at 1. This number is their
  only public identifier in the UI, HTTP API, and MCP tools; opaque storage keys remain internal.
- A change request records the chat and drone that created it.
- It contains a fixed snapshot of committed changes. Later work in the chat does not silently change an existing request.
- Refreshing a request deliberately creates a new immutable revision and advances the current revision number.
- It records the repository, source and base commits, destination, title, description, status, creator, merger, final merge commit, errors, and relevant timestamps.
- Stored states are open, merged, and closed. Opening a request fetches its remote before stale and conflicted are assessed against the destination.
- Revisions are stored in Hub-managed Git object storage, so open and completed requests remain reviewable if their source checkout moves or is deleted.
- DroneHub provides file, diff, revision, and source-commit review for every retained revision.

## Creating and updating a change request

- A chat can create a request through the DroneHub MCP server.
- Creation and management are enabled by default for managed chats and can be disabled on that chat's existing DroneHub permissions page.
- The user can also create, update, refresh, retarget, and close a request in the Requests panel.
- The source working tree must be clean. The chat or user commits the work before capturing it.
- Creating or updating a request does not give the container host Git or GitHub credentials.
- Every refresh captures against a freshly resolved base and retains earlier revisions for historical review.
- A reviewer can publish committed fixes from its isolated review workspace as a new immutable revision. This does not modify the original source checkout or grant merge authority.

## Permissions and merge policy

Creating/closing and merging are separate per-chat permissions. Updating an open request is available to every agent:

- **Create and close change requests:** enabled by default for requests owned by that chat.
- **Update change requests:** every agent may edit metadata, retarget, or explicitly refresh any open request. Updating does not grant close or merge authority.
- **Merge change requests:** disabled by default. When enabled, the chat may merge one of its own requests when explicitly instructed.
- **Review change requests:** available to every agent without CR management or merge permission. The review tools themselves do not mutate or merge a request.
- The user can always use the DroneHub UI actions.
- Host credentials are used inside DroneHub and are never handed to the chat or container.
- Approvals, checks, and background “merge automatically when checks pass” behavior are not included.
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
- The push uses an exact force-with-lease for the destination SHA observed while preparing the merge.
- DroneHub records the prepared merge before pushing and reconciles interrupted attempts on startup, including the case where the push succeeded before request metadata was committed.
- The final commit and push use the configured host Git identity and credentials, not the container identity.
- The request records the DroneHub actor that requested the merge and the final commit SHA.
- The user can supply a final commit message. Otherwise the request title is used.
- Normal merge and rebase can be considered later if squash proves insufficient.

## MCP tools

Public review tools are:

- `get_change_request`
- `list_change_request_revisions`
- `get_change_request_changes`
- `get_change_request_diff`
- `prepare_change_request_review`

`prepare_change_request_review` freshly resolves the destination, prepares the same squash result used by native merge, and materializes it as an isolated hidden worktree in the reviewing chat's container. The agent can inspect complete files and run repository-specific builds, tests, or programs there. The returned revision, destination branch, destination SHA, and candidate tree SHA identify exactly what was reviewed. Review is conversational: DroneHub does not store an approval or automatically gate merging on the result.

If review finds a problem, the agent edits the returned path and commits every change there. It then calls `update_change_request_from_review` with the returned `workspaceId`. DroneHub accepts only a clean workspace whose HEAD descends from the exact prepared candidate and whose CR revision and destination branch are still current. The result is a new immutable CR revision containing the complete corrected tree. The agent must prepare and test that new revision before declaring it safe to merge. `refreshSnapshot: true` is not used for this workflow because it recaptures the original CR source checkout instead.

Mutation tools are:

- `create_change_request`
- `update_change_request`
- `update_change_request_from_review`
- `close_change_request`
- `merge_change_request`

Any agent can update an open request, including publishing committed fixes from its own prepared review workspace. A managed chat can only close or merge a request belonging to that same chat and drone, and merge remains separately permission-gated. For MCP callers, snapshot refresh is explicit: omitting `refreshSnapshot` edits metadata only, while `refreshSnapshot: true` recaptures the request's configured source checkout.

When a reviewed agent is later instructed and permitted to merge, it passes the reviewed revision, destination branch, destination SHA, and candidate tree SHA to `merge_change_request`. DroneHub rejects the merge if the request was retargeted, the destination moved, the revision changed, or the recomputed squash tree differs from the inspected code. The four review pins are accepted together or omitted together; user-driven and deliberately unreviewed merges omit them.

## Cleanup and disk usage

- Temporary bundles, import refs, and host-side preparation/merge worktrees are removed after each operation.
- Each request retains its source and review refs in isolated Hub-managed bare Git storage; no permanent host worktree is kept.
- Container review worktrees are keyed by request revision, destination branch, snapshot SHA, destination SHA, and candidate SHA and are reused for the same candidate. Automatic review-workspace garbage collection is not included yet.
- Closing or merging keeps immutable revisions reviewable. Temporary bundles, import refs, and host worktrees are still removed immediately.
- DroneHub deletes a remote mirror branch after its linked pull request is closed or merged only when the stored mirror record proves that DroneHub created and owns that branch.
- Deleting the source drone does not delete an open request in the first version because its snapshot is already independent.
- Missing or damaged snapshots are reported clearly.
- Configurable retention, storage reporting, and manual storage cleanup are future improvements.

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

Opening and immediately merging a pull request, or merging an existing linked pull request, uses the merge method selected by the user. A successful GitHub merge marks the native request merged, records the GitHub merge commit, retains native revision history, and cleans up the owned mirror branch. Closing a linked pull request leaves the native request open so it can still be updated or directly merged.

If a native request is closed or directly merged while its GitHub mirror is open, DroneHub closes the linked pull request and cleans up its owned mirror branch on a best-effort basis. Any failure remains visible on the mirror record so the user can retry cleanup.

## Future: bulk actions

Bulk GitHub publishing or merging is not included. If added later, it should provide per-request results, avoid duplicates, skip requests already in the requested state, and process requests targeting the same branch in a stable order while rechecking the destination between merges.
