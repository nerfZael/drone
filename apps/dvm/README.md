# dvm - Docker VM CLI

A CLI tool for easily spinning up Docker containers that act as isolated "machines". Containers can communicate with each other through exposed ports on the host machine.

## Installation

From the monorepo root:

```bash
# install dependencies (one-time per repo clone)
bun install

# build dvm
bun --filter dvm run build

# install `dvm` into your shell PATH
npm link ./apps/dvm

# verify
dvm --help
```

## Usage

### Create a container

```bash
# Basic container
dvm create my-container --image ubuntu:latest

# With ports
dvm create my-container --image ubuntu:latest --ports 3000,8080

# Attach to a user-defined network (recommended for container-to-container traffic)
# Then other containers on that network can reach it by name (e.g. http://my-container:3000)
dvm create my-container --image ubuntu:latest --network dvm-net

# Create the network automatically if missing
dvm create my-container --image ubuntu:latest --network dvm-net --create-network

# With specific port mappings
dvm create my-container --image ubuntu:latest --ports 3000:3000,8080:8080

# With port ranges (ranges must be the same length when mapping host:container)
dvm create my-container --image ubuntu:latest --ports 8000-8005
dvm create my-container --image ubuntu:latest --ports 7000-7005:3000-3005

# Without persistence
dvm create my-container --image ubuntu:latest --no-persist

# With environment variables (e.g., API keys)
dvm create my-container --image ubuntu:latest --env KEY=value,OTHER=value

# With volume mounts
dvm create my-container --image ubuntu:latest --volume ./data:/app/data

# Using config file
dvm create my-container --config config.yaml

# Ignore configured base container (if one is set)
# (falls back to ubuntu:latest unless you pass --image or config.image)
dvm create my-container --no-base
```

### Ports (auto-allocation + GUI ports)

- **Auto-allocation**: if you specify a container port (e.g. `--ports 3000`) without `host:container`, dvm will **auto-allocate an available host port**.
- **GUI ports**: dvm ensures GUI ports are present and published for every container:
  - **3389/tcp** (XRDP / RDP clients)
  - **6080/tcp** (noVNC / browser)

To see the actual host mappings for any container:

```bash
dvm ports <name>
```

Port specs supported by `dvm create --ports` and `dvm expose`:

- **single container port**: `3000`
- **single mapping**: `8080:3000` (host 8080 -> container 3000)
- **ranges**: `8000-8005`
- **range mapping** (same length): `7000-7005:3000-3005`

### List containers

```bash
# List containers (running + stopped) (default)
dvm list

# Only show running containers
dvm list --running-only
```

### Start/Stop containers

```bash
dvm start <name>
dvm stop <name>

# Apply to all DVM containers
dvm start --all
dvm stop --all
```

### Pause/Unpause containers

`pause` freezes all processes in a running container (a true “pause”), and `unpause` resumes them.

```bash
dvm pause <name>
dvm unpause <name>

# Apply to all DVM containers
dvm pause --all
dvm unpause --all
```

### Rename containers

```bash
# Fast rename (keeps the same persistence volume/mounts)
dvm rename <oldName> <newName>

# Optional: also migrate persistence volume name to dvm-<newName>-data (slower)
dvm rename <oldName> <newName> --migrate-volume-name
```

### Remove containers

```bash
# Remove container completely (also removes dvm persistence volume)
dvm remove <name>

# Keep the current persistence volume attached to the container
dvm remove <name> --keep-volume
```

### Clone containers

```bash
# Clone filesystem state into a new container (volumes are not copied)
dvm clone <source> <name>

# Clone but don't start
dvm clone <source> <name> --no-start

# Also reuse named volumes from the source (besides dvm persistence)
dvm clone <source> <name> --reuse-named-volumes
```

### Export / import containers (archive)

`dvm export`/`dvm import` lets you move a container between machines (or make a backup) as a single archive.

```bash
# Export to an archive (image + dvm persistence volume)
dvm export <name> ./my-container.tar.gz

# Exclude the dvm persistence volume
dvm export <name> ./my-container.tar.gz --no-volume

# Import from an archive
dvm import ./my-container.tar.gz
```

### Snapshots (local)

Snapshots are just `dvm export` archives stored under the dvm data directory (`dvm snapshots` prints exact paths).

```bash
# Create a snapshot (name optional; default: timestamp)
dvm snapshot <name> [snapshotName]

# Exclude the dvm persistence volume
dvm snapshot <name> [snapshotName] --no-volume

# List snapshots for a container
dvm snapshots <name>

# Restore from latest snapshot (or a specific snapshot/archive)
dvm restore <name> [snapshotName]
```

### Expose ports for an existing container (recreates it)

`dvm expose` commits the current container filesystem to a temporary image, then recreates the container with additional published ports (existing ports are preserved).

```bash
# Expose additional ports using positional args
dvm expose <name> 3000 8080:8080

# Or using --ports (comma-separated)
dvm expose <name> --ports 3000,8080:8080

# Don't start after recreating
dvm expose <name> --ports 3000 --no-start
```

### Container information

```bash
# Show container details
dvm info <name>

# View logs
dvm logs <name>

# Execute command in container
dvm exec <name> ls -la

# Copy files in/out
dvm copy <name> ./local/path /container/path
dvm download <name> /container/path ./local/path

# Run a local script file inside a container (copies to /tmp, runs, cleans up)
dvm script <name> ./setup.sh -- --flag value

# Open an interactive shell in a container
dvm ssh <name>

# Open an editor attached to the container (Dev Containers style; falls back to shell)
dvm code <name> [/]
dvm cursor <name> [/]

# List ports
dvm ports <name>
```

### Persistent interactive sessions (non-interactive)

