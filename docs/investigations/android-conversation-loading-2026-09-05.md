# Android conversation loading and creation investigation

Investigated and repaired on 2026-09-05 using the connected Android device, its persisted mobile loading diagnostics, the running hub's SQLite state and logs, and the source. The findings and screen reconstruction below describe the original behavior; source line numbers refer to that revision. Implementation and deployment results follow at the end.

## Findings

### 1. Native startup prompt never reaches execution

**Confirmed.** “Find Fitbit Air in Split” is a host drone with the native agent, provider `codex`, model `gpt-5.6-sol`, and no repository. Its drone ID is `a480b545-8764-4383-8132-982234b0e87c`.

Its original prompt was created at 20:43:15 UTC. During inspection after 21:01 UTC, the durable `prompts` row was still `queued`, with `attempt_count = 0`, no lease, and no last error. The native thread was idle without an error. The phone eventually displayed only the original queued prompt, while the sidebar called the drone “Ready.”

The failure crosses two queue owners:

1. Provisioning reserves the initial prompt in the shared queue. The log confirms `adoptedReservedPromptCount: 1` and `chatsPumped: 1`.
2. The generic pending-prompt worker sends it to the native submission path without claiming it, correctly leaving the claim to the native worker.
3. `enqueueThreadPromptWithResult` finds the existing prompt ID and returns `inserted: false`.
4. `submitAssistantPrompt` returns on that flag before `startAssistantPromptDrain`.

The duplicate protection confuses an accepted but unprocessed reservation with work already being delivered. The atomic queue claim should protect execution; an existing queued reservation still needs a worker wake-up.

Relevant source:

- `apps/drone/src/hub/drone-provisioning.ts`: reservation adoption and startup pump scheduling.
- `apps/drone/src/hub/chat-prompt-runtime.ts:2430`: native queue ownership and dispatch.
- `apps/drone/src/hub/assistant.ts:2683`: existing prompt returns `inserted: false`.
- `apps/drone/src/hub/assistant-runtime.ts:1041`: notification, duplicate return, and skipped drain.

### 2. The stuck prompt creates a feedback loop

**Confirmed by the control flow, supported by repeated live sync activity.** Before the duplicate return, native submission calls `notifyNativePromptQueueChanged`. In `server.ts:4344`, that callback emits a chat write and re-enqueues the generic pending-prompt worker. `PendingPromptPump` preserves a re-enqueue while active. The same unclaimed prompt therefore goes through preparation again and again.

Each pass can repeat managed-file synchronization, chat initialization, native-thread persistence, and queue notifications without executing the prompt. Live logs show repeated managed-state syncs for this specific native drone, interspersed with hub event-loop stalls of roughly 3–4 seconds, near-total event-loop utilization, and about 3.1 GB resident memory.

This is a shared hub slowdown, so another conversation can wait too. The exact division of CPU time among registry projection, persistence, and garbage collection requires profiling; the logs establish the stalls, not a sampled CPU attribution. The repeated path includes `ensureChatEntry` calling the full compatibility `loadRegistry()` projection.

### 3. Mobile discards successful conversation responses

**Confirmed.** `DronesScreen.tsx:606` increments `chatReadVersion` on cache invalidation. Chat-change events invalidate the active chat and queue another read. At line 1013, a successful response is discarded if an event changed that version while the request was in flight.

This can starve rendering indefinitely during frequent events. The native queue loop continually provides those events. Active Codex output can also trigger the same race.

Phone diagnostics:

| Conversation | Navigation start, UTC | Evidence |
| --- | --- | --- |
| Native Fitbit | 20:54:33 | 45.0-second diagnostic timeout; 12 successful reads, no fresh application/commit |
| Codex Fitbit | 20:48:33 | First successful response after 3.04 seconds; content applied only after 14.56 seconds and several further reads |
| Another conversation | 20:49:04 | About 3.26 seconds to display, consistent with the shared slowdown |

Reads for different chats already run independently: `MobileChatReadCoordinator` is keyed by device, drone, and chat. Switching does not cancel the previous ordinary read. Returning to a chat whose read is still active can join the obsolete request and await a trailing refresh. Opening also waits on `chats.list`, even if history has arrived. Ordinary requests time out at 40 seconds, but that timeout does not abort their underlying HTTP fetch; the 45-second navigation diagnostic timeout is a separate measurement.

## Mobile creation and screen flow

