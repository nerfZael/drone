# Persistent Companion Live session timing

New PCM Live connections now persist a bounded, content-free timeline in the profile's Hub database. Both desktop and mobile use the existing authenticated voice control transport. No separate telemetry credentials or device permissions are needed. Older sessions cannot be backfilled from these events.

## Inspect a session

The authenticated Hub endpoint `GET /api/companion/telemetry/live` reports the most recently created retained timing session. Pass `?sessionId=live-...` to select an earlier connection attempt. A reconnect creates a new timing session. The response contains:

- Startup, capture-to-first-send, provider connection and provider session-start waits.
- Delegation dispatch wait and client-observed backend round trip.
- Backend runs joined through `client.liveSessionId`, retaining setup, queue, first output, tools, compaction and model details from existing telemetry.
- `backend.activeWallMs`, the union of backend run intervals; overlapping runs are not counted twice. Run, tool and non-tool sums are labeled separately and must not be added to the active-wall figure. Tool and non-tool metrics may be absent on older/failed runs.
- `clientAdapterAndTransportMs`, only when one backend record matches a delegation: the client round trip minus backend run duration. This includes client adapter/connection work and transport in both directions, not pure network latency. Missing, negative or ambiguous matches remain null.
- Each append's Hub receive-to-forward duration, Hub-observed provider acknowledgment wait, and client-observed submission-to-acknowledgment wait, correlated by event ID.
- Result-to-next-audio chronology and sampled audio-to-playback observations. These do not establish that Live spoke a particular result.
- Raw allowlisted events and coverage flags for missing client sequences, truncation, client close and provider close. `storage` says whether persistence is using the database or the in-memory fallback.

The existing `GET /api/companion/telemetry` report remains available. Detailed backend HTTP header/first-content/streaming measurements remain in `message.requestMetrics` in `companion-blip.sqlite`, where the selected adapter supplies them; use the returned backend session IDs and run time windows to inspect those records. They are not replaced by the voice timeline. See [request instrumentation](native-request-instrumentation.md).

Read-only SQL for recent timing sessions:

```sql
SELECT session_id, first_received_at, last_received_at
FROM companion_live_sessions
ORDER BY first_received_at DESC, rowid DESC LIMIT 10;

SELECT source, sequence, received_at, payload_json
FROM companion_live_timing
WHERE session_id = ?
ORDER BY source, sequence;
```

## Meaning of the measurements

Client and Hub elapsed times each use a local monotonic clock. The Hub records wall-clock receipt times for discovery, not one-way network calculations. Do not subtract a client elapsed time from a Hub elapsed time. Provider acknowledgment waits include network transit and provider context injection; they are not provider-only compute times.

The Hub records settings/credential preparation completion, upstream socket opening, provider session readiness, initial input/output audio observations, append handoffs, delegation receipt and closure/errors. Client startup and capture events are buffered until the voice control connection is established.

[OpenAI's append acknowledgments](https://developers.openai.com/api/docs/guides/live-delegation#send-the-right-kind-of-update) match `client_event_id` to the submitted `event_id`. They indicate estimated context injection, not speech completion. The Hub forwards only acknowledgment type and correlation ID to the client.

[Transcript fragments](https://developers.openai.com/api/docs/guides/live-conversations#transcript-deltas) provide session-relative `start_ms` and `end_ms`. We retain these numbers and the observation time without retaining transcript text. They do not provide an authoritative speech-end/turn boundary. There is no fabricated speech-end timestamp.

The first received audio chunk initially and after each deliverable backend result carries a playback sample ID. That ID stays attached through delayed callbacks, so old playback cannot be assigned to a newer result. Browser Web Audio and iOS player render clocks and Android's AudioTrack playback-head counter are observed approximately every 10 ms for sampled chunks, with a 10-second observation deadline. These are output/render-clock observations, not measurements of sound at the ear; callback scheduling and Bluetooth/device latency still matter. Missing playback observations remain missing. Native enqueue acceptance stays a separate milestone. Older mobile binaries use that fallback until updated.

## Bounds and failure behavior

Each connection retains up to 2,000 client events and 2,000 Hub events. Up to 100 sessions are retained; backend records retain their existing separate limit. Client batches contain at most 100 events and normally flush after one second. Mobile also flushes on its native-clock heartbeat so suspended browser-style timers do not prevent collection indefinitely. Events are deduplicated by session, source and sequence. Retention scans the small session table only when a session is created, rather than scanning the full event log for every audio-related observation.

The Hub validates identifiers, stage names, finite nonnegative durations and bounds. It strips all other fields, including speech, audio, prompts, tool arguments and credentials. Client events cannot claim Hub/provider stages or a different session. Mesh controls retain device/session ownership checks.

Diagnostic upload failures do not fail the voice session or trigger voice reconnection. Uploads are best effort, with gaps visible in sequence coverage. Closing stops local capture/playback immediately and gives the final diagnostic flush at most 300 ms before remote teardown. Abrupt process termination, disconnection, failed startup before transport ownership, stalled uploads, retention and the event cap can leave incomplete traces. `clientSessionDurationMs` ends when client cleanup begins, not when remote billing ends. Mobile permission/background-control preparation still precedes the timing attempt.

## Verification and rollout

Tests cover persistence across telemetry-service recreation, duplicate batches, content stripping, bounds, missing data, clock separation, overlapping backend runs, append acknowledgment correlation, transport ownership, final flush, and delayed playback sample identity. Android's playback harness verifies that writing/enqueueing audio does not count as playback and that samples start/complete only when the output frame clock advances.

Deploy the updated Hub and desktop bundle, and rebuild/install mobile for native playback observations. Physical-device timing and iOS native compilation still require their respective device/build environments. The automated tests use simulated provider/audio behavior; they do not establish actual microphone-to-ear latency.


## Backend failure propagation

Companion now checks Blip's terminal outcome before returning a reply. An error event followed by a resolved prompt promise still rejects the Companion run, preserving the provider and error description. Both WebSocket and mesh run delivery emit an error for that message, not an empty reply plus a completed status. A subsequent successful run is unaffected.

The shared client publishes the failure in UI state. Live observes that transition once, including failures that occur during reconnection, and receives a bounded failure explanation rather than “Check Companion for details.” Promise rejection and state observation share error ownership to prevent duplicate delivery. Old request errors cannot cancel a newer request; session-wide errors still terminate the affected connection. Long errors stay fully available in UI state while Live receives the failure and a shortened reason. Since tools may have run before a later model failure, the explanation does not claim that no actions occurred.

Failure timing uses `backend_error`, and the joined delegation report labels its status as `error`. Empty replies from genuinely successful runs state that completion of the requested action is unconfirmed.
