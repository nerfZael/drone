# delete_directory

`delete_directory` deletes a directory inside the workspace.

## Availability

Profile:

- `no-shell-workspace-write`

The trusted local profile uses `bash` for direct directory cleanup.

## Parameters

```ts
{
  path: string;
  recursive?: boolean;
}
```

## Behavior

- Rejects paths outside the workspace.
- Requires `path` to be a directory.
- Deletes empty directories with `recursive` omitted or false.
- Deletes non-empty directories only when `recursive` is true.
- Records the path as modified in session metadata.

## Current Gaps

- No approval prompt for recursive deletion.
- No trash/recovery behavior.
- No protected-path list beyond workspace boundary checks.
