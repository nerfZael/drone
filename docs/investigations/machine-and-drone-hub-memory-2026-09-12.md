# Machine and Drone Hub memory investigation — 2026-09-12

Measured on `zael-tux-desktop`, approximately 10:14–10:25 Europe/Zagreb. This was a read-only runtime investigation; no applications were stopped, containers resized, browser settings changed, or services restarted.

## Findings

Chrome is the largest current RAM consumer. Drone's worker fleet is the next major opportunity. The desktop Hub is comparatively small at rest, but its backend has real intermittent allocation/latency problems and historical heap-limit crashes. A healthy current system-memory snapshot does not rule out either earlier machine-wide exhaustion or an individual application's heap limit.

| Component | Measured memory | Interpretation |
| --- | ---: | --- |
| Chrome, 265 processes including 256 renderers | 51.3 GiB PSS, later 51.9 GiB | Largest current consumer; renderer count is not a tab count |
| 219 running `drone-*` containers | 22.17 GiB working set; 16.03 GiB anonymous memory | Includes worker processes; do not add daemon RSS again |
| 32 other running containers | 4.72 GiB working set | Includes Supabase services |
| Three QEMU VMs | 4.71 GiB summed RSS | PSS unavailable for these processes |
| VS Code, 34 processes | 3.13 GiB PSS | Separate application from Hub |
| Drone Hub desktop + backend + launcher | 0.87 GiB PSS, later 0.77 GiB | Includes Electron subprocesses; backend detached from desktop parent |

PSS apportions shared pages instead of counting them once per process. Container working set here means `memory.current - inactive_file`, not a guarantee that every remaining byte is unreclaimable. RSS, PSS and cgroup working sets are different measurements; this table is not an additive accounting of the entire machine.

Initial Hub breakdown: renderer PID 792534 about 322 MiB PSS; backend PID 792465 about 322 MiB; desktop main PID 791916 about 83 MiB; GPU process about 88 MiB; other desktop processes/launcher about 71 MiB. A separate voice application using Electron was excluded.

There were 169 `daemon.bundle.js` Node processes, together 13.24 GiB summed RSS and 2.41 GiB swapped memory. These are predominantly already included in container totals. Docker also had 2,876 `docker-proxy` processes (5.57 GiB summed RSS, 1.08 GiB summed process swap). Their PSS was inaccessible, so 5.57 GiB is not a reliable estimate of uniquely recoverable RAM. Most inspected Drone containers expose seven ports. Reducing the running fleet also reduces this infrastructure overhead.

## Machine health now

- 186.3 GiB physical RAM; approximately 102 GiB used and 83.6 GiB available.
- Only about 9 GiB completely free, but substantial file cache is reclaimable. Low free memory alone is misleading.
- 8 GiB swap essentially full. Repeated `vmstat` samples showed zero swap-in/swap-out activity; memory pressure averages were zero. Full swap alone does not establish current thrashing.
- 32 logical CPUs; sampled CPU idle roughly 71–81%, I/O wait 0–1%. No sustained whole-machine CPU or I/O saturation in this sample.
- Root filesystem 52% full, approximately 840 GiB available.
- Uptime roughly 22.8 days.

This is a short observation window, not a hardware stress test or proof that intermittent pressure is absent. The broader full-boot journal scan timed out; conclusions below use the completed seven-day kernel query. GPU vendor diagnostics were unavailable (`nvidia-smi` absent).

## Confirmed historical failures

The completed seven-day kernel query reported two **global OOM kills** on September 7 (local time):

| Time | Victim | Anonymous resident memory at kill |
| --- | --- | ---: |
| 19:09:26 | `bun`, PID 1957166 | 77,022,448 KiB = 73.45 GiB |
| 21:45:16 | `bun.exe`, PID 2475250 | 80,695,924 KiB = 76.96 GiB |

Both victims belonged to container `155a1f7750376d884521b2891519c79ee0067ac289e4d478acba83c409dfb1e5`. This container is absent from current Docker inspection, so its workload/name could not be established. The cgroup of the process invoking the OOM killer differs from the victim's cgroup; those must not be confused. These events establish real machine-wide exhaustion, but do not explain every reported crash.

