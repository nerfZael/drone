# drone

`drone` is a small system for managing **one container per drone**, where each container exposes a **local REST API** that lets the host:

- start a terminal program (interactive CLI, REPL, etc.) under `tmux`
- send text / keys
- stream output incrementally
- query status

This repo’s `drone` implementation uses **`dvm` for container/session management** (it does not call Docker directly).

## Pieces

- **Host CLI**: `apps/drone/dist/cli.js` (command: `drone`)
- **Daemon (inside container)**: `apps/drone/dist/daemon.js` (runs an HTTP server)

## Security

The daemon is essentially remote code execution. It uses a **single Bearer token** per drone:

- token is stored in the container at `/dvm-data/drone/token`
- token is stored on the host in the drone registry file (OS-specific app data location; chmod 600 on Unix)

By default the host talks to `http://127.0.0.1:<hostPort>`.

## HTTP timeouts

Host → daemon requests use a per-request timeout (default: **5000ms**). You can override it with:

```bash
export DRONE_HTTP_TIMEOUT_MS=15000
```

## How `drone create` works (MVP)

`drone create <name>` does:

1. Allocate **free host ports** (daemon + GUI ports) so container creation doesn’t fail from collisions.
2. `dvm create <name> --ports <host:container,...>`
3. Write token into container (`/dvm-data/drone/token`)
4. Copy daemon JS into container persistence (`/dvm-data/drone/daemon.js`) using `dvm script`
5. Start the daemon as a persistent session (`dvm session start <name> drone-daemon -- ...`)
6. Poll `/v1/health` until ready
7. Save host registry entry in the drone registry file

### Published ports

`drone create` publishes these container ports to **random free host TCP ports**:

- Daemon API: **7777/tcp** by default (configurable via `--container-port`)
- GUI: **3389/tcp** (RDP) and **6080/tcp** (noVNC)
- Common dev servers: **3000/tcp**, **3001/tcp**, **5173/tcp**, **5174/tcp**

## Commands (current)

From repo root:

```bash
# Build the CLI + daemon.
# Note: `drone` shells out to `dvm` (see "dvm discovery" below), so you'll also need apps/dvm built.
cd apps/drone && bun run build

# create container + start daemon + save registry entry
node apps/drone/dist/cli.js create drone-test4 --group dev --repo "$PWD" --container-port 7777

# Set a default working directory inside the container (and create it):
node apps/drone/dist/cli.js create drone-test4 --group dev --repo "$PWD" --container-port 7777 --cwd /dvm-data/work --mkdir

# if a container/daemon already exists, register it into local registry
# (reads token from /dvm-data/drone/token, then checks /v1/health)
node apps/drone/dist/cli.js import drone-test4 --group dev --container-port 7777 --repo "$PWD"

# list groups (and ungrouped drones)
node apps/drone/dist/cli.js groups

# reassign a drone into a different group
node apps/drone/dist/cli.js group-set drone-test4 staging
# (alias: set-group)

# clear a group assignment (move back to "Ungrouped" in the Hub)
node apps/drone/dist/cli.js group-clear drone-test4
# (alias: ungroup)

# register a host repo in the registry (for the Hub UI)
node apps/drone/dist/cli.js repo "$PWD"

# list and query
node apps/drone/dist/cli.js ps
node apps/drone/dist/cli.js ps --group dev
node apps/drone/dist/cli.js ps --ungrouped
node apps/drone/dist/cli.js status drone-test4

# start an interactive process in the container (requires `--` for the command)
node apps/drone/dist/cli.js proc-start drone-test4 --session drone-main --force -- bash

# run a one-shot command and stream output (proc-start + follow)
node apps/drone/dist/cli.js run drone-test4 --session drone-main --force --until "DONE" --timeout-ms 600000 -- bash -lc 'echo hello; echo DONE'

# Cursor Agent: persistent multi-turn (recommended)
#
# This stores a chatId in the drone registry file and uses `agent --resume <chatId>` for each turn.
node apps/drone/dist/cli.js agent drone-test4 "Summarize the repo."
node apps/drone/dist/cli.js agent drone-test4 "Now propose 3 small PR ideas."

# You can also supply prompts via a file or stdin (helps avoid shell quoting issues):
node apps/drone/dist/cli.js agent drone-test4 --prompt-file ./prompt.txt
cat ./prompt.txt | node apps/drone/dist/cli.js agent drone-test4 --prompt-stdin

# Cursor Agent: one-shot (niche)
#
# No persisted history; this is mainly useful for scripted/isolated prompts.
node apps/drone/dist/cli.js agent-once drone-test4 "What is 2+3?"

# send text input, then follow output
node apps/drone/dist/cli.js send drone-test4 "echo DRONE_OK"
# (use --no-enter to type without pressing Enter)
node apps/drone/dist/cli.js follow drone-test4 --until "DRONE_OK" --timeout-ms 30000

# send key chords (space-separated)
node apps/drone/dist/cli.js keys drone-test4 ctrl+c

# read output as JSON chunks (manual polling)
node apps/drone/dist/cli.js output drone-test4 --since 0 --max 65536

# stop the tmux session running the process
node apps/drone/dist/cli.js proc-stop drone-test4 --session drone-main

# inspect/reset persisted agent chats (host-side)
node apps/drone/dist/cli.js agent-chats drone-test4
node apps/drone/dist/cli.js agent-chats drone-test4 --chat default
node apps/drone/dist/cli.js agent-chats drone-test4 --chat default --turn last
node apps/drone/dist/cli.js agent-chats drone-test4 --chat default --turn all
node apps/drone/dist/cli.js agent-reset drone-test4 --chat default

# run an arbitrary command inside the drone container (no need to call dvm directly)
node apps/drone/dist/cli.js exec drone-test4 -- ls -la /dvm-data/drone

# remove a single drone/container (also removes from registry)
node apps/drone/dist/cli.js rm drone-test4
# keep container persistence volume
node apps/drone/dist/cli.js rm drone-test4 --keep-volume

# fast rename (container + drone registry entry)
node apps/drone/dist/cli.js rename drone-test4 drone-test4-new

# optional: also migrate persistence volume name to dvm-<new>-data (slower)
node apps/drone/dist/cli.js rename drone-test4 drone-test4-new --migrate-volume-name

# remove all drones/containers
# - dry-run unless --apply
# - default targets are drones listed in the drone registry file
# - --orphans also scans running containers and includes ones that look like drones
node apps/drone/dist/cli.js purge --orphans
node apps/drone/dist/cli.js purge --orphans --apply
node apps/drone/dist/cli.js purge --orphans --apply --keep-volume

# start the local Drone Hub (detached by default)
node apps/drone/dist/cli.js hub

# explicitly manage the detached Hub
node apps/drone/dist/cli.js hub start --port 5174 --api-port 0 --host 127.0.0.1
node apps/drone/dist/cli.js hub stop
node apps/drone/dist/cli.js hub restart
```

### Drone Hub grouping

The Drone Hub sidebar shows drones **grouped into folder-like sections by default** (using each drone’s `group` in the drone registry file). You can toggle to a **flat list** using the switch in the sidebar header.

## `dvm` discovery

By default, `drone` runs `dvm` by executing the monorepo build:

- `node apps/dvm/dist/cli.js ...`

If you want `drone` to use a different `dvm` entrypoint, set:

```bash
export DVM_CLI_PATH=/path/to/dvm/cli.js
```
