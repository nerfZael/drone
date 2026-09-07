# Desktop chat, Explorer and editor performance fixes

The slow interaction at 22:51:07 Zagreb time loaded the transcript in 7.87 seconds; Explorer's first request timed out at 12 seconds. The Hub logged repeated main-thread stalls. The later editor/file open at 22:52:09 completed in 361 ms; that is a separate interaction, not an editor measurement for the slow click.

## Evidence and fixes

A 60-second CPU capture beginning at 21:01:14 UTC on the running Hub attributed approximately 6.2 seconds of self time to transcript JSON parsing and 5.9 seconds to garbage collection. Transcript SQLite reads and reconciliation were also prominent. Raw profile: `/tmp/drone-perf/hub.cpuprofile` (local diagnostic artifact, not checked in).

Reconciliation previously loaded the most recent 60 pending rows, including completed sent prompts, and hydrated their corresponding full transcript turns. It now excludes sent prompts already represented by canonical turns and reads only turn identities/completion timestamps for the remaining prompts. Active payloads, repairable prompt states, attachments and file-change baselines remain intact. Normal transcript reads still return complete history; stored data is not modified by this optimization. The in-memory fallback follows the same reconciliation semantics.

Five read-only samples against the affected chat, using the same database and implementation with reconciliation mode toggled:

| Read | Before | After |
| --- | ---: | ---: |
| Read duration range | 61–77 ms | 1.3–2.7 ms |
| Returned JSON size | 18,347,342 bytes | 271,558 bytes |
| Pending prompts hydrated | 46 | 2 |
| Historical turns hydrated | 44 | 0 |

These are component measurements, not post-restart click latency or production percentiles. Repeat with `node apps/drone/scripts/benchmark-chat-reconciliation.cjs <hub.sqlite> <drone-id> [chat-name]`. The probe alternates six pairs, opens the existing database read-only, and does not run migrations or print contents.

A later six-pair alternating run of the checked-in probe measured medians of 92.72 ms versus 1.56 ms (18,861,106 versus 183,849 returned bytes). The live chat changed between runs, and other development/build work was running, so compare variants within each run rather than treating them as one stationary distribution. Raw alternating samples are at `/tmp/drone-perf/reconciliation-samples.json`.

The media script's watchdog inherited Docker's response descriptors. A tiny `/etc/hostname` read in the affected container took 2.10 seconds for metadata and 2.30 seconds with the body. Detaching the watchdog's standard streams removed that fixed delay. The implemented watchdog also cancels/reaps its sleep child. Verification samples took approximately 70 ms and 67 ms respectively. The foreground snapshot, revision, range and size-validation semantics are preserved.

Repeat with `node apps/drone/scripts/benchmark-filesystem-media.cjs <exact-container-name>`. This reads only `/etc/hostname`, prints timings/byte counts, and requires Docker access. Successful media reads now report allowlisted `media_mime`, `media_snapshot`, `media_hash`, `media_slice` and `media_encode` phases. These are nested inside container execution; do not add them to their parent duration.

## Explorer and rendering

Root and child directory reads retain cached entries during refresh, including stale entries while revalidating. A timeout, network failure or HTTP 408/429/502/503/504 gets one retry after 500 ms; each attempt retains the existing 12-second timeout. Permission and missing-path failures are not retried by this helper. Navigation/unmount cancels active reads and backoff. Existing periodic root refresh and mutation-driven invalidation remain in place.

Transcript turns memoize activity normalization, response detection and tool counts across unrelated rerenders. Inline chat images decode asynchronously. React Profiler hooks record transcript/file-pane render time in development or profiling builds; normal production React does not invoke these callbacks. A profiling production build is available with `DRONE_HUB_REACT_PROFILE=1 bun run --filter drone-hub build`. The standard production build remains the default. No browser rendering speedup is claimed from the component probes above.

## Telemetry

- Workspace records carry `parentNavigationId`, the chat's actual name, and `sinceClickMs` when started within 45 seconds of that chat selection.
- Add `sinceClickMs` to a pane's `durationMs` to locate its readiness relative to the shared click. Already-visible Explorer/editor panes emit cache/readiness records on a chat switch without forcing another directory request.
- Cached/restored file surfaces start records too. `editorReady`, `editorMounted`, `previewReady`, and image decode are distinct milestones.
- Inline chat images emit independent `media-load` records when visible. Their completion does not depend on the transcript span remaining active. Offscreen lazy images do not begin timeout spans. Resource duration and byte count are included when the browser exposes them. This covers the inline media rail; it is not a full video-first-frame or arbitrary embedded-web-content trace.
- Filesystem request timings are serialized explicitly in the Hub log instead of being truncated to `[Object]`.
- Workspace spans record browser long-task overlap/count when available. Overlapping spans may observe the same task; these values must not be summed across panes. Long-task buffers are bounded, so a heavily stalled window can exceed the retained sample count.
- Existing bounds remain: 32 concurrent workspace spans, 45-second expiry, 16 request observations per span, allowlisted numeric measurements, and no serialized paths or file contents. Desktop uploads remain best effort.

## Verification and rollout

Validation includes transcript API/pagination and reconciliation integration tests, directory retry/cancellation tests, media range/revision behavior, watchdog descriptor isolation, transcript presentation, and telemetry correlation/validation tests. The API test requires localhost binding outside the restricted sandbox. Server, desktop and mobile type checks and normal/profiling desktop builds are checked during implementation.

The running Hub and desktop were not restarted. Component probes exercised the new code, but a full three-pane interaction using the rebuilt app remains to be measured after restart. Use the new parent navigation ID to compare chat paint, Explorer readiness, editor readiness and image readiness together under both cold and cached loads.
