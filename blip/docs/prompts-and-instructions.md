# Prompts And Instructions

Blip assembles one system prompt for each run in `assembleSystemPrompt()`.

The prompt is intentionally small and explicit. It is not built from a plugin system or a hierarchy of prompt resources.

## Current Prompt Layers

The system prompt currently includes:

1. Blip identity and basic coding-agent behavior.
2. Workflow rules.
3. Tool-profile-specific rules.
4. Agent rules, when the agent tool is enabled.
5. Patch rules.
6. Permission and safety rules.
7. Repository instructions from `<workspace>/AGENTS.md`, when that file exists.

Compaction summaries are not injected into the system prompt. They are added to model-visible message history as a synthetic user message with the prefix `Summary of earlier conversation:`.

## Repository Instructions

Blip currently reads only the workspace-root `AGENTS.md`.

If the file does not exist, the prompt simply omits repository instructions. If it exists and is non-empty, Blip appends it under:

```text
Repository instructions from AGENTS.md:
...
```

## Tool Rules

Tool rules depend on the active profile:

- `local-trusted-write`: tells the model that `bash`, `apply_patch`, `read_file`, `search_files`, and `list_files` are available.
- `read-only`: tells the model that only inspection tools are available and mutation is not allowed.
- `no-shell-workspace-write`: tells the model that bash is unavailable and structured file tools are used.

The workflow prompt asks the model to batch independent read/search/list/bash calls in one assistant turn when they can run in parallel.

When agents are enabled, the prompt exposes the `agent` tool for bounded parallel agents with explicit context and authority. It tells the model not to use agents for simple discovery that can be handled with parallel read/search/list/bash calls, to prefer `read_only` authority for discovery and review, to use `scratch` for isolated patch candidates, and to use `wait:false` only when the parent can continue useful work before collecting results. It also tells the parent to avoid overlapping broad discovery while agents are running and to use agent progress/coverage updates before repeating work in the same lane. At runtime, completed non-blocking agent results may also be auto-delivered into the parent model context without a model-authored `agent collect` tool call.

## Current Gaps

- Nested `AGENTS.md` discovery is not implemented.
- Global user instructions are not loaded by Blip.
- Skill loading is represented in session metadata but not implemented as prompt assembly.
- Tool prompts are not generated from a formal prompt registry.
- There is no prompt-debug command that prints the final assembled prompt.
