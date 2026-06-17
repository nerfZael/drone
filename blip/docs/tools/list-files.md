# `list_files`

## Purpose

`list_files` lists the direct contents of a directory inside the active workspace.

It is Blip's safe replacement for asking the model to run `ls` in v1.

## Schema

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Workspace-relative directory path. Defaults to the workspace root."
    },
    "includeHidden": {
      "type": "boolean",
      "description": "Whether to include dotfiles and hidden entries."
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 500,
      "description": "Maximum number of entries to return."
    }
  },
  "required": [],
  "additionalProperties": false
}
```

## Behavior

- Resolve `path` inside the workspace root.
- Reject paths outside the workspace.
- Return direct child entries only.
- Include entry type, size, and modified time when available.
- Sort directories and files in a stable, predictable order.
- Return a truncation marker if more entries exist than `limit`.

## Detailed Comparison

### Pi

Pi has a direct `ls` tool. It accepts a directory path and an optional limit, sorts entries alphabetically, appends `/` to directories, includes dotfiles, and caps output by entry count and byte size.

Pi's implementation also has pluggable filesystem operations. That means the same tool shape can theoretically list a remote filesystem if another layer provides `exists`, `stat`, and `readdir`.

Inferred rationale: Pi keeps listing simple because it is a basic orientation tool. The model gets a small directory snapshot before deciding whether to read or search.

Pros:

- Simple for the model to choose.
- Easy to render in a CLI.
- Bounded output protects context.
- Pluggable operations leave room for remote filesystems.

Cons:

- Tool name `ls` is shell-like rather than descriptive.
- Output is mostly names, not structured metadata.
- Recursive discovery needs another tool.

### OpenCode

OpenCode's `read` tool can list a directory when the path is a directory, and its `glob` tool handles pattern-based file discovery. `glob` uses ripgrep-backed file discovery, limits results, and sorts by modified time.

Inferred rationale: OpenCode treats listing as part of a broader file navigation system. Directory reads, glob search, references, and permissions all participate in the same runtime.

Pros:

- Richer navigation model.
- Directory listing and file reading share one tool surface.
- Permission and external-directory checks are integrated.
- Modified-time sorting can surface recently relevant files.

Cons:

- Combining directory listing and file reading makes the read tool broader.
- Absolute-path-oriented schemas can be less portable for a workspace-root tool.
- More runtime machinery than Blip needs in v1.

### Codex

Codex can inspect directories through shell commands and its broader file/search UI. Its strongest file mutation primitive is `apply_patch`, while directory listing is usually part of shell or environment interaction rather than a special high-level tool.

Inferred rationale: Codex leans on a sandboxed shell plus approvals, so ordinary developer commands remain available while safety is handled by the execution environment.

Pros:

- Flexible and familiar for developers.
- No need to invent separate tools for every filesystem operation.
- Works naturally with existing command-line workflows.

Cons:

- Requires shell support, sandboxing, and approval policy to be safe in untrusted contexts.
- Shell output can be noisy or inconsistent across platforms.
- Harder to expose as structured, bounded data.

## Blip Choice

Blip uses `list_files` as a direct, descriptive tool instead of `ls`.

Why this differs:

- Directory listing should be available as a structured first-class tool even when bash is unavailable.
- Blip should use workspace-relative paths, not arbitrary absolute paths.
- Blip should return structured entries, not only formatted shell text.
- Recursive discovery should be handled by `search_files`, not overloaded into listing.

Pros:

- Clear name in model traces and logs.
- Safer path contract for local and future hosted use.
- Predictable bounded output.
- Easy to reuse outside the CLI.

Cons:

- Less flexible than shell.
- Another tool the model must learn.
- Needs a separate `search_files` tool for recursive discovery.
