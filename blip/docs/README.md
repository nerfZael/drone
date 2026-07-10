# Blip Docs

These docs describe the Blip implementation in this repository.

Blip is a local CLI coding agent built from three workspace packages:

- `@blip/tools`: workspace-safe tools and tool profiles.
- `@blip/core`: sessions, runtime events, prompt assembly, and compaction.
- `@blip/cli`: the command-line interface.

## Core Documents

- [Design Matrix](design-matrix.md)
- [Drone Hub Assistant Integration Plan](drone-hub-assistant-integration-plan.md)
- [Drone Hub Assistant Contract Baseline](drone-hub-assistant-contract-baseline.md)
- [Permissions And Sandboxing](permissions.md)
- [Prompts And Instructions](prompts-and-instructions.md)
- [Runtime Events And JSONL](runtime-events.md)
- [Sessions](sessions.md)
- [Context Compaction](compaction.md)

## Tool Documents

Tool availability depends on the active profile. The default trusted local profile exposes a small set: `bash`, `apply_patch`, `read_file`, `search_files`, and `list_files`. The no-shell write profile exposes structured filesystem mutation tools instead of `bash`.

- [bash](tools/bash.md)
- [apply_patch](tools/apply-patch.md)
- [read_file](tools/read-file.md)
- [search_files](tools/search-files.md)
- [list_files](tools/list-files.md)
- [write_file](tools/write-file.md)
- [delete_file](tools/delete-file.md)
- [create_directory](tools/create-directory.md)
- [delete_directory](tools/delete-directory.md)
- [move_path](tools/move-path.md)
- [get_working_tree_status](tools/get-working-tree-status.md)
