# Tailscale / HTTP / SSE implementation

Status: single-cutover code implemented and automated suites passing; real-device acceptance and deployment remain outstanding. Do not treat this as a production cutover approval.

The approved proposal is [DRONE_HUB_TAILSCALE_HTTP_SSE_PROPOSAL.md](DRONE_HUB_TAILSCALE_HTTP_SSE_PROPOSAL.md). This is a single replacement: no ngrok process manager, device-network WebSocket runtime, transport negotiation, or base64 chunk fallback remains. Storage compatibility is retained; that is not a legacy transport mode.

## Operating contract

Android **Devices → Add device → Nearby** starts foreground-only mDNS/DNS-SD browsing and a pairing-only listener/advertisement on TCP 8792. Discovery stays active until Stop, leaving the screen, or backgrounding. Short-lived signed proofs refresh automatically without restarting the listener; stale proofs still expire, and failure to refresh closes discovery. Desktop **Add device** advertises its HTTPS address and browses nearby phones while visible, with expiring local-admin leases for abandoned windows. Fresh signed HTTPS descriptors verify advertised Hub identities before requesting approval. **Find phones** also probes Tailscale IPv4 peers; desktop-initiated offers require matching codes and normal approval. No accounts or hosted services are added. Bootstrap HTTP exposes public pairing metadata only, separate from the HTTPS/Tailscale data plane. See [the Android test guide](apps/drone-hub-mobile/PHONE_DISCOVERY_TEST.md). Native iOS discovery/listening is not implemented.

