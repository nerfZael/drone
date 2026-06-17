# `move_path`

## Purpose

`move_path` moves or renames a file or directory inside the active workspace.

Use it for direct moves. Use `apply_patch` with `Move to` when a move is part of a larger edit batch.

## Tool Profile

`move_path` is a v1 capability, but it should not be in the default local bash profile. In local trusted CLI runs, use bash for simple moves and `apply_patch` `Move to` when the move belongs with a code edit.

Expose `move_path` in no-shell workspace-write profiles and UIs that need structured move metadata.

## Schema

```json
{
  "type": "object",
  "properties": {
    "from": {
      "type": "string",
      "description": "Workspace-relative source path."
    },
    "to": {
      "type": "string",
      "description": "Workspace-relative destination path."
    },
    "overwrite": {
      "type": "boolean",
      "description": "Whether to overwrite an existing destination."
    }
  },
  "required": ["from", "to"],
  "additionalProperties": false
}
```

## Behavior

- Resolve both paths inside the workspace root.
- Reject paths outside the workspace.
- Fail if the source does not exist.
- Fail if the destination exists unless `overwrite` is true.
- Do not create destination parents by default.
- Return source path, destination path, and moved entry type.

## Detailed Comparison

### Pi

Pi can move or rename paths through shell workflows or custom filesystem operations. Its main edit tool focuses on content replacement, not path moves.

Inferred rationale: in a simple CLI agent, path moves are less common than content edits and can be delegated to shell when needed.

Pros:

- Smaller core tool set.
- Shell move semantics are familiar.
- No separate move schema.

Cons:

- Depends on shell.
- Harder to review moves alongside content edits.
- Harder to enforce workspace-root behavior without wrapping shell.

### OpenCode

OpenCode's patch path supports move operations, and its runtime can represent file changes with metadata, diffs, and events. Shell or filesystem services can cover direct moves.

Inferred rationale: moves are most valuable when represented as file-change metadata that the UI and permission system can understand.

Pros:

- Move operations can be part of a reviewed patch.
- Runtime events can update UI state.
- Permission metadata can include source and destination.

Cons:

- Direct one-off moves are more cumbersome if expressed as patches.
- More runtime machinery than Blip v1.

### Codex

Codex supports `Move to` in patch envelopes and can also use shell moves when permitted. Patch moves allow the system to reason about file changes before applying them.

Inferred rationale: moves should be auditable when part of a code edit, while shell remains available for simple filesystem operations under sandbox rules.

Pros:

- Patch moves are reviewable.
- Shell moves are flexible.
- Safety checks can assess the mutation.

Cons:

- Requires shell/sandbox for the direct move path.
- Patch syntax is heavier for a simple rename.

## Blip Choice

Blip supports both `move_path` and patch `Move to`.

Why this differs:

- `move_path` is best for a simple rename or move when bash is unavailable.
- `apply_patch` `Move to` is best when a move is part of a broader edit.
- No-shell contexts still need a structured path-safe move operation.

Pros:

- Clear direct tool for common renames.
- Patch path remains available for batched changes.
- Workspace-root validation covers both source and destination.

Cons:

- Two ways to express moves can require model guidance.
- Direct moves do not show a content diff by themselves.
- Destination overwrite behavior needs strict defaults.
