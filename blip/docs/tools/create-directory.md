# create_directory

`create_directory` creates a directory inside the workspace.

## Availability

Profile:

- `no-shell-workspace-write`

The trusted local profile uses `bash` for direct directory operations.

## Parameters

```ts
{
  path: string;
  recursive?: boolean;
}
```

## Behavior

- Rejects paths outside the workspace.
- Creates the directory.
- Creates missing parents only when `recursive` is true.
- Records the path as modified in session metadata.

## Current Gaps

- No mode/permissions parameter.
- No special handling for existing directories beyond Node filesystem behavior.
