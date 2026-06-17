# `delete_file`

## Purpose

`delete_file` deletes one file inside the active workspace.

It exists because single-file deletion should be structured, path-safe, and easy to report even though local CLI bash is available.

## Tool Profile

`delete_file` is a v1 capability, but it should not be in the default local bash profile. In local trusted CLI runs, use `apply_patch` `Delete File` when deletion belongs with an edit batch, or bash for simple cleanup.

Expose `delete_file` in no-shell workspace-write profiles and UIs that need structured deletion metadata.

## Schema

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Workspace-relative file path."
    },
    "baseHash": {
      "type": "string",
      "description": "Optional hash of the file content for stale-delete protection."
    }
  },
  "required": ["path"],
  "additionalProperties": false
}
```

## Behavior

- Resolve `path` inside the workspace root.
- Reject paths outside the workspace.
- Fail if the path is a directory.
- Fail if the file does not exist.
- If `baseHash` is provided, fail when the current file content does not match.
- Return the deleted path and previous file metadata.

## Detailed Comparison

### Pi

Pi's visible core file tools focus on list, find, grep, read, write, edit, and bash. File deletion can be handled through shell workflows or any higher-level file utility built around the same filesystem abstractions.

Inferred rationale: Pi keeps the dedicated tool set small and relies on bash for less common filesystem mutations.

Pros:

- Smaller model-facing tool list.
- Deletion can use familiar shell semantics.
- No separate delete schema to maintain.

Cons:

- Requires shell access.
- `rm`-style operations are riskier and harder to constrain.
- Harder to make deletion approval-granular without wrapping shell.

### OpenCode

OpenCode supports deletion through patch operations and broader file/shell workflows. Its `apply_patch` implementation models `delete` as a first-class patch hunk and can ask for edit permission with diff metadata before applying the change.

Inferred rationale: deletions are safest when represented as file changes with permission metadata and diff review.

Pros:

- Deletions can be reviewed with the rest of a patch.
- Permission metadata can show affected files.
- Runtime events can notify the UI after deletion.

Cons:

- One-off deletion through patch syntax can be verbose.
- Direct delete behavior is less obvious if the user only thinks in file operations.

### Codex

Codex supports file deletion through apply-patch delete operations and through shell when permitted. Safety checks can reject, ask for approval, or auto-approve depending on sandbox and permission policy.

Inferred rationale: deletion is a consequential mutation, so it should flow through a safety-aware mutation path.

Pros:

- Strong approval/sandbox story.
- Patch deletion is auditable.
- Shell remains available when appropriate.

Cons:

- Shell deletion requires mature safety controls.
- Patch deletion is heavier for one file.

## Blip Choice

Blip should support both `delete_file` and `Delete File` in `apply_patch`.

Why this differs:

- Single-file deletion should be possible when bash is unavailable.
- A single-file cleanup in no-shell contexts should not require writing a patch envelope.
- Multi-file edit batches should still use `apply_patch`.

Pros:

- Clear direct operation for one file.
- Workspace-root validation is straightforward.
- `baseHash` can protect against stale deletion.
- Patch deletion remains available for larger edits.

Cons:

- Adds another mutation tool.
- Needs careful confirmation/permission behavior in future hosted contexts.
- Recursive or directory deletion must stay separate.
