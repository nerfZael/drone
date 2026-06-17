# list_files

`list_files` lists direct children of a workspace directory.

## Availability

Profiles:

- `local-trusted-write`
- `read-only`
- `no-shell-workspace-write`

## Parameters

```ts
{
  path?: string;
  includeHidden?: boolean;
  limit?: number;
}
```

- `path` is workspace-relative and defaults to the workspace root.
- `limit` defaults to 200 and is capped at 500.

## Behavior

- Rejects paths outside the workspace.
- Requires `path` to be a directory.
- Sorts directories before files.
- Omits dotfiles unless `includeHidden` is true.
- Returns path, type, size, modified time, and truncation metadata.

## Current Gaps

- Does not recurse.
- Does not apply gitignore rules.
- Does not include permissions/owner metadata.
