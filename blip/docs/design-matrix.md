# Blip Coding Agent Design Matrix

## Purpose

This document tracks how Blip compares to selected coding agents and records which design choices Blip adopts, adapts, defers, avoids, or makes independently.

Use this as a living decision table. When another CLI agent is studied, add a column. When Blip changes direction, update the Blip choice and the notes instead of relying on memory.

## Naming

This is a **design matrix**, not only a feature comparison.

Reason: many rows are not simple features. Some are architecture choices, safety boundaries, workflow rules, prompt behavior, or integration strategy.

## Legend

- **Adopt**: Blip should copy the idea closely.
- **Adapt**: Blip should use the idea but change it for its own needs.
- **Original**: Blip should make its own choice.
- **Defer**: Useful later, but not v1.
- **Avoid**: Blip should intentionally not do this.

## Overview

### Key Blip Choices

- Standalone CLI first, with reusable runtime packages underneath.
- TypeScript implementation that reuses the existing `packages/ai` and `packages/agent` packages.
- [Session](sessions.md) is Blip's canonical name for a persisted chat/thread/conversation.
- Session continuation, resume, explicit session selection, and fork are included in v1.
- [Runtime events and JSONL](runtime-events.md) are included in v1 for CLI rendering and integrations.
- [Permissions](permissions.md) start with explicit modes and path-safe workspace enforcement; OS sandboxing is later.
- [Prompts and repository instructions](prompts-and-instructions.md) are one layered instruction system.
- Patch-first editing through [`apply_patch`](tools/apply-patch.md).
- [`bash`](tools/bash.md) is included in v1 for local CLI workflows without a separate shell approval flow; OS sandboxing is later.
- Model-facing tools are selected by profile; the default local bash profile stays small.
- [Local anchored compaction](compaction.md) is included in v1; remote compaction, hooks, and memory systems come later.
- Skills start as instruction bundles, not executable plugins.

### Product And Packaging

| Area | Pi | OpenCode | Codex | Blip Choice | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Product shape | Simple CLI coding agent | Full CLI agent with strong product surface | CLI/TUI agent with app/server concepts | Standalone CLI first, reusable runtime underneath | Adapt | Start like Pi, keep runtime clean enough for later callers. |
| Primary implementation language | TypeScript | TypeScript | Rust plus some TypeScript ecosystem pieces | TypeScript | Adopt from Pi/OpenCode | The current monorepo already includes TypeScript AI and agent packages that Blip can reuse. |
| Package layout | Agent/core split exists in Pi | More modular packages | Strong crate separation | `blip/packages/core`, `tools`, `cli` | Adapt | Dedicated `blip/` area, but no extension packages yet. |
| CLI UX | Simple terminal CLI | Richer CLI/TUI | Polished TUI and approvals | Simple streaming CLI first | Adapt | TUI can come later after core behavior is solid. |

Recommended package layout:

```text
blip/
  packages/
    core/
    tools/
    cli/
  docs/
    README.md
    design-matrix.md
    sessions.md
    runtime-events.md
    permissions.md
    prompts-and-instructions.md
    compaction.md
    tools/
      apply-patch.md
      read-file.md
      ...
```

When implementation starts, add `blip/packages/*` to the root workspace config unless monorepo tooling strongly favors `packages/blip-*`.

### Runtime And Sessions

| Area | Pi | OpenCode | Codex | Blip Choice | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Provider layer | Shared provider package | Provider/plugin system | OpenAI/Codex-specific depth | Reuse `packages/ai` | Adopt from Pi | Use the existing provider layer instead of implementing a second provider system for Blip. |
| Agent loop | Evented reusable agent core | Session-oriented runtime | Runtime separated from UI/protocol | Reuse or wrap `packages/agent` | Adapt | Keep coding-specific behavior in Blip. |
| Sessions | Session terminology and persisted sessions, including continue/resume/fork | Session plus chat/product concepts | Thread, session, conversation, and chat across layers | [`session`](sessions.md) is canonical and persisted; continue/resume/fork are v1 | Adopt/Adapt | Raw transcript stays on disk; compacted summary is used for model context. Use chat for UI only and thread only for external provider ids. Fork creates a new session with parent metadata. |
| Runtime events | Evented agent core | Event/session events | Protocol-driven events | [Internal runtime events plus `--jsonl`](runtime-events.md) in v1 | Adapt | JSONL gives integrations a stable process IO contract without a server protocol. |
| Context compaction | Runtime compaction support | Anchored summary prompt | Auto/manual compaction with thresholds and hooks | [Local anchored compaction](compaction.md) in v1 | Adapt | Include a mature local algorithm in v1: manual and pre-turn automatic triggers, structured summaries, verbatim tail, file metadata, and safe boundaries. Defer remote compaction and hooks. |

