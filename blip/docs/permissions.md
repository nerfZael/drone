# Blip Permissions And Sandboxing

## Purpose

Permissions define what Blip is allowed to do. Sandboxing defines what the operating environment technically prevents Blip from doing.

They are related, but not the same:

- **Permission mode** is Blip's product/runtime policy.
- **Sandboxing** is an enforcement mechanism.

Blip v1 should start with clear permission modes and path-safe workspace enforcement. OS-level sandboxing can come later.

## V1 Permission Modes

| Mode | Meaning | Capability Boundary |
| --- | --- | --- |
| `read-only` | Blip can inspect the workspace but cannot change files. | Inspection tools only. No bash. |
| `workspace-write` | Blip can inspect and mutate files inside the workspace root. | Mutation tools are allowed. Local CLI bash is allowed when the environment provides it. |
| `full-access` | Future mode for broader filesystem and network access controls. | Deferred |

Default recommendation:

- Interactive local CLI: `workspace-write`
- Review/audit mode: `read-only`
- Hosted or assistant-driven integration: start with `read-only` or approval-gated `workspace-write`

## V1 Tool Profiles

Permission mode says what Blip is allowed to do. A tool profile says which capabilities are actually shown to the model for a specific run.

Blip v1 should keep the model-facing tool set small. Do not expose every implemented tool by default.

| Profile | Use Case | Model-Facing Tools |
| --- | --- | --- |
| `local-trusted-write` | Normal local CLI coding work. | `bash`, `apply_patch`, `read_file`, `search_files`, `list_files` |
| `read-only` | Review, audit, or untrusted inspection. | `read_file`, `search_files`, `list_files`, `get_working_tree_status` |
| `no-shell-workspace-write` | Browser, hosted, remote, or filesystem-adapter contexts where bash is unavailable. | `apply_patch`, `read_file`, `search_files`, `list_files`, `write_file`, `delete_file`, `create_directory`, `delete_directory`, `move_path`, `get_working_tree_status` |

Structured tools like `write_file`, `delete_file`, `create_directory`, `delete_directory`, `move_path`, and `get_working_tree_status` are still v1 capabilities. They should be hidden from the default local bash profile because bash and `apply_patch` cover those workflows and fewer tools makes model choice simpler.

## V1 Enforcement

Blip v1 should enforce:

- All file paths resolve inside the workspace root.
- File tools reject absolute paths unless they are explicitly normalized into the workspace.
- Mutating tools are unavailable in `read-only`.
- Tool registration uses the active tool profile, not one global v1 tool list.
- Recursive directory deletion is treated as more sensitive than normal file edits.
- Local CLI `bash` has no separate per-command approval flow in v1.
- `bash` starts in the workspace root by default, but v1 does not claim OS-level containment for shell commands.

This is not a full OS sandbox. It is a path-safe workspace boundary.

## Shell Permissions

`bash` is included in v1 for the local CLI. It should be treated as a trusted local developer capability, not as a sandbox boundary.

Blip v1 should not add a separate shell permission or approval model. If a local CLI session uses the `local-trusted-write` profile, `bash` is available. If a session is `read-only`, hosted, browser-based, or otherwise untrusted, `bash` should not be exposed until stronger controls exist.

Likely future shell modes are:

- `shell:none`: no shell tool
- `shell:read-only`: allow a narrow set of inspection commands
- `shell:approval`: ask before shell commands
- `shell:trusted`: run shell commands inside an OS sandbox or trusted local environment

### Read-Only Shell

A read-only shell is possible, but it is hard to guarantee safely.

Examples of commands that look read-only:

- `pwd`
- `ls`
- `find`
- `rg`
- `cat`
- `sed -n`
- `git status`
- `git diff`

The problem is that shell commands are composable. A command can look harmless and still write files, access the network, leak secrets, or run another program.

Examples:

- `cat file > other-file`
- `sed -i ...`
- `git diff | curl ...`
- `node -e "require('fs').writeFileSync(...)"`
- `python -c "..."`

So a real read-only shell needs one of these:

- an OS sandbox that denies writes and network access
- a command parser with a strict allowlist
- a custom non-shell tool for each inspection workflow

Blip v1 should choose custom tools instead of read-only shell. That is why `list_files`, `search_files`, `read_file`, and `get_working_tree_status` exist. Bash can still be available in the `local-trusted-write` profile because that profile already allows mutation.

## Web And Hosted Environments

In a browser or web-only environment, there may be no OS shell at all.

That means Blip's core should not require shell. The file tools should be written behind a workspace/filesystem interface so they can run against:

- local Node filesystem
- future desktop app filesystem bridge
- future server-side workspace
- future remote workspace adapter

Shell should be an optional local CLI capability, not a core runtime assumption.

## Comparison

### Pi

Pi has simple local CLI assumptions and can expose bash. Its file tools are also pluggable, which leaves room for non-local filesystems.

Blip should adopt the simple CLI posture and include bash in v1, while still keeping structured file tools and permission modes explicit.

### OpenCode

OpenCode has a stronger permission model around tools. Tools can ask for permission with metadata, and runtime services can enforce external-directory checks.

Blip should adapt that idea by making permissions explicit early, but without bringing in the full runtime complexity.

### Codex

Codex has the strongest sandbox/approval model. It can combine command approval, filesystem sandbox policy, network policy, and patch safety checks.

Blip should learn from this, but not try to recreate it in v1. OS sandboxing is a later layer.

## Blip Choice

Blip v1 should implement permission modes, profile-based tool exposure, and path-safe workspace enforcement. It should include local CLI bash in the trusted local write profile, and defer OS-level sandboxing and shell approvals.

This means the design matrix status is mixed:

- **Adapt** for the permission model and workspace boundary.
- **Adapt** for profile-based tool exposure.
- **Adapt** for local CLI bash.
- **Defer** for OS sandboxing and shell approval modes.

## Open Questions

- Should `workspace-write` be the default for local interactive CLI?
- Should recursive directory deletion require a separate confirmation in local CLI?
- Should read-only shell ever exist, or should Blip keep using explicit inspection tools for read-only sessions?
- Which OS sandbox should Blip use first for stronger shell containment: platform-native sandboxing, containers, or both?
