# `create_directory`

## Purpose

`create_directory` creates a directory inside the active workspace.

It gives Blip v1 explicit directory support for cases where structured, path-safe behavior is better than using bash.

## Tool Profile

`create_directory` is a v1 capability, but it should not be in the default local bash profile. In local trusted CLI runs, use bash for direct directory commands and `apply_patch` parent creation when adding files.

Expose `create_directory` in no-shell workspace-write profiles and UIs that need structured directory metadata.

## Schema

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Workspace-relative directory path."
    },
    "recursive": {
      "type": "boolean",
      "description": "Whether to create missing parent directories."
    }
  },
  "required": ["path"],
  "additionalProperties": false
}
```

## Behavior

- Resolve `path` inside the workspace root.
- Reject paths outside the workspace.
- Create the directory.
- If `recursive` is true, create missing parents.
- If the directory already exists, return a clear already-exists result.
- Fail if the path exists as a file.

## Detailed Comparison

### Pi

Pi's `write` tool automatically creates parent directories. For standalone directory creation, Pi can rely on shell workflows or custom filesystem utilities.

Inferred rationale: explicit directory creation is less important when `write` creates parents and bash is available for `mkdir`.

Pros:

- Fewer tools.
- File creation handles the common parent-directory case.
- Shell covers advanced directory workflows.

Cons:

- Requires shell for creating an empty directory.
- Directory intent is hidden when it happens as part of `write`.
- Harder to permission separately.

### OpenCode

OpenCode's write and patch paths can create needed directories as part of file mutation. Shell/file workflows can also create directories, with permissions and external-directory checks handled by the runtime.

Inferred rationale: directory creation is usually a support operation for file writes, so it can live inside higher-level mutation flows.

Pros:

- Convenient for file creation.
- Integrated with runtime permission checks.
- Avoids a separate tool for many cases.

Cons:

- Less explicit when the desired result is an empty directory.
- More runtime machinery than Blip v1 needs.

### Codex

Codex commonly uses shell for `mkdir`-style operations when permitted. Its patch behavior can also create parents for added files, which covers many code-editing scenarios.

Inferred rationale: shell plus patch parent creation is flexible enough when sandbox and approval controls exist.

Pros:

- Familiar developer workflow.
- No need for a dedicated directory tool.
- Patch add-file parent creation handles common scaffolding.

Cons:

- Shell is required for empty directories.
- Shell safety is a larger v1 problem.

## Blip Choice

Blip adds `create_directory` even though v1 includes local CLI bash.

Why this differs:

- Empty directory creation should still be possible when bash is unavailable.
- Directory creation should be visible and permissionable.
- `apply_patch` parent creation covers added files, but not empty directories.

Pros:

- Simple schema.
- Clear user/model intent.
- Safe workspace-root validation.
- Complements `write_file` and `apply_patch`.

Cons:

- Adds a tool for an operation often handled by shell.
- Recursive creation needs careful path validation.
- May be used less often than file creation.
