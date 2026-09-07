# File opens and Explorer directory latency

Investigation date: 2026-09-07. Source inspection plus a small read-only Docker probe on the development host. No phone end-to-end measurements were collected; the changes below need deployment before they can capture the intermittent delays reported by the user.

## Findings and changes

| Finding | Change | Expected benefit |
| --- | --- | --- |
| Every uncached mobile file link first listed its parent to decide whether it was a directory, then requested the file. | Read the file first; classify directories only after a failed read. Preserve the original read error if directory lookup also fails. | Removes one serial mesh request and directory operation for successful file opens, including Markdown links. Directory links retain Explorer fallback. |
| Filesystem routes already resolved a canonical container, but each subsequent exec listed the entire Docker fleet again. | Pass `containerAlreadyReady: true` from the filesystem service; Dockerode obtains an exec handle by exact container name. | Removes redundant fleet enumeration from reads, media and directory listings. Docker still reports missing/stopped containers through the existing error path. |
| Existing diagnostics primarily described chat reads and slow HTTP requests. | Add bounded `file-open` and `directory-load` navigation records, request correlation, filesystem phases, Docker exec phases and UI milestones. | Distinguishes transport/server work from client rendering and image decode. |

The Docker Engine exec API accepts an exact container name or ID: [official API reference](https://docs.docker.com/reference/api/engine/version/v1.46/). This does not cache container existence or skip Docker's validation.

### Measured Docker overhead

The initial probe enumerated **230 containers**, yielding **574,732 bytes** of serialized list metadata. Six alternating pairs ran the same `bash -lc 'stat -c %s /etc/hostname >/dev/null'` operation, comparing fleet discovery plus exec against direct exec by resolved ID. Conventional medians, recalculated from the raw samples:

| Variant | Median total | Median discovery |
| --- | ---: | ---: |
| List all containers, then exec | 102.7 ms | 31.9 ms |
| Direct exec | 62.7 ms | approximately 0 ms |

About 40 ms less median probe latency on this host. These are six samples per variant, not a phone benchmark, production percentile, or a guarantee of the same improvement on another machine. Shell startup, Docker scheduling and exec inspection remain in both variants.

Repeat with `node apps/drone/scripts/benchmark-filesystem-exec.cjs <exact-container-name> 10`. The checked-in probe alternates order between pairs, accepts an exact name or full ID, and prints only timings and aggregate metadata size. It does not print file contents or container identities. Docker socket access is required.

## End-to-end paths

### Mobile chat or Markdown link

1. A link resolves relative to the drone workspace or preview document. `use-file-preview.ts` starts a navigation record, checks its bounded preview cache, and displays cached content immediately when available.
2. A cache miss invokes `file.preview` through `requestDroneControl`. `MeshSession` signs the request and sends it over the selected mesh transport. The HTTP command channel records fetch/body/parse/decode and signing/send milestones; other transports share signing/response/decode observations where available.
3. The destination Hub authenticates/authorizes the capability request. Its router records pre-invoke, invocation and post-invoke timing. `drone-control-capability.ts` makes a loopback HTTP filesystem request to the same Hub. This is an extra local HTTP hop, not a network connection to an agent process inside the container.
4. The filesystem route resolves the drone and canonical container. `withReadonlyDroneContainer` does not acquire the mutation operation lock. `dvmExec` calls the in-process Dvm API, which uses Dockerode to talk to the Docker daemon. It creates an exec, starts a non-TTY stdout/stderr stream, demultiplexes output, and inspects the exit status. It does not launch the `dvm` CLI or use SSH for these reads.
5. The container executes a bounded Bash script. File operations inspect size/MIME, read bytes and sometimes compute SHA-256 revisions. Binary output is represented as base64 in shell responses. Hub code parses the response and returns text or media metadata.
6. Raster media can require a further metadata/revision request plus an authorized HTTP download. Mobile writes the download to its local cache, applies preview state, and waits for native image loading. Text/SVG use the preview commit; raster images additionally record image decode/load completion. Two animation frames after commit are a display scheduling proxy, not a hardware paint measurement.
7. A failed initial file read performs the parent-directory classification fallback. Directory links reveal the Explorer. A successful file read no longer pays for this lookup.

File watch subscriptions, metadata refresh and cached revalidation continue separately. Watch/metadata-only operations do not create new navigation records. A revalidation started during an active cached open can still appear among its requests; use `cacheHit` and UI completion time when comparing these loads.

### Desktop chat or Markdown link

`openFileInFilesPane` starts the record. Known file entries open directly. Unknown links use `prepareWorkspaceFileOpen`, which already races the file read and parent listing, and passes the initial file-read promise to the editor. This desktop path already avoids a serial preflight and duplicate initial read.

The browser calls the Hub filesystem endpoint directly, without the mobile capability/loopback hop. The same container execution path follows. The editor hook records data application; the panel records surface commit, Monaco mounting or image loading as appropriate. Existing editor tabs can avoid the read. Opening via the editor hook without the link handler starts timing at read initiation, so those records do not measure the original click.

### Explorer directories

Mobile invokes `files.list`; desktop calls `GET /api/drones/:id/fs/list`. Both reach the same filesystem service. Container listing uses one Bash exec with batched `find`/`stat` operations and NUL-delimited fields; it is already batched rather than one Docker call per entry. Git ignore decoration runs in that script. The Hub parses and sorts entries, and clients normalize/apply/render the tree.

Expanding/revealing nested paths can require multiple ancestor loads. Each foreground directory request gets its own bounded record; loaded background refreshes do not start new ones. Desktop cache hits are recorded; mobile's already-loaded early return is not recorded. These are directory-load measurements, not one aggregate span covering an entire nested reveal interaction.

## Reading the instrumentation

- **Client records:** `kind` is `file-open` or `directory-load`; each has a navigation ID, status, total duration, numeric milestones, and up to 16 request observations. Paths are used only for in-memory matching and are not serialized. No file contents, tokens, URLs or exception text are added to these records.
- **Mobile storage:** uses the existing durable chat diagnostics buffer/uploader. Local queue holds 100 combined chat/workspace records; upload retries on the existing 15-second cadence. Hub storage retains at most 30 days, 2,000 records per device and 10,000 total. Retrieve through the existing authenticated `GET /api/telemetry/mobile-chat-loads?droneId=...&since=...&limit=200`, then filter returned records by `kind`. A missing `kind` means an older/chat record. The existing `requestId` filter matches client or server request IDs.
- **Desktop storage:** posts to `POST /api/telemetry/file-load`; validated records appear in Hub logs as `workspace file load timing`. Upload is best effort, with no durable desktop retry queue.
- **Correlation:** mobile requests carry a request ID; capability-to-loopback calls forward it as `x-drone-parent-request-id`. Each Hub HTTP response has its own `x-drone-request-id`. Join the mobile request ID to the filesystem log's parent ID, and desktop observations directly to filesystem response IDs. Capability cache hits may have no new filesystem child request.
- **HTTP phases:** `fs_resolve_drone`, `fs_resolve_container`, `fs_container_exec`, `fs_parse_list`, and host equivalents. Docker phases are `docker_lookup`, `docker_create_exec`, `docker_start_stream`, `docker_stream`, `docker_inspect_exec`. Phases accumulate when one request performs multiple execs. They are included in `Server-Timing` when available before headers and in final request logs. Successful fast filesystem GETs are retained too, to provide comparison samples.
- **Client milestones:** cache hit, read start/resolution, data application/commit, entry normalization/count, media transfer start/finish, image decode, editor mounting and frame proxy as applicable. A navigation expires after 45 seconds, or ends as error, superseded or backgrounded. Late request/frame callbacks cannot rewrite a completed record. At most 32 navigations are active at once.

These durations overlap: Docker phases sit inside `fs_container_exec`, which sits inside capability invocation. Do not sum parent and child phases. First-write milestones can describe the first request of a retry; request observations retain separate attempts. Byte/count measurements are numeric counts, not durations.

## Next optimizations, ranked

1. **Use real slow traces to separate network latency, Docker delay and client rendering.** Reproduce cold and cached text/image opens from chat and Markdown; expand small/large directories; repeat after background/resume. Compare slow and fast records for the same drone and cache state. No actual intermittent phone stall is yet attributed to one phase.
2. **Reduce repeated image metadata/revision work if it dominates.** Some media paths inspect metadata twice and hash/read data again during transfer. Consolidate where revision validation still guarantees that bytes match the requested version. Do not weaken cache correctness just to remove hashing.
3. **Split directory shell work if `docker_stream` dominates.** Currently shell startup, enumeration/stat, Git-ignore decoration and output transfer share this phase. A targeted internal measurement or controlled benchmark with ignore decoration enabled/disabled would distinguish them. Consider deferred/cached ignore decoration only after establishing that cost and preserving invalidation.
4. **Reduce repeated ancestor loads and background execs.** Review traces for redundant expansion/list requests and watch/poll work competing with foreground reads. Existing caches and batched listing should be preserved; record cache/refresh semantics when changing them.
5. **Consider replacing the loopback HTTP adapter or persistent container filesystem service only with evidence.** These have wider authorization/lifecycle/cancellation implications than the two implemented changes. A persistent service would avoid shell/exec startup but adds operational complexity.

Remaining instrumentation limits: raster decode is measured, but full Markdown/WebView layout, native frame timing, video first-playable frame, and mobile JS event-loop stalls are not separately attributed. Raw media HTTP downloads have client transfer boundaries but no new shared navigation header. Container script internals are aggregated. No visual test on a phone or deployment was performed in this investigation.

## Validation

Focused validation passed: 125 shared/mobile/filesystem/capability tests, 25 desktop file/Explorer tests, seven HTTP diagnostics tests under Node and two mocked Docker exec tests. Mobile, desktop and server type checks passed. Tests cover skipping successful-file preflight, directory fallback/error preservation, independent directory spans, stale callbacks, bounded/private records, durable mobile storage, response correlation, media semantics, skipping Docker discovery and observer failures.

A broader run also exposed the existing `filesystem-git-ignore.test.ts` failure under Bun: the unchanged subprocess helper's stdin probe returned no ignored paths. Running the same helper/probe under Node returned the expected ignored path. This runtime-specific failure is not resolved by these changes. Physical-device UI behavior and production latency remain unverified.
