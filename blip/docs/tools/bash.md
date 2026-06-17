# bash

`bash` runs a non-interactive shell command in the local workspace.

## Availability

Profile:

- `local-trusted-write`

It is not available in `read-only` or `no-shell-workspace-write`.

## Parameters

```ts
{
  command: string;
  cwd?: string;
  timeoutMs?: number;
}
```

- `cwd` is workspace-relative and defaults to the workspace root.
- `timeoutMs` defaults to 120 seconds and is capped at 30 minutes.

## Behavior

- Executes `bash -lc <command>`.
- Captures stdout and stderr.
- Truncates long stdout/stderr in the returned result.
- Returns exit code, timeout state, cwd, stdout, stderr, and truncation flags.

## Safety Notes

`bash` is a trusted local CLI capability. It is not OS-sandboxed and does not have a per-command approval flow.

Structured tools enforce workspace paths. `bash` does not provide that same proof of containment.

## Current Gaps

- No command allowlist or denylist.
- No approval prompt.
- No OS sandbox.
- No read-only shell mode.
