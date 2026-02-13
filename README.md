# drone monorepo

A Bun + Turborepo monorepo for running and managing **agent-enabled “drone” containers**.

- **`dvm`** (`apps/dvm`): CLI for managing Docker containers as “VM-like” machines, including tmux-backed persistent sessions and optional agent setup.
- **`drone`** (`apps/drone`): host CLI + in-container daemon that exposes a local REST API for controlling processes/sessions inside a container (implemented on top of `dvm`).
- **`drone-hub`** (`apps/drone-hub`): web UI for listing/grouping drones and interacting with them (Vite/React).
- **`looped`** (`apps/looped`): scaffolded minimal loop harness wrapper for repeatedly running an agentic CLI prompt.

## Repo layout

- **`apps/dvm/`**: DVM CLI and scripts
- **`apps/drone/`**: Drone CLI + daemon
- **`apps/drone-hub/`**: Drone Hub UI
- **`apps/looped/`**: Looped CLI scaffold

## Prerequisites

- **Bun** (repo is pinned to `bun@1.2.23` via `package.json`)
- **Node.js** \(>= 18\) for the built CLIs
- **Docker** (local daemon)

## Installation

From the repo root:

```bash
# install workspace dependencies
bun install

# build all apps (outputs to apps/*/dist)
bun run build
```

## Quickstart (run)

After installation:

```bash
# dvm
node apps/dvm/dist/cli.js --help

# drone
node apps/drone/dist/cli.js --help

# looped
node apps/looped/dist/cli.js --help
```

Typical flow:

```bash
# create a drone container + start its daemon + register it locally
node apps/drone/dist/cli.js create <name>

# start the Hub UI/API (detached)
node apps/drone/dist/cli.js hub
```

Drone Hub UI-only development (Vite dev server):

```bash
bun run drone-hub
```

## Development

Common monorepo commands:

```bash
# run all dev tasks in parallel (no caching)
bun run dev

# lint / format across all workspaces
bun run lint
bun run format
```

Run a single app in dev mode:

```bash
# dvm dev (ts-node)
bun run dvm -- --help

# drone dev (ts-node)
bun run drone -- --help

# looped dev (ts-node)
bun run looped -- --help
```

## Notes on security

The `drone` daemon is effectively **remote code execution inside a container**. It uses a **per-drone Bearer token** and is intended to be bound to localhost by default.

For details, see `apps/drone/README.md`.

## More documentation

- **Drone**: `apps/drone/README.md`
- **DVM**: `apps/dvm/README.md`
- **Drone Hub UI**: `apps/drone-hub/README.md`
- **Looped**: `apps/looped/README.md`
