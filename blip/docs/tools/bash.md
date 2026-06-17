# `bash`

## Purpose

`bash` runs a shell command for the local Blip CLI.

It is included in v1 because coding agents need normal developer commands for setup, tests, builds, git inspection, and one-off repository investigation. It is a trusted local CLI capability, not a sandbox boundary.

## Tool Profile

`bash` is part of the default local trusted write profile. That profile should stay small: `bash`, `apply_patch`, `read_file`, `search_files`, and `list_files`.

Do not expose redundant structured mutation and git tools in that profile unless a UI or integration specifically needs their metadata.

## Schema

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "Command to run with bash."
    },
    "cwd": {
      "type": "string",
      "description": "Optional workspace-relative working directory. Defaults to the workspace root."
    },
    "timeoutMs": {
      "type": "integer",
      "minimum": 1000,
      "description": "Optional command timeout in milliseconds."
    }
  },
  "required": ["command"],
  "additionalProperties": false
}
```

## Behavior

- Resolve `cwd` inside the workspace root.
- Start in the workspace root when `cwd` is omitted.
- Run the command through non-interactive bash.
- Return exit code, stdout, stderr, timeout status, and bounded output.
- Do not add a separate per-command approval prompt in v1.
- Do not expose bash in `read-only`, hosted, browser-only, or otherwise untrusted contexts until stronger controls exist.

## Safety Notes

Blip v1 has permission modes and path-safe file tools, but it does not have OS-level shell sandboxing.

That means `bash` can do more than the structured file tools can prove safe. The local CLI should treat `bash` as part of the `local-trusted-write` profile: useful and expected for a developer running Blip on their own machine, but not safe enough to call a read-only capability.

Future versions can add shell approval modes, OS sandboxing, containers, or stricter command policies.

## Blip Choice

Blip includes `bash` in v1 for the local CLI.

Why this differs from a shell-free design:

- Builds, tests, package scripts, and git workflows often need normal commands.
- Replacing every workflow with a custom tool would slow v1 down.
- The existing v1 permission model can say when bash is exposed without pretending it is sandboxed.

Pros:

- Matches developer expectations for a coding agent.
- Keeps verification practical.
- Avoids overbuilding one custom tool for every command-line workflow.

Cons:

- Not safe as a read-only tool without stronger containment.
- Output can be noisy and platform-dependent.
- Future hosted or remote modes need stricter controls before enabling it.