### Tools

| Area | Pi | OpenCode | Codex | Blip Choice | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Tool model | Small direct tools | Tool registry with text instructions | Strict tool contracts | Tool package with typed schemas and instructions | Adapt | Combine Pi simplicity with OpenCode/Codex clarity. |
| File listing | `ls` style | Glob/list tools | Search/mention support | [`list_files`](tools/list-files.md) with bounded output | Adapt | Keep generic names and predictable output. |
| File search | `find`/`grep` style | Glob/grep tools | Search support | [`search_files`](tools/search-files.md) with name/content modes | Adapt | Prefer `rg`, fall back where needed. |
| File reading | Direct read tool | Read tool with truncation | Bounded context-oriented reads | [`read_file`](tools/read-file.md) with line ranges and truncation | Adopt/Adapt | Must be reliable and concise. |
| Full file writing | Write tool | Write tool | Mostly patch/shell oriented | [`write_file`](tools/write-file.md) capability for no-shell create/overwrite workflows | Adapt | Hide from default local bash profile; patching should be preferred for edits. |
| Editing strategy | Exact edit and diff-style tools | Edit plus apply patch | Strict apply_patch | [`apply_patch`](tools/apply-patch.md) as primary edit tool | Adopt from Codex/OpenCode | Avoid making exact replacement the main path. |
| Patch grammar | Simpler editing tools | Apply patch tool | Strict patch parser | [`apply_patch`](tools/apply-patch.md) uses a strict patch AST | Adopt/Adapt | Take Codex discipline, implement in TS. |
| Parent directory creation on add | Not the main focus | Supported by patch workflows | Supported for add-file patch behavior | [`apply_patch`](tools/apply-patch.md) creates parents for `Add File` | Adopt from Codex | Keeps multi-file patches practical. |
| Rename/move | Can be shell/file-tool driven | Move supported through tools/patch | `Move to` in patch envelope | [`move_path`](tools/move-path.md) capability plus patch `Move to`; hide from default local bash profile | Adopt/Adapt | Use bash or patch for local CLI. Expose `move_path` where bash is unavailable or a UI needs structured move metadata. |
| File deletion | Possible through tools/shell | Tool and patch support | Delete patch support | [`delete_file`](tools/delete-file.md) plus patch `Delete File`; hide from default local bash profile | Adopt/Adapt | Use bash or patch locally. Expose structured delete where bash is unavailable or a UI needs metadata. |
| Directory create/delete | Usually via shell or file utilities | Available through file/shell workflows | Often shell/tool driven | [`create_directory`](tools/create-directory.md) and [`delete_directory`](tools/delete-directory.md) capabilities; hide from default local bash profile | Original/Adapt | Use bash locally. Expose structured directory tools where bash is unavailable or a UI needs specific metadata. |
| Shell command tool | Present | Present with permissions | Present with sandbox/approvals | [`bash`](tools/bash.md) in v1 local CLI; no separate shell approval flow yet | Adapt | Make bash available for developer workflows now. Do not claim read-only shell safety without OS sandboxing or strict allowlists. |
| Git awareness | Can use shell | Git/session support exists | Strong workflow around status/diff | [`get_working_tree_status`](tools/get-working-tree-status.md) capability; hide from default local bash profile | Original/Adapt | Use git through bash locally. Expose the structured tool for read-only, hosted, or UI contexts. |

### Safety And Permissions

