# Companion Live: quiet progress, overlapping transcripts, and timing

## Implemented behavior

GPT-Live still owns delegation. Transcript deltas never initiate backend work on their own, and the existing delegation debounce is unchanged.

Complete public assistant messages that precede tool work now reach Live through `session.thinking.append`. Live decides whether to mention them. Final backend replies also use `session.thinking.append` following the user’s quiet-delivery experiment. This is unconditional application routing, with no backend model classification. Live can still choose to mention the context. This follows the [Live delegation guide](https://developers.openai.com/api/docs/guides/live-delegation): thinking appends supply background context, while commentary requests spoken delivery.

Blip marks assistant messages ending with `stopReason: toolUse` as intermediate. Companion forwards those messages with a stable update ID and request ownership. It does not forward reasoning, raw tool payloads, token fragments, incomplete/failed messages, or the final message through this channel. Updates are deduplicated and filtered for the latest request. Ownership is frozen at the start of each model response, so a correction arriving during streaming does not relabel old progress. Progress received before Live is ready is discarded; final replies still wait for readiness. Oversized progress is skipped whole to avoid dropping a qualification, and accepted messages use at most four 400-byte appends.

Timestamped transcript fragments are grouped separately for each speaker, ordered by their audio offsets, and merged across short acknowledgments. Late fragments can repair provisional groups while preserving the older group ID. The 1.2-second grouping gap is a display heuristic, not a turn boundary. Backend context includes timestamp ranges so overlapping speech remains identifiable. Missing or invalid timestamps retain legacy grouping; timestamp-less groups sort after timestamped groups. Storage is bounded to 18,000 characters including row overhead and 2,000 fragments.

## Timing collection

Both clients log bounded, content-free JSON with the prefix `[CompanionLiveTiming]`. Each connection attempt has a new `sessionId`, and elapsed times use the client's monotonic clock. At most 2,000 records are emitted per attempt. Stages include:

| Stage | What it establishes |
| --- | --- |
| `session_started`, `capture_started`, `live_ready` | Client attempt start, capture availability, and usable Live connection. Mobile permission/background-control preparation precedes this attempt clock. |
| `delegation_received`, `backend_dispatched` | Receipt of a client delegation and dispatch to the backend adapter. `dispatchMs` measures the adapter wait, including transcript debounce. |
| `backend_update`, `backend_result` | Eligible progress or a deliverable final result reached the Live adapter. |
| `append_socket_sent` (desktop) | The append was sent to the Hub WebSocket. |
| `append_relay_accepted` (mobile) | The Hub accepted the mesh append request. |
| `first_audio_received` | First output PCM observed initially or after each deliverable backend result. |
| `first_playback_scheduled` (desktop) | Web Audio scheduled a chunk; `queueMs` measures its audio-clock wait and `durationMs` its length. |
| `first_playback_completed` (desktop) | A scheduled buffer's completion callback fired. |
| `first_playback_native_enqueued` (mobile) | Native `playPcm` accepted a chunk. This is **not** a playback-start/completion measurement. |
| `session_closed` | Client connection cleanup began. |

`resultSequence` advances on each deliverable final result. Audio stages are sampled once per sequence, rather than logged per frame. They measure chronology only: continuous Live audio does not identify the backend result that caused it. Already-playing audio can complete after a new result arrives. Neither relay acceptance nor playback callbacks establish that Live spoke the result, and no metric establishes when sound reached the user's ear. API append acknowledgments are not currently collected.

Dispatch attaches `liveSessionId`, `liveDelegationId`, and `liveDispatchMs` to the existing validated Companion client telemetry. Backend records persist these under `client` in `companion_message_telemetry.payload_json`, alongside `coldStart`, `connectionMs`, `connectionReused`, setup phases, model timing, and tool timing. Client connection fields live under `client`; phase and cold-start fields are at the record root. This joins a normal delegated request to its backend setup cost without recording speech or progress content in diagnostics. Follow-ups steered into an already-running request share that original backend run's telemetry rather than creating a separate setup measurement.

Client logs are local diagnostics; they are not automatically stored in the Hub database. To inspect joined records without loading prompt text:

```sql
SELECT started_at,
       json_extract(payload_json, '$.client.liveSessionId') AS live_session,
       json_extract(payload_json, '$.client.liveDelegationId') AS delegation,
       json_extract(payload_json, '$.client.liveDispatchMs') AS dispatch_ms,
       json_extract(payload_json, '$.coldStart') AS cold_start,
       json_extract(payload_json, '$.phases.handleSetupMs') AS setup_ms,
       json_extract(payload_json, '$.phases.agentRunMs') AS agent_ms
FROM companion_message_telemetry
WHERE json_extract(payload_json, '$.client.liveSessionId') IS NOT NULL
ORDER BY started_at DESC LIMIT 200;
```

## Baseline before considering prewarming

Read the latest 200 records from the local default-profile Hub database on 15 September 2026. Their time window was 12 September 07:53:50 UTC through 15 September 12:21:09 UTC. Of these, 178 completed: 72 cold and 106 warm. This is a mixed workload, not a controlled Live-only experiment.

| Completed requests | Median handle setup | p95 handle setup | Median agent run |
| --- | ---: | ---: | ---: |
| Cold (72) | 286.9 ms | 491.8 ms | 15,418.0 ms |
| Warm (106) | Not run | Not run | 11,892.5 ms |

Here p95 is the sorted sample at index `floor(n * .95)` (zero-based). Settings and credentials each had sub-millisecond medians in both groups. `handleSetupMs` already contains nested handle configuration phases; do not add them again. The difference in cold/warm agent runtime is not evidence that prewarming speeds up inference: these requests had different work.

The likely saving from prewarming this setup path is a few hundred milliseconds on cold runs, subject to cache reuse and whether preparation finishes before delegation. It does not address the roughly 15-second median agent run in the cold sample. Prewarming is intentionally deferred until Live-specific measurements justify its extra lifecycle complexity.

## Validation

Regression coverage includes intermediate-vs-final runtime classification, quiet-only delivery, duplicate/oversized/stale updates, cancellation/reconnection, correction ownership during streaming, timestamp overlap and late-fragment repair, bounded transcript/diagnostic retention, metadata validation, and distinct scheduling/native-enqueue measurements. Desktop and mobile Live connection/context/lifecycle suites exercise the shared changes. Runtime tests use a temporary `BLIP_DATA_DIR`; no production session is modified.

These checks use a fake backend/provider and audio devices. This implementation has not yet been tried in a new end-to-end physical-device voice conversation. The earlier [16-session live API investigation](companion-live-mid-speech-delegation-2026-09-15.md) tested initial delegation timing, not these progress updates.
