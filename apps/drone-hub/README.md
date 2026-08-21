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

The script runs the normal production build into `dist`, lists generated JS and CSS chunks with raw and gzip sizes, and marks the largest chunks. Successful Vite build output is hidden so the report is easier to diff; failed builds still print the build output. Read the table like this:

- `Chunk` is the stable chunk name with the Vite content hash removed.
- `Raw` is the uncompressed file size in `dist/assets`.
- `Gzip` is a closer estimate of transfer size for normal static hosting.
- `Total JS`, `Total CSS`, and `Total JS/CSS` are the main before/after numbers to compare.
- The `File` hash changes when content changes; compare `Chunk`, `Raw`, `Gzip`, and totals instead.
- Direct Vite builds may print a large-chunk warning; use this table to measure whether that warning is getting better or worse.

To compare a change, capture a baseline before editing, then capture another report after the change:

```bash
bun run build:size | tee /tmp/drone-hub-size-before.txt
# make the performance change
bun run build:size | tee /tmp/drone-hub-size-after.txt
diff -u /tmp/drone-hub-size-before.txt /tmp/drone-hub-size-after.txt
```

This is intended as a local regression check for work such as lazy-loading Monaco, xterm, changes, assistant, and canvas code. It is not part of the required monorepo-wide checks.

## Chat navigation telemetry

The browser sends versioned, bounded chat-load telemetry to `/api/telemetry/chat-load`. Version 2 adds:

- Resource Timing offsets for matching chat requests: worker, redirect, fetch, DNS, connection, TLS, request, interim response, response start, and response end when the browser exposes them. It also includes body/transfer sizes, initiator type, next-hop protocol, and delivery type.
- Long tasks that overlap the active navigation, with their navigation-relative start, full duration, and overlap duration.
- Separate cached-content availability, display, and paint timings, followed by fresh-content resolution, commit (when React reports one), and paint timings.
- Capability and missing-entry statuses, plus dropped-record counts when application bounds are reached. Requests are capped at 24, retained resource candidates at 48, and long-task records at 50 per navigation.

Resource URLs are used only inside the browser to correlate a timing entry with a known navigation request. URLs, query strings, headers, Resource Timing names, Long Task names, and Long Task attribution are not sent. The server accepts versions 1 and 2 and normalizes only known fields.

These fields can show where browser-visible time accumulated: before fetch, in service-worker dispatch, DNS/connection/TLS setup, between request start and first response bytes, during response transfer, or while an overlapping main-thread task ran. A non-zero worker timestamp proves that the measured request entered the service-worker timing path. Populated connection phases show work observed for that browser connection. Cached-content fields prove when Drone Hub found and displayed its own transcript cache; they are separate from HTTP cache signals.

They cannot, by themselves, prove which network hop, proxy, or server consumed request-to-response wait time; whether an omitted zero-valued phase means reuse, unsupported timing, or unavailable detail; or that a zero transfer size was definitely an HTTP cache hit. `nextHopProtocol` describes the browser's next hop, not necessarily the upstream server connection. Long Tasks report browser-defined tasks of at least 50 ms and show overlap, but do not prove that a particular task delayed a request or paint. Missing Resource Timing can mean an unavailable API, a full/evicted buffer, delayed entry creation, or failed correlation. React commit and double-`requestAnimationFrame` paint milestones are scheduling markers, not proof that pixels reached the screen, especially in hidden or throttled tabs.

Current baseline from June 6, 2026:

```text
   Type  Chunk                         Raw       Gzip  File
-  ----  ----------------------  ---------  ---------  ----
*  JS    index                   956.2 KiB  267.6 KiB  dist/assets/index-BXY32sT4.js
*  JS    DroneChangesDock        762.0 KiB  263.6 KiB  dist/assets/DroneChangesDock-CeTfMxaH.js
*  JS    SelectedDroneWorkspace  391.4 KiB   91.3 KiB  dist/assets/SelectedDroneWorkspace-Dn06cLL7.js
*  JS    DroneTerminalDock       343.9 KiB   88.3 KiB  dist/assets/DroneTerminalDock-ugn4-tDe.js
*  JS    SettingsView            189.2 KiB   32.7 KiB  dist/assets/SettingsView-BTqUHFF5.js
*  CSS   index                   102.4 KiB   18.3 KiB  dist/assets/index-CSB1i22O.css
*  JS    AssistantDock           100.7 KiB   22.2 KiB  dist/assets/AssistantDock-7vXcPumD.js
*  CSS   SelectedDroneWorkspace   97.4 KiB    8.2 KiB  dist/assets/SelectedDroneWorkspace-Dcp4S-jV.css

Total JS: 3136.4 KiB raw, 881.0 KiB gzip across 40 files
Total CSS: 209.3 KiB raw, 29.2 KiB gzip across 4 files
Total JS/CSS: 3345.7 KiB raw, 910.2 KiB gzip
```
