# `delete_directory`

## Purpose

`delete_directory` deletes a directory inside the active workspace.

It is intentionally stricter than shell deletion.

## Tool Profile

`delete_directory` is a v1 capability, but it should not be in the default local bash profile. In local trusted CLI runs, use bash for direct directory cleanup.

Expose `delete_directory` in no-shell workspace-write profiles and UIs that need structured deletion metadata. Recursive deletion should stay explicit.

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
      "description": "Whether to delete a non-empty directory."
    }
  },
  "required": ["path"],
  "additionalProperties": false
}
```

## Behavior

- Resolve `path` inside the workspace root.
- Reject paths outside the workspace.
- Fail if the path is a file.
- Delete empty directories by default.
- Require `recursive: true` for non-empty directories.
- In hosted or assistant-driven contexts, recursive deletion should require stronger permission than normal edits.
- Return the deleted path and whether deletion was recursive.

## Detailed Comparison

### Pi

Pi can rely on shell workflows for directory deletion when shell is enabled. It does not need a separate model-facing directory deletion tool in the simple core tool set.

Inferred rationale: recursive deletion is a powerful operation and is naturally expressed through shell when the user has accepted shell risk.

Pros:

- Smaller tool list.
- Familiar command-line semantics.
- No custom recursive deletion behavior to maintain.

Cons:

- Depends on shell.
- Recursive deletion through shell is high risk.
- Harder to provide structured previews or approval metadata.

### OpenCode

OpenCode can handle destructive filesystem operations through its broader runtime and permission model. Patch deletion is file-oriented; directory deletion is more naturally handled by shell or filesystem services.

Inferred rationale: dangerous operations should run through a permission-aware runtime rather than simple unconstrained file APIs.

Pros:

- Permission model can gate destructive behavior.
- Runtime can integrate UI events and metadata.

Cons:

- Directory-specific behavior is not as clear as a dedicated tool.
- More infrastructure is required before exposing recursive deletion safely.

### Codex

Codex can use shell deletion with sandboxing and approvals. Its safety model is designed to decide whether a command should run, ask, or be rejected.

Inferred rationale: the sandbox/approval layer is the main control point for destructive operations.

Pros:

- Flexible and familiar.
- Strong safety model when configured correctly.

Cons:

- Recursive shell deletion is not suitable without sandbox maturity.
- Recursive deletion deserves explicit intent.

## Blip Choice

Blip adds `delete_directory`, but defaults it to empty-directory deletion.

Why this differs:

- Directory deletion should be possible when bash is unavailable.
- Directory deletion is different from file deletion and should not be hidden behind `delete_file`.
- Recursive deletion should be explicit and later permission-gated more strongly in hosted contexts.

Pros:

- Clear safety boundary.
- Non-recursive default avoids accidental large deletes.
- Easier to test than shell behavior.

Cons:

- Adds a specialized destructive tool.
- Recursive behavior still needs careful UX and permissions.
- Users familiar with shell may find it slower than `rm -rf`.
