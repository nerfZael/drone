# MCP discovery latency: measured authentication overhead

**Fix implemented 24 September (Europe/Zagreb):** chat authentication now uses
indexed canonical metadata reads. See the follow-up measurements below.

The delay is reproducible in Drone Hub's chat-token authentication. It loads
the full compatibility registry on every MCP HTTP request to validate a single
chat. With the current Hub data, that costs roughly two seconds per request.
One Codex inventory operation makes several such requests, accumulating most
of the observed 6–9 second delay before it returns its tools.

All prior branch changes were committed first as `4cc61b01`. The instrumentation
and this follow-up are separate, uncommitted changes.

## Measurements

An isolated instance of the instrumented MCP HTTP transport used the existing
Hub database and a valid token for drone `0cdc0a56-dd4a-49b0-a348-f0138f82fe9e`,
chat `6 and 7`, stable chat ID `3e078624-117f-4456-a21e-3d0738c9b050`.
No model turn or tool call was started. The production Hub was not restarted.

Direct localhost requests separated server work from Docker networking and
Codex. Two passes with a chat-scoped token measured:

| Request | Total time, first / second pass | Authentication, first / second pass |
| --- | --- | --- |
| `initialize` | 2555 / 2413 ms | 2497 / 2379 ms |
| `notifications/initialized` | 2446 / 2348 ms | 2418 / 2312 ms |
| `tools/list` | 2321 / 2348 ms | 2166 / 2233 ms |

Wrapping `loadRegistry()` measured 2166–2495 ms per call, matching almost all
authentication time. A legacy-token control, which does not perform the
chat-registry lookup, took 18–23 ms for initialization/notification and
123–128 ms for the same 70,091-byte tool inventory. This control isolates cost;
it is not a recommendation to grant chats broader credentials.

Then the real Codex executable in the affected container queried process-level
inventory twice against the diagnostic listener using the same chat identity.
The process initialization took 225 ms. Inventory calls took **6579 ms** and
**8602 ms**, both returning all 65 Drone Hub tools.

Each inventory call made three POST requests (initialization, initialized
notification, and tool listing) plus a GET for an unsupported SSE stream. Each
request spent 1909–2271 ms authenticating, including the GET that returned 405.
Some requests overlapped, so summing their elapsed times overcounts wall time.
Catalog construction took 12–29 ms per successful POST. The raw, credential-free
trace is in [codex-timings.jsonl](./combined-plan-mcp-discovery-2026-09-23/codex-timings.jsonl).

The user's thread had become active, so the successful instrumented probe used
process-level inventory without resuming that thread. It reproduces the slow
discovery path but does not establish every internal detail of the earlier
thread-scoped requests. Earlier attempts to reproduce with a thread were stopped
when Codex reported an active writer. A discarded diagnostic attempt also had a
request-body observer that consumed the stream; it was corrected before the
saved measurements above.

## Source explanation and next fix

`authenticateChatMcpToken()` in `apps/drone/src/hub/mcp-tokens.ts` calls
`loadRegistry()` before locating the chat and its access scope. Under the
production Node runtime, that function builds `buildHubStateProjection()`,
which reconstructs drones, chats and their transcripts, archived state,
catalogs, and other compatibility data. Authentication needs only the current
chat identity, permissions, and selected drone names.

The next fix should replace this full-registry read with focused canonical
metadata reads while preserving repaired chat identities, renamed chats,
deletion checks, and current permissions on every request. Caching permissions
or bypassing authentication would change security behavior and is unnecessary.

The 30-second timeout remains a mitigation. These measurements establish the
dominant reproducible cost, but cannot reconstruct the exact scheduling or
load spike that pushed the two historical failures beyond ten seconds.

## Instrumentation and verification

- `DRONE_MCP_DIAGNOSTICS=1` in the daemon process emits timings for Codex
  initialization, thread preparation, and inventory RPCs through the existing
  run stderr sink, including failed/timed-out requests.
- The same flag in the MCP bridge process emits HTTP-header, remote
  initialization, and completed tool-list timings. Set it explicitly in that
  process's environment; Codex's configured MCP environment allowlist does not
  automatically forward an arbitrary daemon variable.
- The bridge requests `x-drone-mcp-diagnostics: 1`. The HTTP transport then
  returns authenticated `Server-Timing` phases for authentication, body reading,
  catalog construction, and transport connection. The header describes time
  before response handling, not response-body completion; the bridge's tool-list
  measurement covers the complete RPC.
- Logging omits credentials, prompts, RPC parameters, endpoint URLs, chat names,
  and tool bodies. It is disabled by default. No production process was switched
  to persistent diagnostic logging during this investigation.

All 27 targeted tests passed. After strengthening the failed-RPC and
unauthenticated-header assertions, the affected 22-test subset passed again.
Drone's TypeScript check and `git diff --check` passed. Tests cover opt-in timing,
credential omission, failed RPC reporting, HTTP header gating, and existing
MCP startup/authentication behavior.

## Proper fix and remeasurement, 24 September

`authenticateChatMcpToken()` now resolves repaired IDs, looks up the active chat
by the existing unique identity index, verifies that its drone is still active,
and reads only the selected drones' names. The current permissions are read on
each request. Missing canonical rows deny access rather than falling back to
stale registry state. The registry implementation remains only for runtimes
without native SQLite.

Repeating the same benchmarks against the existing database produced:

| Measurement | Before | After |
| --- | --- | --- |
| Chat authentication, warm direct HTTP requests | 2.2–2.5 seconds | 0.5–0.7 milliseconds |
| Codex inventory, first pass | 6579 milliseconds | 286 milliseconds |
| Codex inventory, second pass | 8602 milliseconds | 233 milliseconds |

Both Codex calls returned all 65 Drone Hub tools. Cold store initialization
added approximately 5 milliseconds. No full-registry reads occurred. Raw results:
[HTTP timings](./combined-plan-mcp-discovery-2026-09-23/auth-fixed.jsonl) and
[Codex timings](./combined-plan-mcp-discovery-2026-09-23/codex-fixed.jsonl).

Four native Node/SQLite tests passed, covering repaired identities and renamed
chats plus a new test that forbids full-registry loading and transcript hydration.
The new test also verifies current permissions and drone names, cross-drone
rejection, invalid signatures, removed drones, deleted chats, and reused names.
All seven MCP HTTP tests passed, including legacy runtime behavior. TypeScript
compilation passed. These measurements used an isolated diagnostic endpoint;
the production Hub still needs a restart to load the compiled fix. No user turn
was started or interrupted. The fix and instrumentation remain uncommitted.
