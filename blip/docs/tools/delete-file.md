# delete_file

`delete_file` deletes one file inside the workspace.

## Availability

Profile:

- `no-shell-workspace-write`

The trusted local profile uses `bash` or `apply_patch` deletion instead of exposing this tool.

## Parameters

```ts
{
  path: string;
  baseHash?: string;
}
```

## Behavior

- Rejects paths outside the workspace.
- Rejects directories.
- Reads the file before deletion.
- `baseHash` checks the current file hash before deletion when provided.
- Records the path as modified in session metadata.
- Returns deleted file size and hash.

## Current Gaps

- No trash/recovery behavior.
- No approval prompt for deletion.
