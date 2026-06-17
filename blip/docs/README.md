# Blip Docs

Blip is a standalone CLI coding agent.

## Planning

- [Design Matrix](design-matrix.md)
- [Sessions, Threads, Chats, And Conversations](sessions.md)
- [Runtime Events And JSONL](runtime-events.md)
- [Permissions And Sandboxing](permissions.md)
- [Prompts And Repository Instructions](prompts-and-instructions.md)
- [Context Compaction](compaction.md)

## Tool Docs

These docs describe tool capabilities. Blip should expose a smaller model-facing tool set for each run based on the active profile in [Permissions And Sandboxing](permissions.md).

- [`list_files`](tools/list-files.md)
- [`search_files`](tools/search-files.md)
- [`read_file`](tools/read-file.md)
- [`write_file`](tools/write-file.md)
- [`apply_patch`](tools/apply-patch.md)
- [`bash`](tools/bash.md)
- [`delete_file`](tools/delete-file.md)
- [`create_directory`](tools/create-directory.md)
- [`delete_directory`](tools/delete-directory.md)
- [`move_path`](tools/move-path.md)
- [`get_working_tree_status`](tools/get-working-tree-status.md)
