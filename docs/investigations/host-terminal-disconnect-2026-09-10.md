Host terminal disconnect investigation — 2026-09-10

The StorySpark host daemon responds successfully to health requests but does not advertise `terminal-control-v1`. Its terminal therefore uses the Hub's compatibility bridge: browser WebSocket → Hub fetch/SSE → local daemon → tmux log. Read-only inspection found the StorySpark shell panes alive in bash. Being a host drone does not bypass this transport.

The legacy daemon's `/v1/terminal/output/stream` sends an initial ready event, then only writes when the terminal produces output. It had no idle keepalive. The separate prompt-event stream already sends one every 25 seconds. A fetch body timeout or dropped socket becomes a `TypeError` whose message is `terminated`; the Hub forwarded that message directly into the terminal banner.

The Hub already retries failed streams, but it consumed the daemon's next ready event internally. The browser never received a recovery notification, so its error could remain visible while terminal output was flowing again. Clean EOF also triggered a backend retry without telling the viewer it was reconnecting. HTTP polling had a separate equivalent bug: successful polls did not clear a previous output error.

Changes:

- The daemon sends SSE keepalive comments every 25 seconds and releases the timer on request/response closure. Comments do not enter terminal output or move the resume cursor.
- The legacy bridge sends explicit `stream-state` messages for interruption and recovery. It distinguishes idle body timeouts from other interruptions and handles clean EOF. Recovery does not send a second terminal initialization/snapshot or reset the viewer cursor.
- The frontend displays a readable reconnecting message and clears its output error when streaming or polling recovers. Unrelated input-delivery errors remain visible. Input flushing pauses during a known output interruption and resumes on the daemon's ready event.
- Stream connection/recovery events enter the existing bounded terminal telemetry, without logging terminal contents or raw error-response text.

Validation includes interrupted-stream recovery with timeout/socket/EOF failures and exact cursor continuation; frontend recovery, input warning preservation and successive polling failures; and a built daemon with an isolated tmux server observed emitting a real keepalive after 25 seconds. Live terminal inspection sends no input. Runtime timeout observations and final validation results follow below.

These are source/build changes. No live Hub or host daemon is restarted by this investigation. The Hub/UI recovery changes support older daemons; the keepalive requires the updated daemon process.

Runtime observations:

- Node 20.19.2, bundled Undici 6.21.2, isolated loopback SSE response: initial ready bytes arrived at 20 ms; no subsequent output; fetch failed at 300,724 ms with message `terminated` and cause `UND_ERR_BODY_TIMEOUT`.
- The running StorySpark host daemon, read-only `/v1/terminal/output/stream` observation with a cursor clamped to the log end: HTTP 200 and initial ready bytes at 27 ms; no subsequent output; fetch failed at 300,745 ms with the same message and cause. No terminal input or terminal contents were printed by the probe.

This directly reproduces the idle timeout on the affected host daemon. The original screenshot has no recorded error cause/timestamp to prove that specific historical interruption, but the reproduced failure, legacy transport and stale-banner bug explain the observed behavior without a shell/container exit.

Final validation: 23 focused Bun tests (110 assertions), all three Node legacy bridge tests (including temporary HTTP 503 recovery and cancellation during backoff), the built daemon/isolated-tmux keepalive integration test, hidden Electron smoke including banner recovery, frontend type checking, backend production build and frontend production build passed. The keepalive integration test took approximately 25.3 seconds; the two timeout probes each ran for five minutes. Investigation began at 18:06 UTC and continued for at least ten minutes. No live service restart or deployment was performed.
