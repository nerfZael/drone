# Device mesh module

This directory contains the feature-neutral mesh kernel and its removable capability adapters.

The existing Hub touches it only in `hub/server.ts`: create the service, offer it mesh HTTP and WebSocket requests, start it after listening, and close it during shutdown. Removing those hooks, the workspace dependency, the Devices settings tab, and this directory removes the prototype without changing the existing drone APIs.

Responsibilities are separated as follows:

- `device-mesh-http.ts`: pairing and administrator HTTP API;
- `device-mesh-ingress.ts` and `device-mesh-ingress-http.ts`: the dedicated localhost listener, its small public route allowlist, local configuration API, and signed endpoint publication;
- `device-mesh-ngrok.ts`: Device Mesh-specific ngrok detection and control state, with support for reusing a running local ngrok agent when possible;
- `device-mesh-router.ts`, `device-mesh-request-client.ts`, `device-membership-synchronizer.ts`, and `device-route-manager.ts`: authenticated WSS, signed requests and topology synchronization, and bounded one-hop routing;
- `device-mesh-store.ts` and `device-identity.ts`: local durable state and P-256 identity;
- `device-mesh-audit-store.ts`: bounded target-side operation history;
- `capability-registry.ts`: feature-neutral operation dispatch;
- `device-core-capability.ts` and `drone-control-capability.ts`: core and unified drone-chat adapters, including Built-in agent chats;
- `features/cross-device-assistant`: workspace adapters, bounded assistant history, and destination-owned device/workspace grants.

Remote Bash uses destination-owned asynchronous command jobs. Starting a command returns a job
handle; signed output requests consume incremental chunks; status and cancellation are separate
operations. Jobs are scoped to the requesting device and workspace, retain bounded output in memory,
default to 30 minutes, and cannot run longer than one hour.

The authenticated WebSocket is the required control path and supports direct and one-hop relayed
devices. Complete messages are capped at 256 KiB. Chat history is paged, oversized message bodies
are fetched in bounded chunks, and large responses fail explicitly instead of closing the socket.

Prompt attachments use short-lived upload sessions. A client with a direct destination endpoint uploads
the binary body over HTTP and then sends only the attachment id in `chat.prompt`. When the
destination is reachable only through another mesh device, the same session accepts bounded base64
chunks through `chat.prompt`. HTTP is therefore an optimization, not a connectivity requirement.

State is stored under the normal Drone Hub data directory in `device-mesh/`. The Hub API token is used only by local loopback adapters and is never placed in a mesh message.
