# Device mesh module

This directory contains the feature-neutral mesh kernel and its removable capability adapters.

The existing Hub touches it only in `hub/server.ts`: create the service, offer it mesh HTTP and WebSocket requests, start it after listening, and close it during shutdown. Removing those hooks, the workspace dependency, the Devices settings tab, and this directory removes the prototype without changing the existing drone APIs.

Responsibilities are separated as follows:

- `device-mesh-http.ts`: pairing and administrator HTTP API;
- `device-mesh-router.ts`, `device-mesh-request-client.ts`, `device-membership-synchronizer.ts`, and `device-route-manager.ts`: authenticated WSS, signed requests and topology synchronization, and bounded one-hop routing;
- `device-mesh-store.ts` and `device-identity.ts`: local durable state and P-256 identity;
- `device-mesh-audit-store.ts`: bounded target-side operation history;
- `capability-registry.ts`: feature-neutral operation dispatch;
- `device-core-capability.ts` and `drone-control-capability.ts`: core and drone adapters;
- `features/cross-device-assistant`: separate assistant-thread and workspace adapters, bounded assistant history, paired policy records, and the remote workspace target.

State is stored under the normal Drone Hub data directory in `device-mesh/`. The Hub API token is used only by local loopback adapters and is never placed in a mesh message.
