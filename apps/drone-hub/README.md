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

The default `drone hub` API port is also `8787`. Pass `--api-port 0` only if you explicitly want an ephemeral port.

## Build

```bash
bun --filter drone-hub run build
```

## Build Size

Use this before and after performance work to make bundle changes measurable:

```bash
bun run --filter drone-hub build:size
```

The command builds the Vite app, then prints every built JS and CSS asset sorted by raw size. Read the table like this:

- `Chunk` is the stable chunk name with the Vite content hash removed.
- `Raw` is the uncompressed file size in `dist/assets`.
- `Gzip` is a closer estimate of transfer size for normal static hosting.
- `Total JS`, `Total CSS`, and `Total JS/CSS` are the main before/after numbers to compare.
- The `File` hash changes when content changes; compare `Chunk`, `Raw`, `Gzip`, and totals instead.
- Vite may also print a large-chunk warning; use this table to measure whether that warning is getting better or worse.

Current baseline from June 6, 2026:

```text
Type  Chunk  Raw        Gzip       File
----  -----  ---------  ---------  -------------------------
JS    index  3.05 MiB   851.4 KiB  assets/index-DyDpqlFr.js
CSS   index  209.0 KiB  28.6 KiB   assets/index-fyzhe3Ay.css

Total JS: 3.05 MiB raw, 851.4 KiB gzip across 1 file
Total CSS: 209.0 KiB raw, 28.6 KiB gzip across 1 file
Total JS/CSS: 3.26 MiB raw, 880.0 KiB gzip
```
