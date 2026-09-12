# Drone Hub desktop/backend: memory opportunities

Investigated September 12, 2026. Scope: Electron desktop, renderer and Hub backend. Worker shutdown, browser tuning and VS Code are outside this follow-up. The original investigation was report-only; the user subsequently authorized implementing the first three recommendations.

## Implementation follow-up

Implemented the first three recommendations in source:

- Shared `CacheExpiryTimer` / `ExpiringMap` utilities expire untouched entries with one timer per cache, stop when empty, and do not keep Node alive. Applied to renderer chat fields, linked/header PR caches, backend repository-scan results, PR lists and merge previews. Existing freshness windows, per-field refreshes and request coalescing remain in place.
- Desktop requests now stream with backpressure and preserve content length when supplied. Cancellation, early backend rejection and shutdown close unfinished upstream work; completed requests remain eligible for HTTP connection reuse.
- Registry persistence no longer performs the redundant intermediate JSON round trip. Normalization still operates on an independent object, and unsupported/cyclic roots still fail before persistence.

Validation: 55 distinct targeted tests passed across shared cache behavior, renderer caches/PR resources, repository scan coalescing, proxy body integrity/cancellation/error paths, and registry persistence/migration. Frontend and backend TypeScript checks passed. Node's three SQLite migration/failure tests were also run against current source through ts-node in a disposable test copy; the live application output directory was not rebuilt.

Post-change isolated probes:

- A 32 MiB upload arrived intact, began forwarding before completion, and made **zero full-body `Buffer.concat` copies** (previously one additional 32 MiB copy).
- 32 MiB of synthetic expired renderer cache data was released automatically: measured heap approximately 52.51 → 20.53 MiB, zero retained entries.
- The equivalent backend cache probe measured approximately 53.05 → 21.05 MiB, zero retained entries.

These are synthetic measurements, not a claimed reduction in the live app's RSS. No desktop/backend restart was performed; the changed application code requires rebuilding and relaunching to take effect. Recommendation four (diagnostic stack gating) was not included in the requested batch.

Review follow-up: found and fixed a streaming-proxy regression where receiving response headers immediately stopped the upload. A backend that acknowledged the first chunk and waited for the remainder could hang indefinitely. The added regression test timed out before the fix and passes afterward. Upload forwarding now continues while the response streams; response completion and cancellation still stop unfinished work. All 53 checks rerun during this review passed (13 proxy, 3 shared-cache/entrypoint, 37 renderer/backend cache and registry checks). No additional issues were found in the reviewed cache expiration and JSON-normalization changes.

The sections below preserve the **pre-change investigation** and rationale.

## Recommendation

There are several changes with **no intended feature or freshness tradeoff**. Prioritize expiration cleanup and streaming request bodies. These remove data already considered unusable or unnecessary copies, rather than limiting history or disabling features. They still require regression checks; “without downside” cannot mean implementation changes need no validation.

The findings concern two different costs: expired caches can inflate steady-state memory, while whole-body buffering and JSON copies create temporary peaks and GC work. No defensible total reduction for the live app can be promised without measuring its actual cache contents and workload.

| Priority | Change | Expected benefit | Confidence |
| --- | --- | --- | --- |
| 1 | Release expired renderer/backend cache entries | Lower retained memory after browsing chats/repos | Reproduced with actual cache modules |
| 2 | Stream desktop API request bodies | Remove upload-sized buffering/copying in Electron main | Reproduced through actual desktop proxy |
| 3 | Remove redundant JSON round trip in registry normalization | Fewer temporary full-size strings/objects during persistence | Direct source finding; production impact unmeasured |
| 4 | Construct diagnostic call stacks only when diagnostics are enabled | Small allocation/CPU reduction per compatibility read | Direct source finding; small benefit |

## 1. Expired caches retain data they will never serve

### Renderer chat cache

