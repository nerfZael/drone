# drone-hub

`drone-hub` is a small Vite/React web UI for listing and operating drones.

It expects a Hub API at `/api` (usually provided by `apps/drone`).

## Installation

From the monorepo root:

```bash
# install dependencies (one-time per repo clone)
bun install

# build the UI bundle
bun --filter drone-hub run build
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
bun --filter drone-hub run dev -- --port 5174 --strictPort
```

## Build

```bash
bun --filter drone-hub run build
```
