# Mobile browser performance

The Android browser keeps one authenticated WebSocket tunnel per WebView HTTP connection. Sequential requests reuse that tunnel and its upstream TCP connection when HTTP response framing permits it. Every request still validates the local host, origin and session cookie. The gateway supports content-length, chunked responses and trailers, HEAD/no-body responses, EOF-delimited streams, uploads, and WebSocket upgrades. A service's `Connection: close`, unframed response, disconnect, or malformed response ends the connection. Requests are never automatically replayed.

The hub reuses a session's successful port lookup for up to two seconds. It refreshes active sessions every two seconds, coalesces concurrent refreshes, and closes sessions when mappings disappear or change. A transient refresh failure preserves existing streams but invalidates the cached check and blocks new tunnels until validation succeeds. Device authorization is checked for every tunnel; grant revocation and session expiry still close existing streams. Port-map changes can therefore take up to the refresh interval plus lookup time to be observed, rather than requiring a lookup for every new connection.

WebSocket per-message deflate is negotiated with capable clients (including OkHttp 4.12); older clients can still connect without it. Compression uses level 1, a 1 KB threshold and bounded concurrency. Compression dictionaries are not shared between messages. The existing 64 KB inbound message limit applies to decompressed messages. Already-compressed assets may gain little from this transport compression.

## Diagnostics

Open **Browser diagnostics** using the gauge button in the browser's bottom bar, then **Copy diagnostics**. The panel refreshes once per second while open. Reports contain numeric aggregates and an opaque session ID, never paths, URLs, headers, tokens, cookies or response contents. Existing app logs also receive `[browser-load]` and `[browser-page]` summaries.

- `targetLookupMs`: initial port-list request through the device connection.
- `sessionSetupMs`: previous-session cleanup, hub session creation and native gateway startup, broken down as `previousCloseMs`, `hubOpenMs`, and `nativeStartMs`.
- `pageLoadMs`: elapsed time between WebView load-start and load-end callbacks. This callback also fires for failed loads; it is not proof of successful rendering.
- `firstContentfulPaintMs`, `domContentLoadedMs`, `documentLoadMs`: latest document's browser Performance API timings relative to navigation start. Missing values mean unavailable or not reached. These are untrusted page-reported diagnostics, not control inputs.
- `resourceCount`, `resourceTransferBytes`, `resourceEncodedBytes`: resource timing entries available for the latest page. Cross-origin restrictions, browser entry limits, caching and incomplete requests can make these partial totals. They do not measure outer tunnel compression.
- `requests`, `completedRequests`, `reusedRequests`, `incompleteRequests`, `httpErrors`: session-wide HTTP counters. An incomplete request may be cancellation or failure. Upgraded WebSocket requests complete when their connection ends.
- `tunnelsCreated`, `tunnelsOpened`, `compressedTunnels`, `activeTunnels`, `transportFailures`: tunnel creation, negotiation and current usage.
- `tunnelConnectMs`, `firstByteMs`, `requestMs`: sums, not page wall time; concurrent requests overlap. Divide by `tunnelsOpened`, `firstByteCount`, or `completedRequests` respectively for averages. Initial first-byte timings include tunnel setup.
- `sentBytes` and `receivedBytes`: session-wide HTTP tunnel bytes before compression, including headers and HTTP framing.

The hub writes `[browser-tunnel]` on each tunnel close, correlated by `sessionId`. It includes upgrade and upstream-connect timings, compression negotiation, failure category, logical and wire byte counts, and session mapping-check totals. Wire counters cover WebSocket framing after the handshake, before outer TLS/Tailscale overhead. Mapping counters are cumulative session values; do not add them across tunnel log lines. `mappingChecks` excludes initial session creation. Close the browser after a measurement to flush persistent tunnel summaries.

For a useful comparison, open a fresh browser session on the same drone and path, wait for the page to render, copy diagnostics, and close it. Repeat on Wi-Fi and cellular. Compare first paint and document timing, connection reuse, setup times, and hub wire bytes. Transport tests with highly repetitive payloads demonstrate protocol behavior, not expected savings for a particular app.

## Validation

From `apps/drone`:

```sh
node --require ts-node/register --test tests/node/device-browser-sessions.test.ts
```

From `apps/drone-hub-mobile/android`:

```sh
./gradlew :browser-tunnel:browserGatewaySmoke --offline --console=plain
```

The native smoke test uses real OkHttp against a local Node WebSocket fixture as well as fragmented framing and authentication tests. The fixture downgrades WSS to local WS only inside the test factory. Production still requires WSS.

Native changes require rebuilding/installing the Android app. The hub changes require rebuilding/restarting the hub. No live runtime is changed by these tests.
