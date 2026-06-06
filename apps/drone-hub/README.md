# drone-hub

`drone-hub` is a small Vite/React web UI for listing and operating drones.

It expects a Hub API at `/api` (usually provided by `apps/drone`).

## Installation

From the monorepo root:

```bash
# install dependencies (one-time per repo clone)
bun install

# build the UI bundle
bun run --filter drone-hub build
```

`drone-hub` is a web app and does not install a standalone shell command.

## Run (recommended)

From the monorepo root (after building `apps/drone`):

```bash
drone hub
```

That starts:

- a **Hub API server** (Node, host-side)
- the **Vite dev server** for this UI, with `/api` proxied to the API server

## UI-only development

If you run the UI directly, set `DRONE_HUB_API_PORT` so Vite can proxy `/api`:

```bash
export DRONE_HUB_API_PORT=8787
bun run --filter drone-hub dev -- --port 5174 --strictPort
```

The default `drone hub` API port is also `8787`. Pass `--api-port 0` only if you explicitly want an ephemeral port.

## Build

```bash
bun run --filter drone-hub build
```

Production builds do not emit sourcemaps by default. For a debug build with sourcemaps:

```bash
DRONE_HUB_SOURCEMAP=1 bun run --filter drone-hub build
```

## Bundle size checks

Run this from `apps/drone-hub` after performance-sensitive UI changes:

```bash
bun run build:size
```

Or from the monorepo root:

```bash
bun run --filter drone-hub build:size
```

The script runs the normal production build into `dist`, lists generated JS and CSS chunks with raw and gzip sizes, and marks the largest chunks. Successful Vite build output is hidden so the report is easier to diff; failed builds still print the build output. To compare a change, capture a baseline before editing, then capture another report after the change:

```bash
bun run build:size | tee /tmp/drone-hub-size-before.txt
# make the performance change
bun run build:size | tee /tmp/drone-hub-size-after.txt
diff -u /tmp/drone-hub-size-before.txt /tmp/drone-hub-size-after.txt
```

This is intended as a local regression check for work such as lazy-loading Monaco, xterm, changes, assistant, and canvas code. It is not part of the required monorepo-wide checks.
