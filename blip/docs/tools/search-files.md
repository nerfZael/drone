# `search_files`

## Purpose

`search_files` searches files by name or by text content inside the active workspace.

It is Blip's safe replacement for common `find` and `grep` workflows in v1.

## Schema

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Text or pattern to search for."
    },
    "mode": {
      "type": "string",
      "enum": ["name", "content"],
      "description": "Search filenames or file contents."
    },
    "path": {
      "type": "string",
      "description": "Workspace-relative directory to search from. Defaults to the workspace root."
    },
    "includeGlob": {
      "type": "string",
      "description": "Optional glob filter for files to include."
    },
    "excludeGlob": {
      "type": "string",
      "description": "Optional glob filter for files to exclude."
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 500,
      "description": "Maximum number of matches to return."
    }
  },
  "required": ["query", "mode"],
  "additionalProperties": false
}
```

## Behavior

- Resolve `path` inside the workspace root.
- Reject paths outside the workspace.
- For `mode: "name"`, search filenames and relative paths.
- For `mode: "content"`, prefer `rg` when available.
- Fall back to a built-in traversal where practical.
- Return bounded matches with file path, line number for content matches, and short preview text.
- Include a truncation marker when the result set is capped.

## Detailed Comparison

### Pi

Pi separates file-name search and content search into `find` and `grep`.

Observed behavior:

- `find` uses glob patterns, defaults to the current directory, respects `.gitignore`, and caps results.
- `grep` uses ripgrep, supports regex or literal mode, optional glob filtering, ignore-case, context lines, and match limits.
- Both tools truncate output to protect context.

Inferred rationale: Pi follows familiar shell concepts. Models and developers already understand `find` and `grep`, so the tools are easy to explain.

Pros:

- Clear separation between file discovery and content search.
- `grep` exposes useful search controls.
- Uses fast, proven command-line engines.

Cons:

- Two tools can be harder for a model to choose between.
- Shell-like naming is less descriptive in generic tool UIs.
- More knobs increase invalid or overbroad calls.

### OpenCode

OpenCode also separates search into `glob` and `grep`.

Observed behavior:

- `glob` searches files by pattern, uses ripgrep-backed file listing, limits to 100 results, and sorts by modified time.
- `grep` searches file contents, accepts a pattern, optional path, optional include glob, and limits output.
- Both tools run through OpenCode's permission and external-directory checks.

Inferred rationale: OpenCode optimizes for a mature coding-agent workflow where file discovery and text search have different permissions, metadata, and result ranking.

Pros:

- Strong separation of concerns.
- Modified-time sorting can surface active files.
- Permission model is integrated.
- Search tools are backed by fast filesystem primitives.

Cons:

- Separate tools add model-choice complexity.
- Absolute path handling and runtime services are heavier than Blip v1 needs.
- Sorting by modified time may hide alphabetically obvious matches.

### Codex

Codex supports repository exploration through shell, file search UI, and prompt-time file mentions. It does not need one combined high-level search tool because shell and sandboxed execution cover many search workflows.

Inferred rationale: Codex preserves developer flexibility by allowing normal commands like `rg` when permitted, while sandboxing and approvals manage risk.

Pros:

- Very flexible.
- Lets the agent use the exact search command needed.
- Works well for advanced repo investigation.

Cons:

- Depends on shell availability for advanced command workflows.
- Search output can vary by platform and installed tools.
- Harder to expose as structured, bounded data.

## Blip Choice

Blip starts with one `search_files` tool and an explicit `mode`: `name` or `content`.

Why this differs:

- Search should be available as a structured first-class tool even when bash is unavailable.
- One search tool is easier for the model to discover and use.
- `mode` keeps the intent clear without creating two separate tools.
- A future version can split this into `glob_files` and `search_content` if real usage shows the combined tool is too broad.

Pros:

- Simple model decision: use one tool for search.
- Covers the common "where is this file?" and "where is this text?" cases.
- Keeps output and permissions consistent.
- Can still use `rg` internally for content search.

Cons:

- Combines two concepts in one schema.
- May need more options over time.
- Advanced search workflows may eventually justify separate tools.
