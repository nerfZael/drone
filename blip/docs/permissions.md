# Permissions And Tool Profiles

Blip has explicit permission modes and tool profiles. The current implementation enforces workspace-relative path safety for structured filesystem tools. It does not provide OS-level sandboxing.

## Permission Modes

Implemented modes:

| Mode | Meaning |
| --- | --- |
| `read-only` | Inspection-only mode. The CLI requires the `read-only` tool profile. |
| `workspace-write` | Structured tools may mutate files inside the workspace. |
| `full-access` | Accepted by the CLI type model, but current structured tools still enforce workspace paths. |

`full-access` does not currently remove workspace path checks from structured tools.

## Tool Profiles

Implemented profiles:

| Profile | Tools |
| --- | --- |
| `local-trusted-write` | `bash`, `apply_patch`, `read_file`, `search_files`, `list_files` |
| `read-only` | `read_file`, `search_files`, `list_files`, `get_working_tree_status` |
| `no-shell-workspace-write` | `apply_patch`, `read_file`, `search_files`, `list_files`, `write_file`, `delete_file`, `create_directory`, `delete_directory`, `move_path`, `get_working_tree_status` |

The default profile is chosen by `defaultToolProfile()`:

- `read-only` mode uses the `read-only` profile.
- Other modes use `local-trusted-write` when shell is available.
- Other modes use `no-shell-workspace-write` when shell is unavailable.

## Bash

`bash` is available only in `local-trusted-write`.

Current behavior:

- Runs `bash -lc <command>`.
- Starts in the workspace root unless `cwd` is provided.
- Allows a workspace-relative `cwd`.
- Has a timeout, defaulting to 120 seconds and capped at 30 minutes.
- Captures and truncates stdout/stderr.

Important limitation: `bash` is not OS-sandboxed. A shell command can do more than the structured tools can prove safe. The profile name is intentional: this is for trusted local developer workflows.

## Structured Tool Safety

Structured filesystem tools use workspace path checks through `assertWorkspacePath()`.

They reject path traversal outside the workspace. They also report file operations back to the runtime so sessions can track read and changed files.

## Current Gaps

- There is no per-command approval flow.
- There is no OS-level shell sandbox.
- `full-access` is not meaningfully different from `workspace-write` for structured tools yet.
- Hosted/browser/untrusted execution profiles are not implemented.
- Delete and recursive directory operations do not have stronger confirmation behavior beyond profile selection.
