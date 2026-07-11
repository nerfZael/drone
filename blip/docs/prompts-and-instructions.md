# Prompts And Instructions

Blip assembles one system prompt for each run in `assembleSystemPrompt()`.

The prompt is intentionally small and explicit. It is not built from a plugin system or a hierarchy of prompt resources.

## Current Prompt Layers

The system prompt currently includes:

1. Blip identity and basic coding-agent behavior.
2. Workflow rules.
3. Tool-profile-specific rules.
4. Patch rules.
5. Permission and safety rules.
6. Repository instructions from `<workspace>/AGENTS.md`, when that file exists.

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

## Current Gaps

- Nested `AGENTS.md` discovery is not implemented.
- Global user instructions are not loaded by Blip.
- Skill loading is represented in session metadata but not implemented as prompt assembly.
- Tool prompts are not generated from a formal prompt registry.
- There is no prompt-debug command that prints the final assembled prompt.
