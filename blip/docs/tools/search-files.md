# search_files

`search_files` searches workspace files by name or content.

## Availability

Profiles:

- `local-trusted-write`
- `read-only`
- `no-shell-workspace-write`

## Parameters

```ts
{
  query: string;
  mode: "name" | "content";
  path?: string;
  includeGlob?: string;
  excludeGlob?: string;
  limit?: number;
}
```

- `path` is workspace-relative and defaults to the workspace root.
- `limit` defaults to 100 and is capped at 500.

## Behavior

Name mode:

- Walks workspace files under `path`.
- Skips common large directories such as `.git`, `node_modules`, `dist`, `build`, and `.turbo`.
- Matches paths containing `query`.

Content mode:

- Uses `rg` when available.
- Falls back to a TypeScript file walk and substring search.
- Skips likely binary files in fallback mode.
- Records matched files as read in session metadata.

## Current Gaps

- Glob support is simple and not a full minimatch implementation.
- Content fallback is substring search, not regex search.
- Name and content search are combined in one tool.