`apps/drone-hub/src/droneHub/app/chat-runtime-cache.ts:35` expires individual fields after 30 seconds, but only when **that same key is read again**. Writes cap the cache at 200 keys, not bytes. Moving to another chat and never revisiting the previous one can leave its transcript/pending/configuration objects retained for the rest of the app session, until capacity eviction or explicit deletion.

The consumer in `use-chat-runtime-orchestration.ts:980` writes the fetched transcript into this cache. The cache keeps references; this is not necessarily a second copy while the same data is actively displayed. The avoidable cost appears when the cache becomes the remaining owner after navigation and expiry.

Proposed change: prune expired fields across keys and delete empty entries, with a bounded cleanup schedule that stops when empty. Preserve existing field-specific timestamps, the full 30-second freshness window and all fresh cached values. Do not shorten the TTL or truncate transcripts. Deleting an expired entry adds no cache miss that would not already occur today.

### Backend scan cache and related caches

`apps/drone/src/hub/repo-changes-scan-cache.ts:12` has the same issue: its nominal two-second TTL rejects an old value only on a future request for that key. There is no global sweep or capacity bound in this class. `server.ts:2745` keeps the instance alive, and `repository-operation-route-service.ts:356` uses it for repository scans. Mutation invalidation can clear it, but simple expiry does not.

The renderer's linked-PR cache (`chat/linked-pull-request-resource.ts:42`) and header PR cache (`app/HeaderPullRequestShortcuts.tsx:69`) also stop serving values after 12 seconds without removing them on expiry. Resource subscription cleanup exists, but the separate cache still owns its payload.

The backend PR and merge-preview maps similarly retain expired entries, although they have coarse count caps: `repository-operation-route-service.ts:1571` / `:1586`, and `:1230` / `:1314`. These are lower priority because their payloads and workload have not been measured.

Preserve request coalescing and invalidation generation behavior when adding expiration cleanup. Do not clear fresh values or pending loads just to lower memory; that could increase repeated work.

### Isolated measurement

Loaded the actual TypeScript cache modules into a scratch Node process. Each received 32 synthetic entries containing 1 MiB of distinct text apiece. Logical time was advanced beyond expiry; no user data or live cache was accessed.

| Cache | Heap after population | Heap after expiry/unrelated-key access | Heap after expired-only cleanup |
| --- | ---: | ---: | ---: |
| Renderer chat runtime | 52.05 MiB | 52.05 MiB, 32 expired entries retained | 20.04 MiB |
| Backend repository scan | — | 52.51 MiB, 32 expired entries retained | 20.50 MiB |

For the renderer, cleanup used its existing expired-key read logic on all populated keys, and all 32 returned misses. For the backend, the scratch probe removed only map entries with expired deadlines; one newly added fresh entry remained. Forced GC was used only in the disposable probe process to measure retained heap. This demonstrates approximately 32 MiB of avoidable retention for that synthetic workload, **not** 32 MiB of waste measured in your renderer/backend.

## 2. Stream uploads through the desktop proxy

`apps/drone/desktop/hub-electron-static-server.cjs:108` collects every incoming request chunk and calls `Buffer.concat`. `proxyApiRequest` waits for the complete body before it creates the upstream request, then calls `upstream.end(body)`.

The desktop's `directApiBase` still routes through this proxy: it is `localhost` on the same static-server port (`:311`), not a direct backend connection. This makes the finding relevant to normal desktop API traffic.

A synthetic 32 MiB POST through the actual proxy produced:

- 33,554,432 bytes received by the fake backend, matching the sender.
- Upstream request began only after all 33,554,432 bytes had been sent into the proxy.
- `Buffer.concat` received 519 chunks totaling 32 MiB and allocated another 32 MiB output buffer.

At concatenation, both the input chunks and output buffer are needed. This creates roughly two body-sized backing allocations in the proxy, before counting renderer/backend/network overhead. It is an allocation-volume observation, not a sampled 64 MiB RSS peak.

