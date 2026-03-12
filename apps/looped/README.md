# looped

`looped` is a minimal harness wrapper for agentic CLIs.

## Installation

From the monorepo root:

```bash
# install dependencies (one-time per repo clone)
bun install

# build looped
bun run --cwd apps/looped build

# install `looped` into your shell PATH
cd apps/looped && npm link

# verify
looped --help
```

## Goal

Run an agentic CLI with a prompt, then run it again and again in a loop.

Planned behavior:
1. Accept prompt text from `--prompt`, `--file`, or stdin.
2. Execute one configured CLI command with that prompt.
3. Stream output.
4. Exit cleanly if output contains terminate token (default: `TERMINATE`).
5. Otherwise, run the same prompt again.
6. Enforce timeout per iteration (default: 30 minutes).

This behavior is now implemented.

## Current CLI shape

```bash
looped [options]
```

Options:
- `-p, --prompt <text>`: prompt text to run
- `--file <path>`: read prompt from file
- `--prompt-stdin`: read prompt from stdin
- `-t, --timeout <duration>`: timeout per iteration (supports `ms`, `s`, `m`, `h`, `d`)
- `--terminate <token>`: termination marker to look for in output (default: `TERMINATE`)
- `--agent <id>`: builtin agent preset to use when `--cli` is not provided (`cursor`, `codex`, `claude`, `opencode`; default: `cursor`)
- `--chat-mode <mode>`: conversation reuse mode (`continue`, `fresh`; default: `continue`)
- `-f, --fresh`: shortcut for `--chat-mode fresh`
- `--cli <command>`: explicit agentic CLI command to run per iteration; overrides `--agent`

`--cli` behavior:
- If command contains `{prompt}`, that placeholder is replaced with a safely quoted prompt.
- Otherwise, prompt is appended as the final argument.

Builtin agent defaults:
- `cursor`: `agent -f --approve-mcps --print`
- `codex`: `codex exec --skip-git-repo-check --color never`
- `claude`: `claude --print --dangerously-skip-permissions --output-format text`
- `opencode`: `opencode run --format default`

Conversation modes:
- `continue`: reuse the same chat/session across iterations when supported
- `fresh`: current one-shot behavior; start fresh each iteration

Current support:
- builtin `cursor`: `continue` is supported and uses the same Cursor chat across iterations
- builtin `codex`: `continue` is supported and reuses the same Codex thread across iterations
- builtin `claude`, `opencode`: currently fall back to `fresh`
- explicit `--cli`: currently falls back to `fresh`

Env overrides:
- `LOOPED_AGENT`: default builtin agent when `--agent` is omitted
- `LOOPED_CHAT_MODE`: default chat mode when `--chat-mode` is omitted
- `LOOPED_AGENT_CMD`: generic fallback command override for `cursor`
- `LOOPED_CURSOR_CMD`, `LOOPED_CODEX_CMD`, `LOOPED_CLAUDE_CMD`, `LOOPED_OPENCODE_CMD`: per-agent overrides
- `DRONE_HUB_*_CMD` env vars are also respected as fallbacks for parity with the drone setup

## Examples

```bash
# prompt from --prompt
looped --prompt "Summarize this repo and propose 3 improvements."

# prompt from -p
looped -p "Summarize this repo and propose 3 improvements."

# prompt from file
looped --file ./prompt.txt

# prompt from stdin
cat ./prompt.txt | looped --prompt-stdin

# override timeout (15 min)
looped -p "Do one pass." --timeout 900000

# use -t alias for timeout
looped -p "Do one pass." -t 900000

# human-readable timeout values
looped -p "Do one pass." -t 10m
looped -p "Do one pass." --timeout 5s
looped -p "Do one pass." --timeout 100ms
looped -p "Do one pass." --timeout 3.4h
looped -p "Do one pass." --timeout 2d

# custom terminate token
looped -p "Do one pass." --terminate STOP_NOW

# select Codex without writing the full command
looped -p "Do one pass." --agent codex

# force the old one-shot behavior
looped -p "Do one pass." --chat-mode fresh
looped -p "Do one pass." -f

# select Codex via env for all runs in this shell
export LOOPED_AGENT=codex
looped -p "Do one pass."

# custom CLI with explicit prompt placeholder
looped -f ./prompt.txt --cli "codex exec {prompt}"

# command that exits immediately when TERMINATE appears
looped -p "ignored by this example" --cli "node -e \"console.log('TERMINATE')\""
```

## Development

From repo root:

```bash
bun run --cwd apps/looped build
bun run --cwd apps/looped dev -- --help
```
