# Explorer and Companion request timeout diagnostics

Every Explorer directory request (including polling, cache revalidation and each retry),
Companion Live voice settings read/write, current-workspace lookup and editor-file
request now gets an independent client request record. These records do not depend
on a navigation still being active.

## Reading the logs

Search the Hub log for `client request timing`, `hub HTTP request received`, and
`hub HTTP request timing`.

1. Start with a client record whose `outcome` is `timeout` or `error`.
2. Match its `requestId` to the server's `clientRequestId`. The browser sends this
   in `x-drone-client-request-id` before waiting for a response. The server's own
   `requestId` is also returned as `x-drone-request-id` and saved by the client
   when headers arrive.
3. A receipt without a completion indicates that request entered the Hub but
   has not finished/closed. A client record without a receipt leaves the delay
   before Hub entry unresolved (browser queue, transport, proxy, or a blocked
   server event loop). Absence is not proof of a network failure.
4. `headersMs` and `bodyMs` are elapsed client milliseconds since request start.
   Missing headers means the browser did not observe response headers; present
   headers with missing body completion separates a body-read failure.
   Optional Resource Timing includes browser queue/connection time (`queueMs`),
   response download time, and protocol when available. Aborted or ambiguous
   concurrent requests may have no Resource Timing entry.
5. Compare server durations and phases with `hub event loop stall` records at
   the same time. Server entry starts at the JavaScript request callback, not
   at kernel socket arrival.

Companion phases include settings reads/writes, request-body reads, current
workspace inventory, catalog inventory, device directory, saved access reads,
authorization and editor stat. Parent phases include child phases: do not add
all phase durations. Repeated authorization checks accumulate in one phase.
Phases are recorded on failure as well as success, after the measured operation
settles. A currently blocked operation will not yet have a completed phase.

Directory deadline cancellation carries `TimeoutError`; navigation cancellation
remains `aborted`. Each retry has a separate request ID. Existing retry counts
remain in navigation telemetry when that navigation is still active.

## Bounds and limitations

Only fixed operation names, method, IDs, timestamps, outcomes, status and bounded
numeric timings are accepted by `POST /api/telemetry/request`. File paths, query
strings, bodies and exception messages are omitted. The existing server HTTP
completion log still records the endpoint pathname without its query.

Uploads retry every five seconds with a five-second upload timeout. The in-memory
queue retains at most 50 records for ten minutes and does not survive a page
reload. Each request produces at most one client record. Receipt logs are limited
to these operations with a valid client ID, and their fast completions are retained
for comparison. Telemetry uploads do not instrument themselves.

This adds diagnosis, not a fix for the underlying stalls. Build the shared
hub-model package, Hub and UI, then restart the Hub and reload the UI to activate
both ends. Deployment is separate from this source change.
