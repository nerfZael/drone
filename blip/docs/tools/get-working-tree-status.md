# get_working_tree_status

`get_working_tree_status` returns bounded git working-tree status for the workspace.

## Availability

Profiles:

- `read-only`
- `no-shell-workspace-write`

The trusted local profile uses `bash` for git commands instead of exposing this tool.

## Parameters

```ts
{
  path?: string;
  includeDiffSummary?: boolean;
}
```

## Behavior

- Runs `git status --short --branch`.
- Optionally runs `git diff --stat`.
- `path` is workspace-relative and defaults to the workspace root.
- Returns stdout/stderr details from git.

## Current Gaps

- No porcelain parser; output is mostly git text plus details.
- No staged/unstaged structured breakdown.
- No commit or branch mutation commands.
