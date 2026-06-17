# `write_file`

## Purpose

`write_file` creates a new file or overwrites an existing file inside the active workspace.

It is not Blip's preferred tool for normal code edits. Most edits should use `apply_patch`.

## Tool Profile

`write_file` is a v1 capability, but it should not be in the default local bash profile. In local trusted CLI runs, use `apply_patch` for file creation and normal edits, or bash for one-off generated content.

Expose `write_file` in no-shell workspace-write profiles where the agent needs a structured create/overwrite operation.

## Schema

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Workspace-relative file path."
    },
    "content": {
      "type": "string",
      "description": "Complete file content to write."
    },
    "mode": {
      "type": "string",
      "enum": ["create", "overwrite"],
      "description": "Create a new file or overwrite an existing file."
    },
    "baseHash": {
      "type": "string",
      "description": "Optional hash of the previous file content for stale-write protection."
    }
  },
  "required": ["path", "content", "mode"],
  "additionalProperties": false
}
```

## Behavior

- Resolve `path` inside the workspace root.
- Reject paths outside the workspace.
- In `create` mode, fail if the file already exists.
- In `overwrite` mode, fail if the file does not exist.
- Create parent directories only for `create` mode.
- If `baseHash` is provided, fail when the current file content does not match.
- Return the written path, byte count, and whether a new file was created.

## Detailed Comparison

### Pi

Pi has a `write` tool that writes complete content to a path. It creates parent directories automatically and overwrites an existing file if present. Its prompt guidance says to use write for new files or complete rewrites.

Pi also serializes file mutations through a mutation queue so concurrent writes do not trample the same file.

Inferred rationale: Pi keeps file creation very simple and relies on model instruction to avoid unnecessary rewrites.

Pros:

- Very simple schema.
- Convenient for creating files.
- Parent directory creation is automatic.
- Mutation queue reduces concurrent write risk.

Cons:

- Overwrite behavior is implicit.
- Full rewrites can accidentally remove unrelated user changes.
- No explicit create-vs-overwrite intent in the schema.

### OpenCode

OpenCode's `write` tool writes full file content to an absolute path. It asks for edit permission with a generated diff, writes parent directories, formats the file, publishes file events, and reports LSP diagnostics.

Inferred rationale: OpenCode makes full writes safer by surrounding them with permission, diff visibility, formatting, events, and diagnostics.

Pros:

- Strong user visibility through permission diff.
- Formatting and diagnostics help catch broken writes.
- Events keep the broader app state synchronized.

Cons:

- More runtime complexity.
- Absolute paths and permission services are heavier than Blip v1.
- Formatting after write can introduce extra changes.

### Codex

Codex tends to prefer targeted patch operations for code edits. Full writes can still happen through shell or other file mechanisms, but patching is the safer core workflow.

Inferred rationale: full rewrites are high blast-radius operations, while patches preserve reviewability and make approvals easier to reason about.

Pros:

- Encourages targeted edits.
- Reduces accidental file replacement.
- Works well with patch approval/safety checks.

Cons:

- Creating a wholly new file can be more verbose through patch syntax.
- Some generated files are easier to write as complete content.

## Blip Choice

Blip keeps `write_file`, but makes intent explicit with `mode`: `create` or `overwrite`.

Why this differs:

- Pi's implicit overwrite is convenient but too easy to misuse.
- OpenCode's permission/format/LSP workflow is useful but too heavy for Blip v1.
- Codex's patch-first style is the right default, but full writes are still useful in no-shell contexts.

Pros:

- Clear create-vs-overwrite intent.
- Good for small new files and deliberate full rewrites.
- `baseHash` can protect against stale overwrites.
- Keeps normal edits focused on `apply_patch`.

Cons:

- Slightly more schema complexity than Pi.
- Does not provide OpenCode-style formatting or diagnostics in v1.
- Still risky if used for large rewrites without inspection.
