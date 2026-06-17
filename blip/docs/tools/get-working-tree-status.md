# `get_working_tree_status`

## Purpose

`get_working_tree_status` reports the repository's current change state as a structured alternative to ad hoc git shell commands.

It helps Blip understand what changed before and after edits.

## Tool Profile

`get_working_tree_status` is a v1 capability, but it should not be in the default local bash profile. In local trusted CLI runs, use bash for git commands.

Expose `get_working_tree_status` in read-only, hosted, browser, or UI profiles where bash is unavailable or where the caller needs bounded structured status.

## Schema

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Workspace-relative directory to inspect. Defaults to the workspace root."
    },
    "includeDiffSummary": {
      "type": "boolean",
      "description": "Whether to include a bounded diffstat or summary."
    }
  },
  "required": [],
  "additionalProperties": false
}
```

## Behavior

- Resolve `path` inside the workspace root.
- Detect whether the path is inside a git repository.
- Return branch name when available.
- Return changed, untracked, staged, and conflicted files when available.
- Optionally return a bounded diff summary.
- Do not run arbitrary shell commands.

## Detailed Comparison

### Pi

Pi can inspect git state through shell commands when shell is available. Its tool set does not need a dedicated git-status tool because `git status`, `git diff`, and related commands are available through bash workflows.

Inferred rationale: shell is the most flexible git interface and avoids duplicating git features as individual tools.

Pros:

- Full git power is available.
- No custom git wrapper to maintain.
- Developers recognize the command output.

Cons:

- Requires shell.
- Git output can be verbose.
- Harder to keep status output consistently bounded.

### OpenCode

OpenCode has broader project/session awareness and git-related runtime concepts. It can use shell and internal services to reason about worktrees, snapshots, file diffs, and active changes.

Inferred rationale: a mature coding agent benefits from knowing not only current files, but also how changes relate to sessions, snapshots, and UI state.

Pros:

- Richer context for long-running work.
- Can connect git state to snapshots and UI.
- Better foundation for review workflows.

Cons:

- Much heavier than a first Blip tool.
- Requires more runtime state and service boundaries.

### Codex

Codex places strong emphasis on working-tree awareness, final summaries, and verification. It can inspect git state through shell and uses its runtime context to avoid overwriting unrelated user changes.

Inferred rationale: coding agents need to distinguish their own changes from pre-existing work, especially before summarizing or committing.

Pros:

- Strong developer workflow discipline.
- Helps avoid clobbering user changes.
- Supports accurate final reporting.

Cons:

- Usually depends on shell/git availability.
- Full git workflows are more than Blip v1 needs.

## Blip Choice

Blip adds `get_working_tree_status` as a narrow git-awareness tool.

Why this differs:

- Working-tree status should be available in a structured form even when bash is unavailable.
- The agent still needs to know whether files are modified, staged, untracked, or conflicted.
- Final summaries should distinguish existing changes from Blip changes where possible.

Pros:

- Useful safety context without requiring a shell command.
- Bounded output can be designed from the start.
- Helps with summaries and review behavior.

Cons:

- Only covers a small part of git.
- Needs graceful behavior outside git repositories.
- May eventually be replaced or expanded by shell/git tools.
