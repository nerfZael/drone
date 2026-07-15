# transfer_files

`transfer_files` copies a file or folder between two different workspace targets.

It is exposed only when a session has more than one target, at least one readable source, and at least one writable destination. The source needs `files.read`; the destination needs `files.write`. Write access does not imply read access.

## Parameters

- `sourceTarget`: source target id from `list_targets`
- `sourcePath`: workspace-relative file or folder
- `destinationTarget`: destination target id from `list_targets`
- `destinationPath`: exact workspace-relative destination path
- `overwrite`: optional; defaults to `false`
- `resumeToken`: optional token returned by a partially completed transfer

## Transfer behavior

- Files are streamed in bounded, binary-safe chunks.
- Folders are scanned first so total file and byte counts are known.
- Transient failures are retried up to five times with exponential backoff.
- Chunk writes and final commits are idempotent, so a lost response can be retried safely.
- Files are written to a temporary sibling and atomically moved into place after the expected size is present.
- The source size and modification time are checked again before commit.
- Progress events include overall bytes, per-file bytes, retry counts, and file status.
- Successful model-visible results contain only aggregate counts and bytes.
- Failed results keep the full manifest in UI details and return a compact resume token to the model. Repeating the same transfer with that token validates the current plan and skips files already committed.
- A single transfer is limited to 500 files and 1,000 directories to keep scanning, progress events, and chat rendering bounded.

## Existing destinations and partial transfers

- `overwrite` defaults to `false`. An existing destination file stops the transfer at that file.
- A folder transfer merges into an existing destination folder. Unrelated destination entries remain untouched.
- With `overwrite: true`, only conflicting files are replaced. Existing files that are not part of the source remain untouched.
- A file-versus-folder conflict fails instead of deleting the destination tree.
- Folder transfers are committed one file at a time, so they are not all-or-nothing. Files committed before a later failure remain in place.
- A resume token identifies the exact source, destination, current source plan, and committed file prefix. A write-only destination cannot verify that the committed prefix was later changed or deleted, so resuming assumes those files still exist.
