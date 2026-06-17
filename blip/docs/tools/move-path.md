# move_path

`move_path` moves or renames a file or directory inside the workspace.

## Availability

Profile:

- `no-shell-workspace-write`

The trusted local profile uses `bash` or `apply_patch` moves instead of exposing this tool.

## Parameters

```ts
{
  from: string;
  to: string;
  overwrite?: boolean;
}
```

## Behavior

- Rejects paths outside the workspace.
- Requires the source path to exist.
- Fails if the destination exists unless `overwrite` is true.
- If `overwrite` is true, removes the destination before moving.
- Records both source and destination as modified in session metadata.

## Current Gaps

- No cross-workspace moves.
- No approval prompt for overwrite.
- No special git rename detection beyond whatever git commands report after the move.
