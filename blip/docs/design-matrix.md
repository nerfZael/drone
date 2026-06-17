# Design Matrix

This matrix compares Blip's current implementation with Pi, OpenCode, and Codex.

The purpose is to preserve design context without turning this file into a roadmap. Rows describe what Blip does now and list missing pieces explicitly.

## Current Package Shape

```text
blip/
  packages/
    cli/
    core/
    tools/
  docs/
```

Root workspace wiring includes `blip/packages/*`, and the root script `bun run blip -- ...` launches the CLI package.

## Product And Packaging

| Area | Pi | OpenCode | Codex | Current Blip |
| --- | --- | --- | --- | --- |
| Product shape | Simple CLI coding agent. | CLI/TUI product with broader app concepts. | CLI/TUI coding agent with strong protocol/runtime boundaries. | Local CLI coding agent. No TUI or server. |
| Implementation language | TypeScript. | TypeScript. | Mostly Rust, with TypeScript ecosystem pieces. | TypeScript. |
| Package layout | Reusable AI/agent packages. | Modular app/provider/session/tool packages. | Rust crates split by protocol/runtime/client concerns. | `@blip/cli`, `@blip/core`, and `@blip/tools`. |
| Provider layer | Reusable provider package. | Provider/plugin system. | Deep OpenAI/Codex integration. | Reuses `@mariozechner/pi-ai`. |
| Agent loop | Reusable evented agent. | Session-oriented runtime. | Runtime separated from protocol/UI. | Wraps `@mariozechner/pi-agent-core` in Blip runtime/session behavior. |

## Runtime And Sessions

| Area | Pi | OpenCode | Codex | Current Blip | Current Gaps |
| --- | --- | --- | --- | --- | --- |
| Canonical conversation term | Session. | Session/chat terminology. | Thread/session/conversation terms across layers. | Uses `session` in CLI, code, and storage. | `providerSessionId` and `providerThreadId` exist but are not actively integrated. |
| Storage | Local/session abstractions. | Session database/state. | Rollout/history model. | Local `.blip/sessions/<workspace-hash>/<session-id>` directory with `session.json` and `transcript.jsonl`. | No alternate storage backend. |
| Continue/resume | Local session continuation. | Session resume in richer UI. | Thread continuation. | `--continue`, `--resume`, and `--session` load existing sessions. | `--resume` has no interactive picker; it behaves like latest-session resume. |
| Fork | Session/tree concepts in Pi ecosystem. | Session branching concepts. | Thread/history manipulation. | `--fork <id>` creates a new session seeded with the source transcript and records parent metadata. | No fork-from-entry CLI. No in-place tree navigation. |
| Runtime events | Evented agent core. | Event/session stream. | Protocol events. | TypeScript runtime events plus CLI JSONL mode. | No generated JSON Schema. No server protocol. |
| JSONL | Possible through process integration. | App and TUI streams. | Protocol-oriented event stream. | `--jsonl` prints runtime events as one JSON object per line. | Token/cost fields are not included. |

## Tools

| Area | Pi | OpenCode | Codex | Current Blip | Current Gaps |
| --- | --- | --- | --- | --- | --- |
| Tool model | Small direct tools. | Tool registry and prompts. | Strict tool contracts. | `@blip/tools` exports typed tools and profile selection. | No plugin tool registry. |
| File listing | Shell/list style. | Glob/list tools. | Search/mention support. | `list_files` lists direct children with bounded metadata. | No recursion or gitignore handling. |
| File search | Find/grep style. | Glob/grep tools. | Search support. | `search_files` supports name and content modes, uses `rg` when available. | Glob support is simple; fallback content search is substring-based. |
| File reading | Direct read tool. | Read tool with truncation and richer behavior. | Bounded context reads. | `read_file` reads text files with line numbers, offset, and limit. | No media support, LSP warm-up, or missing-file suggestions. |
| Patch editing | Simpler edit tools. | Edit/apply patch support. | Strict `apply_patch`. | `apply_patch` is the preferred edit path and supports add/update/delete/move. | No formatter or diagnostics integration after patching. |
| Full file writing | Write tool. | Write tool. | Often patch/shell oriented. | `write_file` exists in `no-shell-workspace-write`. | Hidden from trusted local profile. No partial edit mode. |
| File deletion | Tool/shell possible. | Tool and patch support. | Patch deletion and shell workflows. | `delete_file` exists in `no-shell-workspace-write`; `apply_patch` also supports delete. | No trash/recovery or approval prompt. |
| Directory operations | Usually shell/file utilities. | Available through tool/shell workflows. | Usually shell/tool driven. | `create_directory` and `delete_directory` exist in `no-shell-workspace-write`. | Recursive delete has no approval prompt. |
| Moves/renames | Shell/file utilities. | Move supported through tools/patch. | Patch move support. | `move_path` exists in `no-shell-workspace-write`; `apply_patch` supports `Move to`. | No special git rename handling. |
| Shell | Present. | Present with permission model. | Present with sandbox/approvals. | `bash` exists only in `local-trusted-write`. | No OS sandbox, command allowlist, or approval flow. |
| Git status | Shell-driven. | Git/session support. | Strong status/diff workflow. | `get_working_tree_status` exists in `read-only` and `no-shell-workspace-write`; trusted local profile uses `bash`. | Output is mostly git text, not a rich parsed status model. |

