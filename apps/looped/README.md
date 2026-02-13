# looped

`looped` is a minimal harness wrapper for agentic CLIs.

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
- `-f, --file <path>`: read prompt from file
- `--prompt-stdin`: read prompt from stdin
- `-t, --timeout <duration>`: timeout per iteration (supports `ms`, `s`, `m`, `h`, `d`)
- `--terminate <token>`: termination marker to look for in output (default: `TERMINATE`)
- `--cli <command>`: agentic CLI command to run per iteration (default: `agent -f --approve-mcps --print`)

`--cli` behavior:
- If command contains `{prompt}`, that placeholder is replaced with a safely quoted prompt.
- Otherwise, prompt is appended as the final argument.

## Examples

```bash
# prompt from --prompt
looped --prompt "Summarize this repo and propose 3 improvements."

# prompt from -p
looped -p "Summarize this repo and propose 3 improvements."

# prompt from file
looped --file ./prompt.txt

# prompt from -f
looped -f ./prompt.txt

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

# custom CLI command (future execution step)
looped -p "Do one pass." --cli codex

# custom CLI with explicit prompt placeholder
looped -f ./prompt.txt --cli "codex run --print --prompt {prompt}"

# command that exits immediately when TERMINATE appears
looped -p "ignored by this example" --cli "node -e \"console.log('TERMINATE')\""
```

## Development

From repo root:

```bash
bun run --cwd apps/looped build
bun run --cwd apps/looped dev -- --help
```
