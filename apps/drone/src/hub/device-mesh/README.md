# Device network

DroneHub uses private HTTPS over Tailscale for device communication, with one authenticated SSE subscription per peer. The old device-network WebSocket and ngrok runtimes are removed. Unrelated local Hub WebSockets are unchanged.

Android's **Browser** action opens a selected remote drone's HTTP web app. Grant the phone
`browser.targets`, `browser.open`, and `browser.close` under `drone-control`. Existing file
permissions do not automatically grant browser access. Host drones accept an explicitly
selected local service port; container drones require an existing Docker mapping. The Hub
control API and device-ingress ports are excluded.

Browser traffic uses a separate authenticated binary WebSocket tunnel over the same private
HTTPS ingress; ordinary device messaging still uses HTTP/SSE. Sessions expire after 30 minutes,
are bound to the requesting device and selected target, and recheck membership/grants on each
connection. Revocation closes streams; target mappings are rechecked on connection and every
15 seconds. Reopening is required after a mapping changes. Only one browser session per
requesting device is retained by each Hub.

Android's native `browser-tunnel` module gives the WebView a session-local loopback origin.
The gateway handles HTTP bodies, streaming responses, cookies, redirects, and WebSocket
upgrades without buffering complete pages or putting mesh credentials in page JavaScript.
Its own HttpOnly cookie authenticates local requests and is removed before forwarding.
Release builds permit cleartext only for the gateway's loopback-address pool. The Expo
`with-browser-loopback` plugin preserves this configuration during prebuild; debug builds
retain Metro access. Closing Browser or backgrounding the app closes the native gateway.
Cancelled HTTP requests release their tunnels even while the upstream is silent. Pending
opens are cancelled when leaving Browser and superseded opens cannot replace newer sessions.
Preview responses deny camera, microphone, and location through browser permissions policies.

The first version supports one HTTP service per browser session, with separate browser
cookies from desktop. External top-level navigation and popups are blocked. Applications
that hardcode other localhost ports, depend on an external authentication redirect, or require
an HTTPS upstream need additional support. Use relative URLs and same-origin WebSockets for
development-server live reload. A new Android native build and updated hosting Hub are required.

Browser checks: `node --require ts-node/register --test tests/node/device-browser-sessions.test.ts`
from `apps/drone`; `./gradlew :browser-tunnel:browserGatewaySmoke` from the mobile `android`
directory; and `bun test apps/drone-hub-mobile/tests/mobile-browser-model.test.ts` from the repo root.

In Devices settings, enable Tailscale HTTPS access, then discover and pair visible Hubs. Both machines need Tailscale connectivity and permission to reach the selected port. DroneHub uses Tailscale Serve on port 8791, probes 443 as an alternate, and refuses to overwrite another application's Serve handler. Discovery enumerates visible peers; it does not scan an IP range. QR, deep links, and manual HTTPS origins remain pairing/recovery methods.

Mobile bootstraps through a known Hub, verifies its signed directory and device-owned route announcements, then connects directly to available destinations. Phones receive reverse requests over their client-opened SSE subscription; they do not need a listening HTTP server. Background operation remains subject to mobile OS suspension; foreground resume reconciles state.

On the phone's pairing screen, **Find a Hub on Tailscale** accepts a desktop Tailscale name or exact HTTPS origin. The phone verifies the Hub's discovery proof, then **Request pairing** submits its signed identity to the desktop's approval list. No invitation QR or phone listener is required. This is address-assisted discovery, not enumeration of peers from the separate Tailscale mobile app.

## Components

- `device-mesh-tailscale.ts`, `device-mesh-discovery.ts`: CLI detection, peer enumeration, challenge-bound discovery.
- `device-mesh-ingress.ts`: restricted loopback listener, Serve configuration, endpoint publication.
- `device-http-channel-server.ts`: HTTP session admission, token authentication, and SSE subscription lifetime.
- `device-http-channel.ts` and the shared `http-event-client.ts`: logical message delivery through HTTP replies and SSE.
- `device-mesh-router.ts`: existing signed capability/membership/route authorization, routing, cancellation, and bounded event delivery.
- `device-event-replay.ts`: short-lived advisory replay; invalid cursors require reconciliation.
- `device-read-responses.ts`: revision-based transcript deltas; large HTTP JSON replies support gzip.
- `device-http-transfers.ts`: authorized streaming media downloads with revision/range forwarding.
- `workspace-http-transfers.ts`: scoped binary GET/PUT tickets, size checks, resume offsets, and active policy checks.
- Shared `http-workspace-adapter.ts`: composes independent download and upload handlers. `http-workspace-source.ts` owns stream cleanup; `http-workspace-destination.ts` owns staging, retry, and commit states. Platform upload sinks only handle disk I/O and binary upload.
- `device-result-uploads.ts`: bounded, checksummed HTTP staging of phone-produced media.
- `device-request-journal.ts`: durable command acceptance, preventing duplicate execution after restart.
- `device-mesh-store.ts`, `device-identity.ts`: existing membership, grants, and identities, preserved in place.

JSON envelopes are limited to 8 MiB; capability results reserve envelope space and are limited to 6 MiB. Chat reads remain paged. Files do not travel as base64 chunk requests. Workspace-engine buffers are local I/O only; remote adapters use streaming downloads and disk-backed HTTP uploads. Staging trades some disk I/O for bounded memory, especially on mobile where Expo fetch buffers upload streams.

Transfer tickets are short-lived bearer credentials, scoped to server-selected resources. New requests recheck membership and grants. Workspace streams check policy at least once per second; media streams react to store changes. Cancellation is scoped to the authenticated hop that submitted the signed request. Cancelling a mutation cannot undo work already committed.

Existing chats, transcripts, drone records, files, credential stores, and workspace roots retain their storage formats and identities. A transport upgrade never resets content stores. Recoverable partial uploads are retained across restart; accepted commands with unknown outcomes are not silently repeated.

See the root `DRONE_HUB_TAILSCALE_HTTP_SSE_IMPLEMENTATION.md` for validation and deployment limits.
