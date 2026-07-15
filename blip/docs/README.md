# Blip Docs

These docs describe the Blip implementation in this repository.

Blip is a portable session runtime with platform-specific hosts:

- `@blip/core`: platform-neutral sessions, events, persistence contracts, and compaction.
- `@blip/core/node`: explicit Node storage, local runtime, Git, and process diagnostics.
- `@blip/workspace`: platform-neutral workspace target contracts and selection.
- `@blip/tools`: Node local coding tools and workspace-tool composition.
- `@blip/cli`: the Node CLI host and its prompt/instruction policy.

## Core Documents

- [Design Matrix](design-matrix.md)
- [Drone Hub Assistant Integration Plan](drone-hub-assistant-integration-plan.md)
- [Drone Hub Assistant Contract Baseline](drone-hub-assistant-contract-baseline.md)
- [Permissions And Sandboxing](permissions.md)
- [Prompts And Instructions](prompts-and-instructions.md)
- [Runtime Events And JSONL](runtime-events.md)
- [Sessions](sessions.md)
- [Context Compaction](compaction.md)
- [Platform Boundaries](platform-boundaries.md)

## Tool Documents

Tool availability depends on the active profile. The default trusted local profile exposes a small set: `bash`, `apply_patch`, `read_file`, `search_files`, and `list_files`. The no-shell write profile exposes structured filesystem mutation tools instead of `bash`.

- [bash](tools/bash.md)
- [apply_patch](tools/apply-patch.md)
- [read_file](tools/read-file.md)
- [transfer_files](tools/transfer-files.md)
- [search_files](tools/search-files.md)
- [list_files](tools/list-files.md)
- [write_file](tools/write-file.md)
- [delete_file](tools/delete-file.md)
- [create_directory](tools/create-directory.md)
- [delete_directory](tools/delete-directory.md)
- [move_path](tools/move-path.md)
- [get_working_tree_status](tools/get-working-tree-status.md)