1. Open drone navigation, enter a repository or “Ungrouped / No repository,” and press its create button. The chat actions menu also offers creation.
2. “New drone / CREATE ON DESKTOP” shows an optional name, a large empty center area, the Host/Container picker, the first-message composer, model/reasoning, agent, access/approvals, and repository controls. On the inspected phone it remembered Container, Codex, 5.6 Sol Medium, Execute / Never ask, and No repo. These are remembered choices, not universal defaults.
3. With a repository selected, branch controls apply; a container using a remote branch requires a branch selection. A first message or image is required. Images are uploaded before creation. An omitted name can be generated from the message.
4. Send calls `drone.create.host` or `drone.create.container`. The server reserves the prompt and provisions the runtime asynchronously. The mobile client selects an optimistic `default` chat and shows the queued first message while the drone is starting.
5. Provisioning creates the runtime, materializes/configures the chat, synchronizes files, clears provisioning metadata, and wakes prompt delivery. The actual examples took **28.5 seconds for host** and **79.6 seconds for container**, measured by the provisioning logs. Host chat configuration alone took 10.7 seconds; container runtime setup took 54.3 seconds. No repository was being cloned in either case.
6. Conversation refreshes during startup can encounter unavailable chat/native endpoints. `activateDrone` only defers reads when explicitly requested, currently for starting clones. Ordinary creation/event refreshes have no equivalent lifecycle gate. Raw operation errors, including “still starting,” pass through `mobileDroneChatErrorMessage` to the red error banner. No dedicated creation-progress view explains these phases. The exact historical red response was not retained in the phone diagnostics, so its particular endpoint cannot be established retrospectively.
7. If creation succeeds, the form is replaced by the chat. Subsequent display depends on refresh events; there is no explicit ready-transition read after the creation list refresh. An empty transcript can say “This drone chat is ready” without a lifecycle-specific explanation. Leaving a nonempty creation form can save a draft drone automatically.

The Codex example, “Find Google Fitbit Air in Split” (`9c497aa8-fcda-4d31-9d51-422247539791`), is a container drone with the Codex agent and no repository. Its final answer was visible on the phone. Native agent and host runtime are independent settings; “Ungrouped” is not itself the failure condition.

## Fix order and acceptance checks

1. **Repair native queue handoff and stop false notifications.** Wake the native drain for a queued reservation, preserve atomic claiming, avoid notifying/re-enqueuing unchanged duplicates. Cover reserved startup prompts, duplicate queued/running/completed requests, concurrent submissions, and restart recovery. Recover the existing queued prompt through normal delivery after the fix.
2. **Separate navigation validity from cache freshness.** Allow a response for the still-selected chat to display while a refresh is queued; retain protection against results from a different selection and against resurrecting deleted content. Verify continuous events cannot prevent first content from appearing.
3. **Cancel obsolete work end to end.** Scope cancellation/loading/errors to the selected conversation, abort HTTP work on cancellation/timeout, and pass cancellation through native bootstrap/history requests. Verify A → B → A with A stalled and with slow chat-list responses.
4. **Make startup an explicit normal state.** Show the accepted first message and clear progress such as “Creating workspace,” “Starting agent,” and “Sending first message”; trigger a read when ready; reserve red errors for failed provisioning/delivery with a recovery action. Test host/container × native/Codex, no repo/repo, images, automatic name, drafts, and reconnect during startup.
5. **Profile the remaining hub cost after breaking the loop.** Remove whole-fleet projection/persistence from single-chat preparation where possible. Compare creation and navigation timing under the same fleet size.

## Original investigation validation

- Read both chats' live state endpoints successfully: native approximately 230 ms; Codex approximately 10 ms on those particular calls. Those samples do not negate the measured intermittent stalls.
- Isolated the actual `submitAssistantPrompt` function from current source, transpiled it, and ran mocked queue outcomes: an existing reservation produced one notification and zero drain starts; a newly inserted prompt produced one notification and one drain start.
- Ran existing mobile coordinator, refresh, and error tests: **8 passed, 23 assertions**. They verify independent reads and current behavior, but do not cover the event-invalidation starvation or reserved native startup handoff.
- Inspected the Android screens directly. Did not submit a new drone, rerun the user's prompts, restart the hub, or install an APK. Startup reconstruction uses the original provisioning logs and source; a fresh end-to-end creation after fixes remains necessary.

## Implemented repairs