Some environments (CI/services) can’t allocate a real TTY, but you still may want to keep a long-lived “interactive” CLI running and drive it over time. `dvm session` solves this by running the program inside `tmux` **inside the container**, then proxying input/output via normal commands.

```bash
# Create/start a container and start a session with the same name
# (use `--` before command args that start with --)
dvm session up <name> -- bash

# Start a persistent session (use `--` before command args that start with --)
dvm session start <name> my-session -- bash

# Send a line into the session (types text, then presses Enter)
dvm session send <name> my-session "echo hello"

# Type text/keys without implicit Enter (and optionally press Enter)
dvm session type <name> my-session "echo hello"
dvm session type <name> my-session --key C-c
dvm session type <name> my-session --key shift+tab  # aka BTab/backtab
dvm session type <name> my-session --enter

# Read output (default: last 200 lines)
dvm session read <name> my-session

# Incremental reads (best for services): use a byte offset
first=$(dvm session read <name> my-session --json --since 0)
# (parse .offsetBytes, then call again with --since <offsetBytes>)
```

You can also attach interactively when you *do* have a real TTY:

```bash
dvm session attach <name> my-session
```

### Repo workflows (offline "local PR" flow)

These commands help you work on a host git repo **inside a container without bind-mounting the repo**, then export changes back to the host for review/merge.
When seeding, `dvm` now keeps the host repo's preferred git remote as container `origin` so tools like `gh pr create` can run inside the container.

```bash
# Seed the container from your current host repo (creates a git bundle, copies it in, clones it)
# (If the container doesn't exist yet, it will be created automatically by default.)
dvm repo seed <name> --path . --dest /work/repo --branch dvm/work

# Work inside the container (commit normally)
dvm ssh <name>

# Export changes back to the host (default: patches; base read from git config `dvm.baseSha`)
dvm repo export <name> --repo /work/repo --out ./dvm-exports --format patches

# Apply exported patches onto a host quarantine branch for review (VS Code/Cursor)
dvm repo apply --patches ./dvm-exports/patches-<name>-<timestamp> --branch quarantine/dvm --from main
```

For the common "wrap it up for me" flow (similar to the old `repo.sh` helper), use:

```bash
# Export patches and apply them onto a quarantine branch (defaults + per-repo state)
dvm repo sync <name>

# Like sync, but also applies the quarantine diff onto your working tree as UNSTAGED changes
# (requires a clean working tree)
dvm repo pull <name>
```

### Volume management

```bash
# List all volumes
dvm volumes

# Show volume info for container
dvm volumes <name>
```

### Network

For **container-to-container** communication, prefer a shared Docker network over host-published ports.

```bash
# Create a user-defined bridge network
dvm network create dvm-net

# List networks
dvm network ls

# Connect existing containers to that network
dvm network connect dvm-net app db

# Disconnect containers from a network
dvm network disconnect dvm-net app

# See a quick container -> networks view
dvm network
```

```bash
# Show network topology
dvm network
```

### GUI (desktop access)

dvm installs and starts a GUI stack (XRDP + XFCE + noVNC). You can run this command to (re)install and print connection info:

```bash
dvm gui <name>
```

- **Browser (noVNC)**: open the printed `http://localhost:<port>/vnc.html`
- **RDP (XRDP)**: connect to the printed `rdp://localhost:<port>`

For RDP, you’ll need a password set for the user (dvm will remind you):

```bash
dvm exec <name> passwd
```

### Base containers

You can set a “base” container image that new containers will use by default (unless `--image` is explicitly provided).

```bash
# Set a container as the base (creates/records a committed image)
dvm base set <name>

# Show current base
dvm base show

# Reset to default behavior
dvm base reset
```

To create a container **without using** the configured base (even if one is set), use `--no-base`:

```bash
dvm create <name> --no-base
```

### Purge

Remove all dvm-managed containers (and their dvm persistence volumes). The base container is excluded by default.

```bash
# Preview what would be removed
dvm purge --dry-run

# Purge all dvm containers (excluding base)
dvm purge

# Include base container too
dvm purge --all
```

## Configuration File

You can use a YAML or JSON configuration file:

```yaml
name: my-container
image: ubuntu:22.04
ports:
  # IMPORTANT: quote host:container entries in YAML so they stay strings
  - "3000:3000"
  - "8080:8080"
  # Or use object form:
  # - { container: 3000, host: 3000 }
environment:
  - KEY=value
volumes:
  - ./data:/app/data  # Optional bind mount
persistence:
  enabled: true  # Default
  path: /dvm-data  # Default persistence mount point
```

## Features

- **Container Management**: Create, start, stop, and remove containers
- **Port Management**: Automatic port allocation or manual port mapping
- **Data Persistence**: Docker named volumes enabled by default
- **Inter-Container Communication**: Containers communicate via exposed ports
- **Configuration Files**: YAML/JSON support for complex setups

## Data Persistence

By default, each container gets a Docker named volume (`dvm-<container-name>-data`) mounted at `/dvm-data`. This persists:
- Container state
- User data

Data survives container stops, starts, and recreations. By default, `dvm remove <name>` **also removes** the dvm persistence volume; use `--keep-volume` to keep it.

When using fast rename (`dvm rename`), DVM keeps the existing persistence volume by default (no data copy). This means the volume name may differ from the new container name unless you pass `--migrate-volume-name`.

## Running setup scripts

If you want to install tools or configure the container, use `dvm script` to run a host-side script inside a running container:

```bash
dvm create my-container --image ubuntu:latest
dvm script my-container ./setup.sh -- --any --args you want
```

## Development

```bash
# Build
bun run build

# Run in development mode
bun run dev

# Run tests
bun run test

# Lint
bun run lint

# Format
bun run format
```

## License

MIT