| Area | Pi | OpenCode | Codex | Blip Choice | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Permissions | Simple local assumptions | Permission model | Approval and sandbox modes | [`read-only`, `workspace-write`, future `full-access`](permissions.md) | Adapt from Codex/OpenCode | Keep modes understandable and enforce them at tool registration/execution. |
| Sandboxing | Basic local process assumptions | Permission controls | Strong sandbox focus | [Path-safe workspace boundary first](permissions.md); OS sandbox later | Adapt/Defer | Adapt the safety idea now with path checks; defer true OS sandboxing. |

### Prompt, Context, And Skills

| Area | Pi | OpenCode | Codex | Blip Choice | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Prompts and repo instructions | Simple prompt plus instruction files | Modular tool/agent prompts and config instructions | Strong workflow prompt plus `AGENTS.md` support | [Layered prompt and repository instruction system](prompts-and-instructions.md) | Adopt/Adapt | Core identity, tools, patch rules, permissions, global instructions, repo instructions, skills, and task prompt. |
| Skills | Pi-compatible skill roots in ecosystem | First-class skills | Supports skills/plugins concepts | Load `.agents/skills` instructions | Adapt | Skills are instructions first, not executable plugins. |
| Verification behavior | Agent can run checks | Strong workflows | Strong final verification reporting | Require honest verification summary | Adopt/Adapt | Report what was run and what was not. |
| Final response style | Concise CLI answer | Product-specific | Concise engineering summary | Short changed-files and verification summary | Adapt | Match Blip's preferred coding workflow. |

### Integrations And Expansion

| Area | Pi | OpenCode | Codex | Blip Choice | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Plugins/extensions | Not core to Pi's simple CLI shape | Strong plugin direction | MCP/plugins | No plugin platform in v1 | Defer | Add only when a real use case demands it. |
| Subagents | Not core to Pi's simple CLI shape | Task/subagent features | Supports delegation concepts | Defer subagents | Defer | Get single-agent correctness first. |
| VoiceStream integration | Not applicable | Not applicable | Not applicable | Not v1 | Defer | Blip should be its own CLI agent first. |
| DroneHub integration | DroneHub can run Pi | DroneHub can run OpenCode | DroneHub can run Codex | Future built-in DroneHub agent option | Defer | Clean CLI and JSONL mode would make this easier later. |
| Remote execution | Not core to Pi's local CLI workflow | Has broader architecture | App/server concepts | Not v1 | Defer | Local CLI only for now. |

## Modified Choices

### Standalone CLI First

Blip should start like Pi, OpenCode, and Codex: a CLI agent users run in a repository.

Blip is intentionally not starting with a VoiceStream extension, VS Code extension, or server bridge. That keeps the first product surface simple and forces the core agent to stand on its own.

### Reuse Existing Runtime Packages, But Do Not Become Pi

The current monorepo includes `packages/ai` and `packages/agent`, which were originally sourced from Pi. Blip should reuse those packages where they are helpful.

The modification is that Blip gets its own coding-specific packages:

- prompts
- tools
- permissions
- session policy
- CLI behavior

This gives Blip Pi's speed and simplicity without tying Blip's design to Pi's CLI package.

### Session As The Canonical Conversation Term

Blip should use **session** for the persisted unit of work.

Other agents use overlapping terms. Pi mostly uses session. Codex uses thread, session, conversation, and chat in different layers. Blip should avoid that ambiguity by using session in code, docs, CLI flags, and persisted files. Chat can be a UI label, and thread should be reserved for external provider metadata.

### V1 Continue, Resume, And Fork

Blip should include the core local session workflows in v1:

- `--continue` opens the most recent session for the current workspace.
- `--resume` lets the user choose a previous session.
- `--session <id>` opens a specific session directly.
- `--fork <id>` creates a new session from an existing one.

Fork should be a simple new-session copy operation in v1. It should record the parent session and optional fork source entry, but it should not bring in Pi's full in-place session tree navigation yet.

### Permissions Before Sandboxing

Blip should define permission modes before adding OS sandboxing.

The v1 implementation should enforce tool availability and workspace-root path safety. That is not the same as a true OS sandbox, so the design matrix marks sandboxing as **Adapt/Defer**: adapt the safety principle now, defer OS-level enforcement.

### Layered Prompt And Repo Instructions

Prompt style and repository instructions should be treated as one system.