## Implemented Tool Profiles

| Profile | Model-Facing Tools | Use Case |
| --- | --- | --- |
| `local-trusted-write` | `bash`, `apply_patch`, `read_file`, `search_files`, `list_files` | Normal local developer CLI use. |
| `read-only` | `read_file`, `search_files`, `list_files`, `get_working_tree_status` | Review/audit without file mutation. |
| `no-shell-workspace-write` | `apply_patch`, `read_file`, `search_files`, `list_files`, `write_file`, `delete_file`, `create_directory`, `delete_directory`, `move_path`, `get_working_tree_status` | Workspace-write environments where shell is unavailable or inappropriate. |

## Safety And Permissions

| Area | Pi | OpenCode | Codex | Current Blip | Current Gaps |
| --- | --- | --- | --- | --- | --- |
| Permission modes | Simple local assumptions. | Permission model. | Approval and sandbox modes. | `read-only`, `workspace-write`, and `full-access` types exist. | `full-access` does not bypass structured tool workspace checks. |
| Tool exposure | Direct/small tool sets. | Configurable agents/tools. | Mode-dependent tools. | Active profile controls model-facing tools. | No dynamic policy engine beyond profile selection. |
| Workspace safety | Local assumptions. | Permission/runtime checks. | Strong sandbox emphasis. | Structured tools reject paths outside workspace. | No OS sandbox. |
| Shell safety | Local shell assumption. | Permission-controlled shell. | Sandbox/approval aware. | `bash` is trusted local only. | No per-command approval or OS containment. |

## Prompts, Instructions, And Skills

| Area | Pi | OpenCode | Codex | Current Blip | Current Gaps |
| --- | --- | --- | --- | --- | --- |
| System prompt | Simple coding-agent prompt. | Modular agent/tool prompts. | Strong workflow prompt. | Blip assembles identity, workflow, tool profile rules, patch rules, permission rules, and root `AGENTS.md`. | No prompt-debug command. |
| Repo instructions | Instruction files in ecosystem. | Config/instruction layering. | `AGENTS.md` support. | Reads workspace-root `AGENTS.md`. | No nested `AGENTS.md` discovery. |
| Skills | Skill roots in Pi ecosystem. | First-class skills. | Skills/plugins concepts. | `loadedSkills` exists in session metadata. | Skills are not loaded into prompt assembly. |
| Final response style | Concise CLI answer. | Product-specific. | Concise engineering summary. | Prompt asks for concise final summary with verification. | No structured final-response schema. |

## Compaction

| Area | Pi | OpenCode | Codex | Current Blip | Current Gaps |
| --- | --- | --- | --- | --- | --- |
| Compaction model | Runtime compaction support. | Anchored summary prompt and latest-summary-plus-tail context. | First-class compaction lifecycle, local/remote paths, hooks. | Local anchored compaction with manual and automatic triggers. | No remote/provider-native compaction. |
| Summary generation | Model summary and update behavior in reference implementation. | Anchored summary update. | Remote/local replacement histories. | Active model summary first, deterministic fallback if model summary fails. | Fallback can miss nuance. |
| Context reconstruction | Summary message plus retained entries. | Latest compaction plus messages after it. | Replacement history. | `readModelMessages()` returns summary plus retained tail. | Corrupt boundary falls back to raw transcript. |
| Boundary selection | Token-aware boundaries. | Tail turns and token budgets. | Context manager and replacement history. | Keeps recent user turns and expands backward by whole turns while under token budget. | No split-turn prefix summaries. |
| Events | Runtime support. | Session events. | Protocol events/analytics. | `compaction_started`, `compaction_completed`, `compaction_skipped`. | No compaction analytics beyond event fields. |

## Integration Surface

| Area | Pi | OpenCode | Codex | Current Blip | Current Gaps |
| --- | --- | --- | --- | --- | --- |
| Plugins | Not core to simple CLI. | Strong plugin direction. | MCP/plugins concepts. | No plugin system. | No MCP/plugin tool loading. |
| Subagents | Not core to simple CLI. | Task/subagent features. | Delegation concepts. | No subagents. | Single-agent runtime only. |
| Remote execution | Not core to local CLI. | Broader architecture. | App/server concepts. | Local CLI only. | No remote workspace adapter. |
| DroneHub/VoiceStream | External integrations possible. | Not directly relevant. | Not directly relevant. | No built-in integration. | CLI plus JSONL is the only integration surface. |

## Current Gaps Summary

- No OS-level sandboxing.
- No per-command approvals.
- No TUI.
- No server/app protocol.
- No nested `AGENTS.md` support.
- No skill loading in prompt assembly.
- No plugin system.
- No subagents.
- No remote execution.
- No remote/provider-native compaction.
- No split-turn compaction summaries.
- No built-in DroneHub or VoiceStream integration.

## Local Research References

- Pi: `.research/coding-agents/pi`
- OpenCode: `.research/coding-agents/opencode`
- Codex: `.research/coding-agents/codex`
