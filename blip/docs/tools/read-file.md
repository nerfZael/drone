# read_file

`read_file` reads a text file inside the workspace with line numbers and bounded ranges.

## Availability

Profiles:

- `local-trusted-write`
- `read-only`
- `no-shell-workspace-write`

## Parameters

```ts
{
  path: string;
  offset?: number;
  limit?: number;
}
```

- `path` is workspace-relative.
- `offset` is a zero-based line offset.
- `limit` defaults to 200 lines and is capped at 1,000.

## Behavior

- Rejects paths outside the workspace.
- Rejects directories.
- Rejects likely binary files.
- Returns numbered lines.
- Includes `sha256`, total line count, returned line count, and truncation metadata.
- Records the file as read in session metadata.

## Current Gaps

- No media/image support.
- No "did you mean" suggestions for missing files.
- No LSP warm-up or symbol metadata.