Proposed change: forward request data incrementally, honoring writable backpressure, and keep streaming the response. Node documents the relevant [stream buffering and backpressure behavior](https://nodejs.org/api/stream.html#buffering). Preserve authorization, allowed headers, CORS and WebSocket routing. Validate empty/JSON/binary bodies, early backend rejection, client cancellation and desktop shutdown; a naive pipe replacement could mishandle those cases.

The backend's raw filesystem-upload handler already writes chunks to a temporary file (`apps/drone/src/hub/filesystem-runtime.ts:109`), so the desktop currently defeats that benefit on its side. The configured default filesystem upload ceiling in source is 2 GiB (`hub-settings.ts:192`); that illustrates why whole-body proxy buffering is undesirable, not evidence that a 2 GiB upload occurred. Upload traffic shrinks dramatically in memory with streaming; idle desktop memory will not materially change from this fix alone.

## 3. Eliminate a redundant registry JSON copy

`apps/drone/src/host/registry.ts:774` currently performs:

```text
registry -> stringify -> parse -> stringify -> parseRegistry (which parses again)
```

The intermediate parsed object is used only to stringify it again. For the persisted JSON-shaped registry, passing the first serialized string directly into `parseRegistry` preserves an independent normalized result while removing one full parse and one full stringify. Keep the same null/default handling, v1 migration, v2 normalization and input immutability. Check those cases before implementation.

This path runs during `saveRegistry` and migration initialization, not every narrow canonical read. A read-only SQLite size query found the current migration-seed JSON is 2,565,395 bytes (2.45 MiB); a full reconstructed registry can differ. This is an obvious local cleanup, but its benefit depends on the actual saved payload size and frequency; no production memory reduction is measured here.

## 4. Gate diagnostic-only stack capture

`apps/drone/src/host/registry.ts:1127` calls `registryProjectionCaller()` unconditionally. That creates an Error stack, splits/trims/joins strings and sometimes retains them in `registryProjectionJoinedCallers`. They are consumed only by logging inside the diagnostics-enabled branch (`:1143`).

Proposed change: capture the diagnostics-enabled state at the beginning of a load and construct/store caller strings only when enabled. Preserve the useful diagnostics when enabled. This is small cleanup; it will not explain or eliminate multi-gigabyte spikes.

## Larger ideas that are not yet established as easy wins

- **Full compatibility projections:** `hub-state-projection.ts:244` clones a seed and reconstructs active/pending/archived drones with chats. Narrow metadata reads should avoid full transcript materialization where possible. However, many hot paths already use canonical summary repositories; blindly replacing every `loadRegistry` call could lose data or migration behavior. No September 12 full-projection timing blocks were found in the retained log scan; diagnostics may have been disabled, so this neither measures nor rules out their involvement in the observed stalls.
- **Skip cloning overwritten seed collections:** with a canonical lifecycle repository, the clone's `drones`, `pending` and `archived` are immediately replaced. Cloning only surviving fields after backfill looks promising, but must preserve the no-repository fallback and migration ownership. This needs a targeted equivalence check before ranking it alongside expired-only cleanup.
- **Shrink terminal/diagram/history caches:** terminal views already dispose after two idle minutes and cap idle views at eight; Mermaid has a 48-entry limit. Reducing these values can sacrifice warm reopen/render performance. Initial chat reads already request a tail of 50 turns. These are not free memory reductions.
- **Disable GPU acceleration, force periodic GC, lower heap limits or restart periodically:** no evidence from this review supports these as improvements without downside.

## Validation and artifacts

The probes exercised current source in disposable processes, with synthetic data and fake loopback services. No rebuild, application restart, production upload, live heap snapshot or application test suite was run. The result is an investigation, not a shipped optimization.

Scratch reproducers:

```sh
node --expose-gc /tmp/drone-hub-memory-review/probe-caches.cjs
node /tmp/drone-hub-memory-review/probe-proxy.cjs
```

Recommended first implementation batch: expired-only cache cleanup, desktop upload streaming, then the two small backend allocation cleanups. Measure idle-after-navigation memory separately from upload peaks and compatibility-write allocations when validating the results.
