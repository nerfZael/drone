# `apply_patch`

## Purpose

`apply_patch` applies targeted file changes inside the active workspace.

It is Blip's primary editing tool.

## Schema

```json
{
  "type": "object",
  "properties": {
    "patch": {
      "type": "string",
      "description": "Strict patch envelope containing add, update, delete, and move operations."
    },
    "baseHash": {
      "type": "string",
      "description": "Optional hash or revision marker for stale workspace protection."
    }
  },
  "required": ["patch"],
  "additionalProperties": false
}
```

## Patch Operations

Blip should support a strict patch format with these operations:

- `Add File`
- `Update File`
- `Delete File`
- `Move to`

## Behavior

- Parse the patch into a structured AST before touching files.
- Resolve all paths inside the workspace root.
- Reject absolute paths and path traversal.
- Validate every operation before writing any file.
- Create parent directories for `Add File`.
- Support `Move to` for renames and moves.
- Fail the whole patch if any operation is invalid.
- Return changed paths, operation counts, and concise failure details.

## Detailed Comparison

### Pi

Pi's main edit tool is exact replacement based. It accepts one or more `oldText`/`newText` replacements, validates them against the original file, computes a diff, preserves line endings/BOM, and serializes file mutations.

Pi also has diff-related helpers, but the model-facing editing workflow is still centered on replacing exact text blocks.

Inferred rationale: exact replacement is easy to explain and easy to validate when the model has read the target file.

Pros:

- Simple mental model.
- Strong validation when `oldText` is unique.
- Good for small localized edits.
- Produces useful diffs.

Cons:

- Fragile when whitespace or context changes.
- Awkward for multi-file changes.
- Bad for moves, deletes, and structural patch batches.
- The model may need to quote large exact blocks.

### OpenCode

OpenCode has both an `edit` tool and an `apply_patch` tool. Its patch tool parses a patch text into hunks, supports add/update/delete/move, computes per-file diffs, asks for edit permission with metadata, applies changes, formats files, publishes file events, and reports diagnostics.

Inferred rationale: OpenCode keeps simple replacement edits available while using patching for larger structured changes that need review and permission metadata.

Pros:

- Supports rich edit batches.
- Permission prompts can show the total diff.
- Runtime events keep app state synchronized.
- Formatting and diagnostics improve feedback.

Cons:

- Large runtime surface.
- Formatting may alter files beyond the patch.
- Permission/event infrastructure is more than Blip v1 needs.

### Codex

Codex has strict apply-patch behavior with safety assessment. It converts patch changes into protocol file changes, supports add/delete/update with move paths, and integrates patch execution with sandbox and approval policy.

Inferred rationale: Codex treats patches as a high-signal, auditable mutation format. Safety checks can reason over file changes before applying them.

Pros:

- Strong fit for approval and sandboxing.
- Good for multi-file edits.
- Supports move/delete/add/update in one envelope.
- More reviewable than full rewrites.

Cons:

- Requires a strict parser and good model instructions.
- More complex than exact replacement for tiny edits.
- Bad patch UX can frustrate users if errors are opaque.

## Blip Choice

Blip makes `apply_patch` the primary edit tool.

Why this differs:

- Blip should take Codex's strict patch discipline.
- Blip should take OpenCode's multi-operation patch scope.
- Blip should avoid making Pi-style exact replacement the main edit path.
- Blip should implement the parser in TypeScript so it lives with the rest of the Blip tools.

Pros:

- Reviewable, targeted edits.
- Works for multi-file changes.
- Supports add, update, delete, and move.
- Easy to share between CLI and future integrations.
- Fits future approval and sandbox models.

Cons:

- Requires careful parser implementation.
- Requires clear tool instructions.
- More verbose than simple exact replacement for tiny edits.
- Transactional behavior needs good tests.

Exact replacement edits are intentionally not a v1 requirement.
