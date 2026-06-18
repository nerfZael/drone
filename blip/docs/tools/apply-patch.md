# apply_patch

`apply_patch` applies targeted file changes inside the workspace.

It is Blip's preferred edit tool for normal code changes.

## Availability

Profiles:

- `local-trusted-write`
- `no-shell-workspace-write`

It is not available in `read-only`.

## Patch Format

The tool accepts a strict patch envelope:

```text
*** Begin Patch
*** Add File: path
+new line
*** Update File: path
@@
 old line
-removed line
+added line
*** Delete File: path
*** End Patch
```

Supported operations:

- `Add File`
- `Update File`
- `Delete File`
- `Move to`

## Behavior

- All paths are workspace-relative.
- Parent directories are created for added files and moves.
- Updates require matching context.
- Missing update context errors include the expected context and nearby matching file content when available.
- Modified files are reported to the runtime for session metadata.

## Current Gaps

- No formatter or LSP integration runs automatically after patching.
- No approval flow exists for large or risky patches.
- Exact replacement edits are not a separate tool.