The model's behavior comes from the assembled instruction stack: built-in Blip workflow, tool rules, patch rules, permission rules, global user instructions, repository instructions, loaded skills, and the current task. Keeping those layers explicit should make prompt behavior easier to debug and maintain.

### Patch-First Editing

Pi has simpler edit/write tools, while OpenCode and Codex both put more emphasis on patch-style editing.

Blip should make `apply_patch` the main edit path. `write_file` should still exist for file creation and full overwrites, but normal code edits should use patches so changes are targeted and reviewable.

### Strict Patch Parser In TypeScript

Codex's patch discipline is worth copying, but Blip should implement it in TypeScript inside `blip/packages/tools`.

The parser should:

- parse a structured patch AST before touching files
- validate all paths against the workspace root
- support add, update, delete, and move
- create parent directories for added files
- fail the whole patch when any operation is unsafe or invalid

### Tool Profiles, Not One Global Tool List

Blip should not expose every implemented tool to the model in every run.

V1 should treat tools as capabilities and choose a small model-facing set from:

- permission mode
- environment capabilities
- trust level
- UI or integration needs

Recommended v1 profiles:

| Profile | Use Case | Model-Facing Tools |
| --- | --- | --- |
| Local trusted CLI write | Normal developer use in a local repo | `bash`, `apply_patch`, `read_file`, `search_files`, `list_files` |
| Read-only | Review or audit without mutation | `read_file`, `search_files`, `list_files`, `get_working_tree_status` |
| No-shell workspace write | Browser, hosted, or filesystem-adapter contexts where bash is unavailable | `apply_patch`, `read_file`, `search_files`, `list_files`, `write_file`, `delete_file`, `create_directory`, `delete_directory`, `move_path`, `get_working_tree_status` |

This keeps the common local agent simple. Bash covers one-off filesystem and git commands, while structured tools remain available for constrained environments.

### Bash Plus Structured Filesystem Capabilities

Other agents can rely on shell commands for directory creation, deletion, moving, and renaming.

Blip v1 should include `bash` for local CLI workflows, but it should still implement explicit filesystem capabilities:

- `create_directory`
- `delete_directory`
- `move_path`

These tools should not be part of the default local bash profile. They exist for no-shell workspace-write environments and future UIs that need structured operation metadata.

### Runtime Events And JSONL, Not A Protocol Package

Codex and OpenCode have stronger session/protocol architecture. Blip should learn from that, but not overbuild v1.

The v1 runtime should emit internal TypeScript events for streaming text, tool calls, errors, compaction, and session completion. The CLI should render those events for humans, and `--jsonl` should emit the same stream for machines.

This gives integrations a stable process contract without creating a dedicated protocol package or server.

### Local Anchored Compaction

Blip should add local anchored compaction in v1 instead of deferring serious long-session support.

The modification is to take OpenCode's anchored-summary approach, Pi's practical token and file-operation tracking, and Codex's first-class compaction lifecycle. V1 should keep the newest turns verbatim, store a structured summary for older context, support manual `/compact`, and run a deterministic local pre-turn trigger when context pressure is high. Summary generation should use the active model when available and fall back to a deterministic local summary.

Codex-style remote compaction, pre/post hooks, and richer memory systems should wait until the session format and CLI behavior are stable.

### Skills As Instructions First

OpenCode and Codex point toward richer skills/plugins. VoiceStream also has a skill direction.

Blip should start with `.agents/skills` support, but v1 skills should be instruction bundles only. Skill-provided tools and plugin behavior should wait until the core agent is stable.

## Maintenance Rules

When updating this document:

- Add new agents as columns, not as separate sections.
- Add new decisions as rows under the closest category.
- Add a new category only when an existing category would become vague or overloaded.
- Keep the Blip choice short.
- Put longer reasoning in **Modified Choices** or a new notes section.
- Mark uncertain choices as **Open** in the Status column instead of pretending they are decided.
- Update this doc when implementation changes, not only during planning.

## Source Notes

Local research references:

- Pi: `.research/coding-agents/pi`
- OpenCode: `.research/coding-agents/opencode`
- Codex: `.research/coding-agents/codex`

Relevant local packages:

- `packages/ai`
- `packages/agent`
