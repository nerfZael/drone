# `read_file`

## Purpose

`read_file` reads text content from a file inside the active workspace.

It is the main inspection tool before Blip edits code.

## Schema

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Workspace-relative file path."
    },
    "offset": {
      "type": "integer",
      "minimum": 0,
      "description": "Zero-based line offset."
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 1000,
      "description": "Maximum number of lines to return."
    }
  },
  "required": ["path"],
  "additionalProperties": false
}
```

## Behavior

- Resolve `path` inside the workspace root.
- Reject paths outside the workspace.
- Reject directories.
- Refuse binary files.
- Return line-numbered text.
- Support line ranges through `offset` and `limit`.
- Include continuation hints when the file is longer than the returned range.

## Detailed Comparison

### Pi

Pi has a direct `read` tool. It accepts a path plus optional line offset and limit. It can read text files and supported images, truncates large output, and encourages offset/limit follow-up reads for large files.

Pi also has compact rendering for resources such as skills and instruction files, so the CLI can keep common context reads visually small.

Inferred rationale: Pi wants one reliable inspection tool that works for code, docs, and images while keeping terminal output manageable.

Pros:

- Simple direct read surface.
- Supports ranges for large files.
- Handles images when the model supports them.
- Truncation protects context.

Cons:

- Image support makes the tool broader than a pure code-reading primitive.
- Path contract is less workspace-specific than Blip's planned root model.
- Compact UI behavior is useful but tied to Pi's terminal experience.

### OpenCode

OpenCode's `read` tool is broader. It accepts an absolute path, can list directories, can read files with offset/limit, detects binary files, supports media handling, warms LSP state in the background, and includes helpful "did you mean" suggestions for missing files.

Inferred rationale: OpenCode treats read as a central navigation primitive. It combines directory listing, file reading, references, LSP awareness, and rich error behavior into one mature tool.

Pros:

- Very capable navigation tool.
- Helpful missing-file suggestions.
- Strong truncation and line-length caps.
- LSP warm-up helps later code intelligence.

Cons:

- Broad tool behavior can be harder to reason about.
- Absolute paths are less friendly for a portable workspace contract.
- LSP/media behavior adds v1 complexity.

### Codex

Codex strongly encourages inspecting files before editing, but in practice inspection can happen through shell commands, file search, and UI-level file interactions. Its safety model focuses more on sandboxed execution and patch approval than on one special read tool.

Inferred rationale: Codex lets the agent use normal developer inspection workflows while enforcing safety at the environment and approval layer.

Pros:

- Flexible inspection workflows.
- Natural for developers who expect shell tools.
- Works well with sandboxed command execution.

Cons:

- Depends on shell or richer runtime surfaces for some workflows.
- File reads can become noisy if done through generic commands.
- Not ideal as the only Blip v1 read path.

## Blip Choice

Blip uses `read_file` as a narrow, code-oriented inspection tool.

Why this differs:

- Blip v1 should keep directory listing separate in `list_files`.
- Blip should use workspace-relative paths.
- Line-numbered output should be standard so later patch instructions can refer to exact locations.
- Image/media support can wait until there is a concrete need.

Pros:

- Reliable and easy to test.
- Strong fit for code-editing workflows.
- Keeps context bounded through line ranges.
- Makes "inspect before edit" straightforward.

Cons:

- Less capable than OpenCode's broad read tool.
- No image/media support in v1.
- Requires separate calls for listing and reading.