All 219 currently running Drone containers have `HostConfig.Memory = 0` and `memory.max = max`. All 32 other running containers are also unlimited. The current DVM creation path in `apps/dvm/src/docker/client.ts:228` does not specify memory constraints. A single runaway worker can therefore compete with the entire desktop for RAM.

The retained Hub log contains **eight Node JavaScript heap-limit failures**, with the nearest preceding timestamps dating to June 29, August 6, August 9, August 29, September 4 (twice), and September 5 (twice). GC output shows heaps around 4 GiB. These timestamps are adjacent log evidence, not timestamped fatal-error records; the log is cumulative and includes child output. No later matching fatal heap error appeared in the scan. Older failures may predate existing memory fixes.

Desktop diagnostic logs spanning September 7–12 contain no `render-process-gone` entries. They do contain one network utility process killed with exit code 9 on September 10; its cause is unproven. A separate VS Code crash report dated September 12 06:40:39 records signal 5, which is not evidence of OOM by itself.

## Hub latency and allocation spikes today

Existing backend telemetry recorded 108 memory/stall diagnostic blocks on September 12 through the scan:

- At 06:00:38 UTC: backend RSS 2.04 GiB and heap used 1.80 GiB; event-loop delay 1,470 ms with 450 ms GC overlap.
- At 08:03:18 UTC: RSS 2.03 GiB and heap used 1.79 GiB; event-loop delay 1,276 ms with 367 ms GC overlap.
- At 08:14:07 UTC: event-loop delay 1,703 ms with 602 ms GC overlap.
- Memory subsequently falls substantially. This supports transient allocation/GC pressure; it does not by itself establish a permanently retained leak.

An adjacent registry snapshot took 1,437 ms, but its detailed phases attribute 1,427 ms to **waiting for the event loop**, while actual summary work took 8 ms. Optimizing that snapshot based only on its total duration would target the wrong work. A chat navigation nearby took 2.1 seconds, consistent with the user-visible consequences of backend stalls.

The compatibility projection remains an allocation-profile candidate: `apps/drone/src/host/hub-state-projection.ts:24` clones through JSON and the projection can reconstruct chats across real/pending/archived drones. `apps/drone/src/host/registry.ts:1119` coalesces concurrent projection loads but does not keep that projection after completion. This is **a code-review lead, not a measured allocation attribution**. Existing recent commits already contain memory fixes. A CPU/allocation sample during a reproduced stall is needed before choosing a code change; no heap snapshot or live debugger attachment was performed in this pass.

## Confirmed cause of the user's VS Code crash

The user clarified that the affected application was **VS Code**. A targeted **application journal** query (rather than the kernel-only OOM query) establishes the immediate cause of the September 12 **06:40:39 Europe/Zagreb** crash:

```text
update-notifier-crash[1416546]: OOM error in V8: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
update-notifier-crash[1416546]: Mark-Compact 3995.9 (4001.8) -> 3995.1 (4001.8) MB ... allocation failure; scavenge might not succeed
```

PID 1416546 matches the Apport crash report. Its command line is `/usr/share/code/code` with no renderer/utility subtype, identifying the main process. The crash report records 4,492,448 KiB RSS (4.28 GiB), 4,311,472 KiB anonymous RSS, zero process swap, and SIGTRAP. The process had been running approximately 14.2 hours, consistent with the September 11 16:28 startup log.

**Conclusion:** VS Code exhausted its own roughly 4 GB JavaScript heap; this was not a recorded Linux system-wide OOM kill. Plenty of machine RAM can coexist with an application heap-limit failure. This supersedes the earlier unknown-cause interpretation of SIGTRAP alone. Drone Hub's missing UI assets and September 7 worker OOMs do not explain this particular crash.

The allocation owner remains unproven. GC barely reduced heap usage immediately before failure, indicating most of that heap was still retained at the time. This does not identify a specific leak, extension, workspace or VS Code subsystem. Logs show a GitHub Pull Requests extension/version incompatibility, but there is no evidence connecting it to the fatal allocation. The retained Crashpad minidump is `735908c9-e3f0-432e-8d13-55d224ceffc6.dmp`; the Apport text has no JavaScript allocation profile. A main-process heap/allocation profile during renewed growth is needed to identify what to optimize.

