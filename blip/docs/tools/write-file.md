# write_file

`write_file` creates or overwrites a complete file inside the workspace.

## Availability

Profile:

- `no-shell-workspace-write`

The trusted local profile uses `bash` and `apply_patch` instead of exposing this tool.

## Parameters

```ts
{
  path: string;
  content: string;
  mode: "create" | "overwrite";
  baseHash?: string;
}
```

## Behavior

- Rejects paths outside the workspace.
- `create` fails if the file already exists.
- `overwrite` fails if the file does not exist.
- `baseHash` checks the current file hash before writing when provided.
- Parent directories are created for `create`.
- Records the file as modified in session metadata.

## Current Gaps

- No formatter or diagnostics integration.
- No partial edit mode; use `apply_patch` for targeted edits.
- No approval prompt for overwrites.
