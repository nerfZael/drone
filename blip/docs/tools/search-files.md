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

- `path` is workspace-relative and defaults to the workspace root. It can point to a directory or a single file.
- `limit` defaults to 100 and is capped at 500.

## Behavior

Name mode:

- Walks workspace files under `path` when `path` is a directory.
- If `path` is a file, matches that single workspace-relative path.
- Skips common large directories such as `.git`, `node_modules`, `dist`, `build`, and `.turbo`.
- Matches paths containing `query` with smart-case behavior.

Content mode:

- Uses `rg --smart-case` when available for directory searches.
- If `path` is a file, searches only that file.
- Falls back to a TypeScript file walk with smart-case regex matching. If `query` is not a valid regular expression, fallback uses smart-case substring matching.
- Skips likely binary files in fallback mode.
- Records matched files as read in session metadata.
- Includes search diagnostics such as `engine` and `smartCase` in tool result details.

## Current Gaps

- Glob support is simple and not a full minimatch implementation.
- Name and content search are combined in one tool.