Reproduction of the decisive evidence query:

```sh
journalctl --since '2026-09-12 06:35:00' --until '2026-09-12 06:41:00' --no-pager -g '1416546|Last few GCs|heap limit|Allocation failed|Mark-Compact|Scavenge'
```

## Optimization priorities

### Follow-up: last night and today specifically

A completed targeted kernel query from September 11 18:00 local time through the follow-up found no matching OOM kills, segmentation faults, traps, hardware errors or I/O errors. The corresponding systemd-oomd query also returned no entries. The September 7 OOM events do **not** establish the cause of last night's incident.

Desktop logs show a different failure sequence, with times below converted to Europe/Zagreb:

- **September 12 00:32:17:** five UI JavaScript asset loads failed, including `SettingsView-TDWH-BcY.js`. The dynamic import then failed and React logged a render error. This is direct evidence of an application-rendering failure, not a recorded memory kill.
- **01:54:28 and 02:09:01:** desktop startup reported an older running app build and required restarting the Hub backend.
- Recorded desktop exits in the inspected period had code 0; no renderer process death was logged.
- **06:40:39:** a separate VS Code crash report records SIGTRAP. Its underlying cause remains undetermined.

The failed hashed assets plus subsequent build-version mismatch suggest an open UI referencing assets replaced during a rebuild/update. That explanation is plausible but not yet proven: the asset failure records do not include HTTP status, and no exact user-reported crash time has been matched. The strongest current lead for the overnight Hub incident is asset/build consistency, not exhausted machine RAM.

1. **Contain worker spikes.** Add configurable per-worker memory/swap budgets and an aggregate fleet budget/concurrency policy. Size these against actual build/test workloads and allow explicit overrides. Preserve settings across create/clone/recreate paths. An arbitrary blanket cap on running jobs could kill legitimate work; no cap was applied. Docker documents the available controls in [resource constraints](https://docs.docker.com/engine/containers/resource_constraints/).
2. **Reduce resident Chrome workload.** Inspect Chrome's Task Manager to map large renderers to tabs/extensions and close or discard unused work. Use [Chrome Memory Saver](https://support.google.com/chrome/answer/12929150?hl=en-GB) for inactive tabs. The observed 51–52 GiB makes this the largest immediate RAM opportunity; process data alone cannot identify specific tabs.
3. **Stop verified-unused workers through Drone's lifecycle.** There are 219 running containers, but running/low CPU does not establish that a worker is disposable. Implement idle shutdown with protection for active prompts, terminals, services and scheduled work, plus wake-on-demand. Current fleet average is about 104 MiB working set per container, with substantial variation; savings require selecting actual inactive workers.
4. **Profile Hub allocations during the slow interaction.** Capture a bounded CPU/allocation profile and correlate with existing event-loop/GC telemetry. Investigate full compatibility projection callers and bulk chat materialization; replace proven hot paths with narrow/paged queries. Raising the Node heap limit alone would not fix allocation churn or fleet-wide pressure.
5. **Reduce per-container overhead and improve visibility.** Review eager port publication and long-lived background services. Add per-worker current/peak memory and OOM-event visibility, and persist container identity with failure events so removed-container incidents remain attributable.

The present evidence does not justify buying more RAM, clearing Linux caches, or treating more swap as the primary fix. The machine already has substantial available RAM between incidents; both unbounded worker peaks and Hub-local allocation stalls need targeted treatment.

## Evidence and reproducibility

Sources: `/proc/meminfo`, `/proc/pressure/*`, process status and `smaps_rollup`, repeated `vmstat`, Docker inspect and cgroup v2 memory files, kernel journal for the preceding seven days, `/home/zael/.config/Drone Hub/logs/desktop.jsonl*`, `/var/crash/_usr_share_code_code.1000.crash`, and `data/profiles/default/drone/hub.log`.

Local scratch snapshots: `/tmp/drone-memory-processes.json`, `/tmp/drone-memory-containers.json`, `/tmp/drone-memory-hub-events.json`. Process snapshots include command lines and should remain local; they are not committed. No test suite was run because this change only records investigative findings.
