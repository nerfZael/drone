# Prompts And Instructions

The Blip session core accepts an injected prompt provider and does not discover instruction files.
The CLI assembles its system prompt in `blip/packages/cli/src/cli-prompt.ts`.

The CLI prompt is intentionally small and explicit. It is not built from a plugin system or a hierarchy of prompt resources.

## Current Prompt Layers

The CLI system prompt currently includes:

1. Blip identity and basic coding-agent behavior.
2. Workflow rules.
3. Tool-profile-specific rules.
4. Patch rules.
5. Permission and safety rules.
6. Repository instructions from `<workspace>/AGENTS.md`, when that file exists.

Compaction summaries are not injected into the system prompt. They are added to model-visible message history as a synthetic user message with the prefix `Summary of earlier conversation:`.

Embedded hosts can provide `promptContext` to supply additional messages immediately after an incoming user message and before the first model call. Blip persists those messages through the same agent event path as the user message. For example, Drone Companion supplies an already-executed skill read as an assistant tool call and matching tool result. Hosts own the decision to supply this context once per conversation; `transformContext` can restore required context after compaction without changing the stored transcript.

## Repository Instructions

The Blip CLI currently reads only the workspace-root `AGENTS.md`. Other Blip hosts own their prompt
policy and do not inherit this behavior implicitly.

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
- The core and CLI do not discover skills automatically. Embedded hosts can implement skills using tool providers, prompt sections, and prompt context; Drone Companion supplies its built-in instructions skill this way.
- Tool prompts are not generated from a formal prompt registry.
- There is no prompt-debug command that prints the final assembled prompt.