Tailscale setup reports actionable errors for missing CLI access, connectivity/MagicDNS, permissions, conflicting listeners, and timeouts. An explicitly empty/null `CertDomains` status blocks Serve with an HTTPS prerequisite message; unavailable certificate-status fields remain unknown. The settings UI offers a DNS-settings link for confirmed HTTPS prerequisites, retry, and collapsed command diagnostics. Enabling certificates remains an explicit administrator action; DroneHub does not change tailnet DNS settings. This follows the [documented HTTPS setup prerequisite](https://tailscale.com/docs/features/tailscale-serve).

- Enable private Tailscale HTTPS in Devices settings. Existing unrelated Serve configuration is never reset, and a public Funnel listener is rejected. The canonical external port is 8791; discovery also probes 443. The command uses the documented [Tailscale Serve HTTPS proxy interface](https://tailscale.com/docs/reference/tailscale-cli/serve).
- Desktop discovery enumerates visible Tailscale peers and verifies nonce-bound signed descriptors. Unknown Hubs require explicit pairing approval. Existing device identities and destination-owned grants are retained.
- Mobile can find a Hub by its Tailscale name (ports 8791/443) or exact HTTPS origin, verify its nonce-bound signed descriptor, and request desktop approval without a QR code. QR/deep links remain alternatives. After pairing it verifies a signed directory and device-owned route sequences. It does not enumerate the mobile Tailscale VPN's peers or require a persistent phone listener; Android's opt-in temporary listener is described above.
- HTTP session v2 uses `/api/device-mesh/v2/session`: authenticated SSE GET plus session-authenticated JSON POST. Signed capability requests and existing authorization remain in use. Unsupported peers must update; the old transport is not attempted.
- Media uses `/api/device-mesh/v2/content/:id`. Workspace bytes and brokered phone previews use `/api/device-mesh/v2/workspace-content/:id`. Attachments use the existing token-authenticated HTTP upload endpoint. These tickets cannot select arbitrary upstream URLs.
- Transcript reads use bounded JSON, revision-aware delta responses, and gzip when accepted. Unchanged reads avoid retransmitting their full representation. This is application-level conditional reading, not a browser-cacheable GET API.
- SSE replay is bounded, short-lived, and advisory. Every reconnect reconciles state. No exactly-once or durable-event guarantee is claimed.
- Mutation acceptance is recorded before execution on desktop and mobile. A request accepted before a restart is not repeated automatically; an unavailable outcome is reported explicitly. Cancellation does not roll back completed mutations.

## File behavior and limits

JSON requests are limited to 8 MiB and capability results to 6 MiB. Existing product-specific attachment and preview limits remain. Binary network transfers do not use application chunk requests or base64 envelopes.

Workspace downloads stream in bounded buffers. Upload adapters stage to temporary disk files, then send a binary HTTP body. Retry resumes at the destination's authorized offset. This avoids Expo fetch's whole-body buffering; it adds disk I/O and is not itself a claim of lower upload latency. Small chat attachments still originate from the existing bounded in-memory picker representation, but native uploads avoid a second full Blob conversion. The native adapter uses Expo's documented [file upload task API](https://docs.expo.dev/versions/latest/sdk/filesystem-legacy/#filesystem-legacycreateuploadtaskurl-fileuri-options-callback); “legacy” in that package name is not a DroneHub transport fallback.

Phone-produced media is hashed in bounded reads and uploaded through its authenticated session's pending reverse request. A brokered download is unavailable until size and checksum validation succeed. Source phone files are not moved or deleted.

Downloads either resume against a validated resource version or restart cleanly. Workspace tickets bind the source stat revision; media tickets bind the Hub's authoritative revision. Concurrent workspace writes to the same upload path are rejected. No-overwrite commits use an atomic filesystem link rather than a stat/rename race.

Workspace transfer authorization is checked before streaming and at least once per second during streaming. Media transfers also respond to membership/grant changes. Phone upload authorization is checked during native upload. Temporary network failure is never interpreted as revocation.

## Data inventory and preservation

| Store | Contents | Cutover behavior |
| --- | --- | --- |
| Desktop `hub.sqlite` and canonical repositories | Drone runtime references, chats, transcript turns, prompt queues, related metadata | No transport-driven content schema conversion or reset. Populated native-SQLite fixture compares all tables across mesh initialization/reopen. |
| Host/container workspaces and existing attachment/artifact paths | User files, generated files, attachments | Paths and source bytes stay in place. Downloads are read-only; uploads retain existing explicit overwrite rules. |
| Desktop `device-mesh/state.json`, private identity key | IDs, pairings, grants, revocations, route metadata | Existing identity retained. Missing keys or unreadable state fail closed. State is copied to `.pre-http-v2` before replacement. |
| Desktop `device-mesh/ingress.json` | Listener and endpoint configuration | Recovery copy before writes. Old ngrok endpoint configuration is not used; paired records are not deleted. |
| Desktop mesh attachment sessions | Prepared uploads and partial/committed upload bytes | Session metadata is persisted. Startup/shutdown do not delete recoverable partials. Explicit user abort remains supported. |
| Mobile `droneHub.meshProfile.v1` and identity storage | Network membership, routes, phone-local grants, existing key | Existing key and profile retained; `.preHttpV2` recovery copy before profile replacement. Signed route sequences are additive metadata. |
| Mobile `droneHub.nativeChats.threads.v1` and existing transcript storage | Chat metadata, queued work, bounded thread projections and transcript references | No transport reinitialization. Unreadable saved chats are preserved and cannot be overwritten with an empty store. Existing legacy storage import retains its source. |
| Mobile native drone/group/sidebar keys | Drone IDs and chat/group relationships | Existing drone records are backed up before loading; unreadable drone/group storage blocks local operations instead of recreating records. |
| Mobile document artifacts, platform credential/key stores | Files and credential references | Unchanged; no reinstall, keystore reset, or credential export is part of this change. |

The SQLite preservation fixture uses SQLite's supported backup API and checks recovery integrity. It is not a raw copy of a live database. Recovery copies contain user data and must be protected. Never restore an older copy automatically over newer writes.

## Validation boundary

### Maintainability refactor

The HTTP session server owns admission, authentication, and subscription lifetime separately from logical message delivery. The shared workspace adapter is now a small composition layer: downloads own their stream and cleanup path, uploads own explicit staging/retry/commit states, and platform sinks own only disk staging and binary upload. This keeps desktop and mobile on the same retry policy without mixing their filesystem APIs.

Replacement staging allocation failures retain the prior staged bytes. Failed downloads release their stream before retry. Regression coverage also verifies that result-upload tickets are pending-request-bound, session-bound, and single-use. These changes do not introduce a transport fallback or alter saved content formats.

### Automated checks

The subsequent code review fixed these issues:

- Non-administrator signed directories could self-promote their issuer on mobile. Directory metadata updates now preserve that member's existing authority.
- Overlapping operations could race on shared workspace streams or staging files. Same-transfer operations now reject overlap, and download admission includes pending opens rather than only established streams.
- Reused download streams ignored the current caller's cancellation. Each read now installs and removes its own cancellation handler and releases the stream on cancellation.
- An incomplete commit could close the staging sink and prevent further writes. Completeness is checked before any upload or phase change.
- Mobile cancellation during the asynchronous native-module import could still start an upload; cancellation is rechecked after import, and native cancellation failures are caught.
- A valid `Range: bytes=0-` incorrectly returned HTTP 200. It now returns 206 with Content-Range; a mismatching If-Range still returns the full 200 response.
- Returned transcript objects shared the cache's delta baseline. The cache now stores a private snapshot so caller mutations cannot corrupt later reconstruction.

Automated coverage includes two-Hub discovery pairing, authenticated HTTP/SSE, a response larger than the old socket limit, grants and revocation, session-scoped cancellation, upload resume and overlap protection, lost commit responses, media checksums, transcript deltas, replay gaps, persisted mutation acceptance, and populated SQLite preservation.

Validation on 2026-09-05:

- Mobile and shared protocol: 484 tests passed across 84 files.
- Desktop UI: 1,216 tests passed across 222 files.
- Device and workspace HTTP integration: 142 tests passed across 20 files, including corrupt-state preservation and session-bound result uploads.
- Native Node/SQLite preservation fixture: passed, including populated table comparisons, source-file bytes, backup integrity, and reopen.
- Shared protocol build and all three application TypeScript checks passed. `git diff --check` passed.

Real-tailnet runtime and performance checks remain required before deployment: supported desktop platforms, Android/iOS builds, Tailscale Serve streaming, direct versus relayed paths, sleep/network changes, mobile memory, and file/transcript timing. No Android device was connected when ADB was checked. No live Hub or phone app has been restarted, reinstalled, or switched by this work; live Tailscale Serve configuration has not been changed.

Phone-produced preview uploads still run within the originating capability request's deadline. Very slow reverse uploads can time out; this must be exercised on real mobile connections. File hashing uses bounded reads, but its effect on mobile responsiveness also needs measurement.

Do not deploy mixed old/new device-network versions. Update participating devices together without clearing application storage. Local content remains available when Tailscale is unavailable. A measured speedup is not claimed until the real-device comparison is performed.

### Nearby Pairing follow-up validation (2026-09-05)

Android native compilation and debug APK assembly passed. Mobile/shared protocol tests passed (487 tests); desktop UI tests passed (1,219); focused discovery tests passed (10); pairing integration tests passed (14), including rejection of unauthenticated/public access to the LAN-discovery administration endpoint. All three application TypeScript checks passed.

Discovery coverage includes expiring/multi-window desktop leases, network cleanup, socket-error reporting, restricted LAN probe addresses, signed phone metadata, stable confirmation codes across LAN/Tailscale scans, bounded HTTPS advertisement parsing, and matching advertised identities against fresh signed Hub descriptors. No storage migration or reset is introduced. Real-device Wi-Fi discovery, background/foreground behavior, and router/firewall compatibility remain manual acceptance checks; an APK build is not proof of those outcomes. The app has not been installed or a running Hub restarted by this follow-up.
