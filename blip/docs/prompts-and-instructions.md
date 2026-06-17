# Blip Prompts And Repository Instructions

## Purpose

This document defines how Blip should assemble its coding-agent instructions.

The goal is to keep the core system prompt stable while allowing project-specific rules, skills, and task context to layer on top.

## V1 Prompt Layers

Blip should assemble instructions in this order:

1. Built-in Blip identity and coding workflow.
2. Tool usage rules.
3. Patch rules.
4. Permission and safety rules.
5. Global user instructions.
6. Repository instructions.
7. Loaded skills.
8. Current task prompt.

Later layers should not silently erase earlier safety rules.

## Repository Instructions

Blip should read repository instructions from `AGENTS.md` first.

Recommended lookup:

- workspace root `AGENTS.md`
- nearest parent `AGENTS.md` for files being edited, if nested instructions are supported later

V1 can start with the workspace-root file only.

## Prompt Module Shape

Keep prompt modules as separate files or constants:

- `identity`
- `workflow`
- `tools`
- `apply_patch`
- `permissions`
- `repo_instructions`
- `skills`
- `final_response`

This makes it easier to update one behavior without rewriting a long monolithic prompt.

## Comparison

### Pi

Pi has a simpler direct coding-agent prompt style and reusable tool prompt snippets. It also supports agent instruction files and skills in its ecosystem.

Blip should adopt Pi's simplicity, but make prompt layers explicit from the beginning.

### OpenCode

OpenCode has modular tool and agent prompts. Tool descriptions live beside implementations, and agent prompts cover focused behaviors such as exploration, summaries, and compaction.

Blip should adapt this modularity because it makes maintenance easier and keeps tool instructions close to tool behavior.

### Codex

Codex has strong developer workflow instructions, patch instructions, permissions instructions, and repository instruction support through `AGENTS.md`.

Blip should adopt the discipline: inspect before editing, use targeted patches, preserve user changes, verify when possible, and summarize honestly.

## Blip Choice

Blip should combine prompt style and repository instructions into one design area because they affect the same thing: what the model knows before it acts.

V1 should:

- use modular prompt sections
- read `AGENTS.md`
- include loaded skill instructions only when relevant or selected
- keep patch and permission rules explicit
- keep final response rules concise

## Open Questions

- Should Blip support nested `AGENTS.md` files in v1?
- Should skills be auto-selected or only loaded by explicit CLI flag at first?
- Should prompt modules live in code, markdown files, or both?
- Should users be able to inspect the final assembled prompt with a debug flag?