- Native submission now wakes delivery for a queued reservation without broadcasting a false insertion. Atomic claims protect concurrent retries, and completed/sending/failed duplicates do not restart delivery. The submission logic is extracted into `native-prompt-submission.ts` and exercised against the real SQLite queue and assistant service.
- Prepared native images and file references survive startup handoff. Preparation is durable and idempotent, preserves the original transcript message and attachment references, and cannot replace an already claimed delivery. A native worker waits for staged attachments before claiming them.
- Attached follow-up messages can queue during startup. Lifecycle metadata retains their contents until provisioning stages the files; it then creates the normal queue entry. Pending and ready drones share the existing acceptance path, including a startup-to-ready race during submission.
- Chat navigation cancels obsolete requests through the coordinator, mobile HTTP transport, mesh cancellation, and local Hub history/bootstrap requests. Cancelling one read leaves other requests and the event session usable. HTTP timeouts cancel the underlying request too.
- Refresh notifications no longer invalidate an in-flight response for the still-selected conversation. A trailing read gets newer content. Explicit invalidations and navigation retain stale-response protection.
- A slow or failed chat-list request no longer holds successfully loaded history or navigation busy. Late list results cannot redirect a newer selection. Navigation clears obsolete busy/error state, and late send acknowledgements do not modify another chat.
- Creation selects the accepted default chat with its first message visible. Startup reads wait for readiness, normal progress appears as muted text, and a ready transition loads the conversation automatically. Quiet polling covers missed startup events. A pre-creation list response cannot remove the newly accepted selection, and late creation responses do not pull the user back after navigation.
- Sending uses a stable request ID for optimistic and accepted messages. Acceptance releases the send action without waiting for background chat/list refreshes.
- Single-chat preparation, chat configuration, prompt acceptance, runtime name checks, provisioning metadata, and native file-change tracking use canonical lifecycle/chat metadata instead of loading the entire fleet's histories. Unchanged native-thread metadata no longer triggers a persistence write.

## Deployment and live verification

- Built the Android release APK successfully and installed it on the connected SM_F966B with `adb install -r`, retaining app data. The previous APK is saved at `/tmp/drone-hub-mobile-before-fix.apk`. The updated app launched successfully.
- Restarted the Hub with the existing UI/API ports, dev UI mode, and container MCP address. Native threads were idle at restart. The final backend optimization was activated in the subsequent restart. A temporary CPU inspector used during diagnosis was closed by that restart.
- The original native Fitbit prompt `ec7a49fb36e430d486` progressed through normal delivery from `queued` to `sending` to `sent`, with **one attempt**. Its native history now contains six entries. No replacement prompt was submitted and no queue row was manually modified.
- Both Fitbit conversations return successful state/history responses. Initial concurrent checks took 12–96 ms. After the final optimization, state reads took 3–43 ms and native history reads took 94–197 ms. These are local API samples, not Android network-to-render measurements.
- Live logs exposed a second bottleneck after the queue repair: another existing conversation's prompt endpoint spent **3,208.1 ms** in drone resolution. The final prompt route uses canonical metadata. Six deliberately invalid prompt IDs, rejected before enqueue, verified that resolution now took **0.1–0.3 ms**. These requests did not submit messages.
- A 20-second CPU profile after startup was mostly idle (about 17.6 seconds). Cold Hub startup still showed pauses during recovery; this change does not establish a zero-pause guarantee for Hub startup or arbitrary workloads.
- The phone showed an active dictation after launch. Further interactive navigation was paused to avoid disturbing it. No fresh live test drones were created. Host/container creation and attachment behavior were validated through the regression suites; the complete physical-device creation matrix remains a manual acceptance check.

## Regression results

- Mobile/backend TypeScript builds and Android release build passed; `git diff --check` passed.
- Focused mobile navigation, refresh, startup error, and mesh request tests: **21 passed**.
- Backend acceptance/provisioning/delivery/cancellation/native attachment/file-change and protocol tests: **139 passed, 462 assertions** (`/tmp/drone-backend-final.log`).
- Real Node/SQLite assistant, canonical read model, prompt queue, chat store, and lifecycle caller tests: **65 passed** (`/tmp/drone-node-combined.log`).
- Full mobile suite: **494 passed, 2 failed**. The sidebar source assertion expects `visible={workspaceVisible && filePreview.visible}`, which is also absent in the original `HEAD` source. The unchanged 4,097-event cryptographic replay test exceeds its hardcoded 15-second timeout, including when rerun alone. Neither failure comes from the loading/creation tests changed here.
- Local test logs and CPU profiles remain under `/tmp`; they are investigation artifacts, not committed product files.
