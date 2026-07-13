# Drone Hub Device Network — Prototype Specification

## Status

Approved product direction for a focused prototype. Milestones 0 through 3 were implemented in code on 2026-07-13; real Android, VPS, and Desktop validation remains before any milestone is treated as complete for release.

This prototype is intentionally smaller than the final architecture in `DRONE_HUB_DEVICE_NETWORK_SPEC.md`.

## Implementation checkpoint — 2026-07-13

The repository now contains:

- `packages/device-protocol`, the feature-neutral protocol contracts, canonical signing format, validation, and static capability descriptors;
- `apps/drone/src/hub/device-mesh`, an isolated Hub mesh service with stable P-256 identity, one-time pairing, desktop-to-desktop join, signed membership and revocation synchronization, authenticated WSS, direct and one-hop routing, replay/expiry/idempotency checks, and destination-local grants;
- a statically registered `drone-control` adapter that calls the existing local Hub API with its token kept on that Hub;
- a Devices settings surface in the existing Drone Hub UI for invites, incoming approvals, names, endpoints, administrator status, permissions, and revocation;
- `apps/drone-hub-mobile`, an Android-first Expo/React Native application for QR pairing, device and route diagnostics, target selection, drone/chat browsing, prompt/stop, and separately authorized host/container creation.
- signed, sequence-numbered route announcements, primary/backup Android bridge selection, event-triggered topology refresh, relayed membership and revocation events, and explicit TLS-only bridge-trust diagnostics;
- separate `assistant-threads` and `workspace` capability modules, a phone Assistant screen, and matching home/target thread policy records configured from the desktop Devices settings;
- bounded Desktop workspace read, list, search, and write operations with traversal and symlink containment checks, plus persistent target-side audit records;
- remote workspace targets in the existing assistant tool catalog, so tool results carry the assistant home, target device, and configured root identity.

Implementation findings changed a few details without changing the product boundary:

- Android protects the prototype P-256 private key with Expo Secure Store, which uses Android Keystore-backed encryption. The key is still loaded into JavaScript memory for signing. A native non-exportable key module remains a production hardening task.
- The prototype uses TLS plus signed application requests. A forwarding Hub can read forwarded payloads until the Noise/Rust production encryption milestone is implemented. The mobile diagnostics screen states this explicitly.
- Membership snapshots, revocations, and route changes are signed and resynchronized over authenticated peer links. Operational grants never propagate; every destination keeps its own grants.
- Desktop join progress is held in memory while the durable identity and mesh state live under the Drone Hub data directory. Restarting during an unapproved join requires starting that join again.
- WSS is the only ongoing transport implemented. SSE fallback, multiple endpoints per single peer, and production-grade traffic controls remain later work; the prototype has fixed message, connection, forwarding-table, and per-peer request bounds. Target audit history is a local bounded 500-entry file, not a production audit database.
- Android is foreground-only. It disconnects when suspended and reconnects to all configured bridge devices when active.
- Cross-device assistant policy is deliberately manual in this slice: an administrator copies the thread and root IDs into matching home and target records. The target compares the home device, thread, root, and read/write flags exactly before every operation.
- Remote assistant prompts are accepted quickly by the mesh and continue on the home Hub. The Android transcript currently refreshes after submission rather than streaming assistant events through the mesh.

## Prototype objective

Build the smallest believable version of the device network and Android app that proves the product works.

The prototype succeeds when this scenario works:

> From Android, pair with VPS, discover Desktop through VPS, control separately permitted drones on both, then create one VPS-hosted assistant thread that can write to an explicitly configured Desktop workspace while another thread cannot.

The target topology is:

```text
                         +------------------+
Phone -- outbound WSS -->| VPS Drone Hub    |
                         | reachable bridge |
                         +--------+---------+
                                  |
                     direct WSS   |
                                  v
                         +------------------+
                         | Desktop Hub      |
                         | drones + files   |
                         +------------------+
```

From Phone, the user can:

- see VPS and Desktop as separate devices;
- select either target;
- browse permitted drones and chats;
- send and stop prompts;
- create container or host drones when separately permitted;
- open an assistant thread hosted on VPS;
- give that thread access to one configured Desktop workspace root;
- open another thread that has no Desktop workspace access.

## Prototype principles

- Prove the product model before building the complete distributed system.
- Keep identity stable even when URLs change.
- Keep target-side permission enforcement from the first milestone.
- Use typed operations rather than forwarding arbitrary Hub HTTP routes.
- Keep Hub bearer tokens on their owning device.
- Prefer a narrow honest security boundary over unfinished custom encryption.
- Do not quietly turn prototype limitations into production behavior.
- Keep local Drone Hub usable when no mesh route exists.

## Feature-neutral foundation

The prototype must treat the secure device mesh as the lasting product foundation. Drones, assistants, and workspaces are removable features built on top of it.

```text
┌─────────────────────────────────────────────┐
│ Android and Desktop application shells      │
│ Devices • Connections • Settings • Features │
└──────────────────────┬──────────────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│ Statically registered capability modules    │
│                                             │
│ Drone Control │ Assistant Threads │ Workspace│
│ Future Voice  │ Notifications     │ Anything │
└──────────────────────┬──────────────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│ Device Mesh Kernel                          │
│                                             │
│ Identity • Pairing • Membership • Routing   │
│ Encryption • Permissions • Requests • Audit │
└─────────────────────────────────────────────┘
```

### Mesh kernel responsibilities

The mesh kernel knows:

- device identity and pairing;
- signed membership and revocation;
- connections, routes, forwarding, and presence;
- request envelopes, expiry, replay protection, and idempotency;
- capability discovery and version negotiation;
- generic directional grants;
- audit envelope fields;
- transport encryption.

The mesh kernel does not know:

- what a drone or chat is;
- how an assistant thread runs;
- what a workspace root or file operation means;
- how a feature validates its business arguments;
- how a feature renders its mobile interface.

### Capability-module responsibilities

A capability module owns:

- capability ID and version;
- supported operation names;
- operation input and output schemas;
- permission descriptors and supported resource scopes;
- final resource-level validation;
- target-side execution handlers;
- result sanitization and size limits;
- feature-specific audit metadata;
- optional feature UI bundled into a client.

An operation is available only when:

```text
the target advertises a compatible capability version
AND the client contains a compatible feature module
AND the target's directional grant permits the operation
AND the capability validates the requested resource and arguments
```

Capability advertisement never grants permission.

### Static registration only

Use a small compile-time interface:

```ts
type DeviceCapabilityModule = {
  id: string;
  version: number;
  describe(): CapabilityDescriptor;
  authorizeResource(input: CapabilityAuthorizationInput): AuthorizationResult;
  execute(input: CapabilityExecutionInput): Promise<CapabilityExecutionResult>;
};
```

Register modules statically in the target application:

```ts
const capabilities = [
  deviceCoreCapability,
  droneControlCapability,
  assistantThreadsCapability,
  workspaceCapability,
];
```

Do not build downloadable plugins, dynamic imports, remote interface code, or a capability marketplace for the prototype.

### Required and optional capabilities

`device-core` is the only required capability. It provides:

- `device.describe`;
- `devices.list`;
- `diagnostics.ping`.

Initial optional capabilities are:

- `drone-control`;
- `assistant-threads`;
- `workspace`.

A build may omit any optional capability. A device without `drone-control` remains a valid mesh member. Removing assistants later must not require changing identity, pairing, membership, routing, or encryption.

### Capability lifecycle and versions

Treat the prototype's integer capability version as a security-relevant major version.

- A client and target must agree on a supported version before invoking an operation.
- Grants are bound to capability ID and major version.
- Removing or disabling a capability makes its grants inactive without damaging mesh membership.
- Reinstalling the same compatible version may restore those visible inactive grants.
- Installing an incompatible new major version requires explicit permission review before old grants can apply.
- Removing a feature may archive its local feature data, but the mesh kernel must not interpret or migrate that data.

### Capability advertisement

Each device advertises a signed, versioned descriptor summary:

```json
{
  "deviceId": "desktop-id",
  "capabilities": [
    {
      "id": "drone-control",
      "version": 1,
      "operations": ["drones.list", "chats.read", "chats.prompt", "drones.create"]
    },
    {
      "id": "workspace",
      "version": 1,
      "operations": ["roots.list", "files.read", "files.write"]
    }
  ]
}
```

The summary is for discovery and compatibility. The target's registered handler and local permission policy remain authoritative.

### Stable resource references

Use generic compound resource references across the protocol and UI:

```ts
type DeviceResourceRef = {
  deviceId: string;
  capability: string;
  resourceType: string;
  resourceId: string;
};
```

Feature modules may wrap this with stronger local types, but shared selections, navigation, audit, and delegation must not assume that every resource is a drone or assistant thread.

## Network scope

### One forwarding hop only

Supported:

```text
Phone -> VPS
Phone -> VPS -> Desktop
```

Not supported:

```text
Phone -> VPS -> Desktop -> Laptop -> Other device
```

Each request envelope carries a hop count and a maximum hop count. The prototype fixes `maxHops` to `1`.

This avoids general path finding, routing loops, route scoring, and multi-hop failure recovery.

### Two practical device modes

The prototype uses two connectivity modes:

- **Reachable peer**: accepts authenticated HTTPS/WSS connections. Examples include VPS, a Desktop behind ngrok, or a LAN Desktop.
- **Outbound-only peer**: maintains an outbound connection to a reachable peer. Android is the main example.

Do not implement automatic NAT traversal, WebRTC, automatic port mapping, or permanent public LAN advertising.

### Bridge redundancy

An outbound-only device can know two bridge peers:

```text
Primary: VPS
Backup: Desktop through ngrok
```

For the prototype:

- keep the primary connection active;
- connect to the backup when the primary fails;
- do not split traffic across both;
- do not dynamically optimize routes;
- show primary, backup, and last connection errors in diagnostics.

The final architecture may keep two active bridge connections, but primary/fallback is simpler for the Android prototype.

### Transport

Use authenticated WebSocket as the main live transport.

One connection carries:

- protocol negotiation;
- device and membership synchronization;
- requests and responses;
- cancellations;
- drone and chat events;
- presence heartbeats;
- forwarded envelopes.

HTTPS remains useful for pairing bootstrap and health checks. HTTPS+SSE may be added as a compatibility adapter if WebSocket proves unsuitable in a real target environment, but it is not required for the first vertical slice.

### Foreground Android connectivity

Android is reachable only while its mesh connection remains alive.

When Android suspends the app:

- show it as sleeping or offline on other devices;
- do not queue sensitive commands for it;
- reconnect and synchronize signed records when it wakes;
- resume event subscriptions where cursors exist.

Do not build an Android foreground service, persistent notification, FCM wake-up, or battery-optimization setup for this prototype.

## Identity and pairing

### Installation identity

Use a stable P-256 ECDSA identity key for the prototype.

Android requirements:

- generate or import the identity through Android Keystore integration;
- make the private key non-exportable where the platform supports it;
- persist the public key, key ID, and device ID in application storage;
- treat app reinstall or key loss as a new device.

Desktop/VPS requirements:

- use the same public-key and signature format;
- store private material with owner-only filesystem permissions or an available OS credential store;
- never include private material in logs, QR codes, backups, or API responses.

The P-256 identity remains useful for signed membership records even when the production transport later adds Noise with separate session keys.

### Pairing flow

1. Reachable Hub creates a one-time pairing invitation.
2. It displays a QR and copyable link.
3. The invitation contains the reachable URL, network ID, device ID, public-key fingerprint, protocol version, and one-time token.
4. Android scans the QR or accepts a manually entered URL and code.
5. Android sends its proposed display name and public key.
6. Reachable Hub displays an incoming join request and both device fingerprints.
7. An administrator approves or denies the join.
8. Approval signs a `device_joined` membership event.
9. Android receives current signed membership records and opens its persistent WSS connection.

The invitation token must:

- expire within a few minutes;
- be single-use;
- be stored as a hash by the accepting Hub;
- grant no operational permission by itself;
- become invalid after approval, denial, or expiry.

### New-device defaults

A new device receives:

- membership in the network;
- basic device discovery;
- no drone, chat, assistant, workspace, terminal, file, or settings access.

The target device must explicitly grant operational permissions.

### Device names

Use one shared display name per device in the prototype.

- The device proposes its initial name.
- The device or an administrator may rename it.
- A signed rename propagates to connected peers.
- Device ID, never display name, controls identity and routing.
- Duplicate names are allowed and shown with a device type or short ID.

Local-only aliases are deferred.

## Signed membership synchronization

Avoid a general distributed database. Synchronize a small set of immutable signed events.

Prototype event types:

- `device_joined`;
- `device_revoked`;
- `device_renamed`;
- `device_key_rotated`;
- `route_updated`;
- `capabilities_updated`.

Each event contains:

```ts
type MeshEvent = {
  id: string;
  networkId: string;
  type: string;
  subjectDeviceId: string;
  issuerDeviceId: string;
  sequence: number;
  createdAt: string;
  payload: unknown;
  signature: string;
};
```

When peers connect:

1. Exchange a summary of known event IDs.
2. Request missing events.
3. Validate issuer, signature, sequence, and schema.
4. Store valid immutable events.
5. Update the local device-directory projection.
6. Forward newly learned valid events to other connected members.

Prototype merge rules:

- valid revocation wins over older records for that device;
- the highest valid per-device sequence wins for rename, key rotation, route, and capability updates;
- duplicate event IDs are ignored;
- events from unauthorized issuers are ignored and audited;
- conflicting valid security events fail conservatively and remain visible in diagnostics.

Do not replicate target permission databases. Each target owns and enforces its local permissions.

## Prototype security boundary

### TLS-only forwarding limitation

The first controlled prototype may use:

```text
Phone -- TLS --> VPS -- TLS --> Desktop
```

In that version, VPS can technically read forwarded payloads.

This is acceptable only while:

- all devices are controlled test devices;
- the limitation is visible in documentation and diagnostics;
- the product is not described as end-to-end encrypted;
- testing avoids highly sensitive prompts, files, credentials, and transcripts.

TLS protects the connections from unrelated Internet attackers. It does not protect a forwarded payload from the bridge itself.

### Production security gate

Before production forwarding carries real prompts, transcripts, file contents, or commands:

- establish destination-level encrypted sessions;
- prevent a forwarding peer from decrypting application payloads;
- add forward secrecy, replay protection, and safe session rekeying;
- pass Node and Android interoperability tests;
- complete a focused review of handshake patterns, native packaging, and key storage.

The intended direction is the Noise Protocol Framework through a shared Rust security core. `snow` is the first implementation candidate, subject to the spike and license review described in the main spec.

### Security requirements that are not deferred

Even the TLS-only prototype must have:

- stable device identity keys;
- mutual device authentication;
- one-time pairing tokens;
- signed membership and route records;
- deny-by-default target permissions;
- typed operation validation;
- request expiry;
- per-source rate and size limits;
- replay detection for state-changing operations;
- idempotency keys;
- response sanitization;
- bounded audit records;
- immediate enforcement of locally known revocations.

### Peer-session authentication

After WSS opens, both directly connected peers perform a challenge-response handshake before exchanging mesh data:

1. Each side sends a fresh random nonce, device ID, network ID, and supported protocol versions.
2. Each side signs both nonces, both device IDs, the negotiated protocol version, and a connection-specific session ID.
3. Each side verifies the signature against the public key in the signed membership log.
4. Either side closes the connection if identity, membership, freshness, or version validation fails.

Signing both contributions binds the proof to this connection and prevents an old handshake response from authenticating a new session. This prototype handshake authenticates the peers but does not make TLS-only forwarded content opaque to the bridge; the production Noise session replaces that limitation.

### Request envelope

An initial request envelope should contain:

```ts
type DeviceRequest = {
  version: 1;
  type: 'request';
  requestId: string;
  idempotencyKey?: string;
  networkId: string;
  sourceDeviceId: string;
  senderDeviceId: string;
  targetDeviceId: string;
  capability: string;
  capabilityVersion: number;
  operation: string;
  arguments: unknown;
  actor:
    | { type: 'device' }
    | {
        type: 'delegation';
        delegationId: string;
        executorDeviceId: string;
        context?: { kind: string; id: string };
      };
  hopCount: 0 | 1;
  maxHops: 1;
  createdAt: string;
  expiresAt: string;
  signature: string;
};
```

The target must authenticate and authorize the source, not trust the forwarding sender as the actor. A delegated actor is generic mesh context: an assistant thread, scheduled job, workflow, or future automation may use the same bounded mechanism.

## Typed operation surface

Never forward raw Hub URLs, HTTP headers, bearer tokens, or arbitrary methods.

Initial operation groups:

```text
device-core
  device.describe
  devices.list
  diagnostics.ping

drone-control
  drones.list
  chats.list
  chats.read
  chats.prompt
  chats.stop
  drones.create

assistant-threads
  threads.list
  threads.create
  threads.read
  threads.prompt

workspace
  roots.list
  files.read
  files.write
```

Every operation maps to one permission descriptor, one validated input schema, and one narrow target-side handler registered by its capability module. An unknown capability, incompatible version, unregistered operation, or invalid argument is denied before feature execution.

`drones.create` must resolve the runtime before authorization:

```text
runtime=container -> drone-control/drones.container.create
runtime=host      -> drone-control/drones.host.create
```

Changing an argument from container to host must cause a new permission evaluation.

## Prototype permissions

### Capability-scoped grants

Store grants by capability, operation, and optional resource scope:

```ts
type CapabilityGrant = {
  capability: string;
  operations: string[];
  scope?: Record<string, unknown>;
};
```

Initial feature permissions are:

```text
drone-control
  drones.read
  chats.read
  chats.prompt
  chats.stop
  drones.container.create
  drones.host.create

assistant-threads
  threads.list
  threads.create
  threads.read
  threads.prompt

workspace
  roots.list
  files.read
  files.write
```

The generic permission engine matches source, target, capability, operation, and broad stored scope. The capability handler performs the final resource-specific check and cannot widen the stored grant.

Workspace permissions must include configured root IDs. Never accept an arbitrary absolute path from a remote device.

Example:

```json
{
  "capability": "workspace",
  "operations": ["roots.list", "files.read"],
  "scope": {
    "rootIds": ["main-project"]
  }
}
```

### Permission profiles

The mesh core provides only **Discover only**. Capability modules may contribute optional presets to the permission editor.

Initial combined product presets are:

- **Discover only**: basic membership visibility and no operational access.
- **Chat operator**: read drones and chats, prompt, and stop.
- **Drone operator**: Chat operator plus separately selected container and host creation.
- **Custom**: individual permission switches and workspace roots.

If `drone-control` is absent, its profiles and switches are absent. Assistant and workspace permissions can remain in the Custom section for the prototype.

### Administration location

Configure grants on the destination Drone Hub UI during the prototype.

Do not build full mobile permission administration or offline target-policy changes yet.

## Android React Native project

### Project location

Use:

```text
apps/drone-hub-mobile
```

The project should be React Native with TypeScript. An Expo development build is acceptable, but the design must allow native Android modules for Android Keystore and the later shared Rust security core. Do not rely on Expo Go as the only runtime.

### Shared packages

Keep one small shared contract package initially:

```text
packages/device-protocol
  mesh envelopes and events
  capability descriptors
  generic grants and resource references
  runtime schemas and conformance fixtures
```

Keep backend capability implementations under the Hub and mobile feature code under the Android application:

```text
apps/drone/src/hub/device-mesh/
apps/drone/src/hub/capabilities/device-core/
apps/drone/src/hub/capabilities/drone-control/
apps/drone/src/hub/capabilities/assistant-threads/
apps/drone/src/hub/capabilities/workspace/

apps/drone-hub-mobile/src/core/
apps/drone-hub-mobile/src/features/drone-control/
apps/drone-hub-mobile/src/features/assistant/
apps/drone-hub-mobile/src/features/workspace/
```

Do not extract a large shared UI system or create a separate package for every feature. Share protocol contracts first and extract more only when a real second implementation needs it.

### Screens

The permanent Android shell contains Pairing, Devices, Connections, Settings, and Diagnostics. Drone Control, Assistant, and Workspace are statically bundled feature modules.

Navigation depends on both:

- whether this Android build contains the feature module;
- whether the selected target advertises a compatible capability.

If a target has no `drone-control` capability, do not show Drone Control for that target. If a future Android build omits assistants entirely, pairing and every other mesh feature continue to work.

#### Pairing

- scan QR;
- enter URL or code manually;
- show the proposed peer identity;
- show waiting, approved, denied, expired, and error states;
- allow retry without retaining an expired token.

#### Devices

- display name and type;
- online, sleeping, offline, revoked, or incompatible state;
- general capabilities;
- selected target;
- concise permission summary;
- primary and backup path diagnostics.

#### Selected device overview

- shared device identity and name;
- connection and route state;
- advertised compatible and incompatible capabilities;
- permission summary for this source and target;
- feature navigation supplied by bundled modules.

#### Drone Control feature

- drone list;
- chat list;
- transcript;
- prompt composer;
- stop action;
- create-drone action with explicit container or host runtime;
- clear loading, empty, disabled, offline, and denial states.

#### Assistant feature

- threads from the selected assistant home device;
- create and open thread;
- show assistant home device;
- show the optional remote workspace target;
- prompt composer;
- tool activity with resolved target name and root;
- clear lack-of-permission and target-offline states.

#### Settings

- this device's shared name;
- device ID and fingerprint;
- primary and backup bridge;
- last membership sync;
- current connection and protocol version;
- revoke or leave network;
- diagnostic logs with secrets removed.

### State-management boundary

Keep separate state for:

- durable local identity and paired-network data;
- live connection and presence;
- signed membership projection;
- selected target;
- target-specific drone/chat data;
- assistant thread and workspace-target state.

Never key drones, chats, unread state, or requests by `droneId` alone. Use compound references such as `{ deviceId, droneId }`.

Core state must not import feature stores. Feature modules may consume selected-device and capability-discovery state through a narrow core interface.

## Simplified assistant slice

`assistant-threads` owns threads and model runs. It does not own filesystem access. Cross-device file work invokes the independent `workspace` capability through the mesh.

This separation means:

- Workspace remains useful if assistants are removed.
- Assistants remain useful if drones are removed.
- Drone Control does not depend on either Assistant or Workspace.
- A future workflow or automation can consume Workspace through the same capability contract.

### One home and one optional remote workspace

Each prototype thread has:

- exactly one assistant home device;
- optional use of `drone-control` on its home device when that separate capability is present and permitted;
- zero or one remote workspace device and root.

Example:

```text
Thread home: VPS
Optional Drone Control target: VPS
Workspace target: Desktop / main-project
```

General multiple-target assistant routing is deferred.

### Thread access on the assistant home

```json
{
  "threadId": "thread-1",
  "workspaceTarget": {
    "deviceId": "desktop-id",
    "rootId": "main-project",
    "read": true,
    "write": true
  }
}
```

### Matching target-side rule

Desktop stores:

```json
{
  "assistantHomeDeviceId": "vps-id",
  "threadId": "thread-1",
  "rootId": "main-project",
  "read": true,
  "write": true
}
```

Both sides must agree. Desktop makes the final decision.

This is deliberately simpler than portable delegation tokens. It still prevents VPS from using Thread 1's permission through Thread 2 or interactive access.

Short-lived run-bound delegation replaces this paired-record model before general cross-device assistant access becomes production-ready. That later delegation is a generic mesh actor type with assistant thread/run IDs as context, not an assistant-specific transport feature.

### Thread defaults

A new thread starts with:

- its chosen home device;
- local assistant capabilities on that home;
- no remote workspace target.

Adding Desktop to Thread 1 does not add it to Thread 2.

## Delivery milestones

### Milestone 0 — Feature-neutral mesh kernel

Implementation status: code complete for the prototype boundary; desktop integration validation is pending.

Prove before connecting any product feature:

- identity and QR pairing;
- signed membership synchronization;
- direct authenticated WSS;
- one-hop forwarding;
- request expiry, replay protection, and idempotency;
- static capability registration and advertisement;
- generic capability-scoped grants;
- `device-core` describe, list, and ping operations;
- Android Devices, Connections, Settings, and Diagnostics shell;
- a build with no Drone Control, Assistant, or Workspace module still functions as a device network.

### Milestone 1 — Android plus Drone Control

Implementation status: code complete and type-checked; an Android native development build and real-device flow still need manual validation.

Topology:

```text
Android -> VPS
```

Prove:

- Android project and native development build;
- Keystore-backed identity;
- QR pairing and incoming approval;
- persistent WSS;
- signed request authentication;
- target-side permissions;
- statically registered `drone-control` capability and Android feature module;
- drone and chat browsing;
- prompt and stop;
- separate container and host creation grants;
- disconnect, reconnect, and revoked-device behavior.

### Milestone 2 — Small peer mesh

Implementation status: code complete for the prototype boundary; three-device route, failover, changed-ngrok, and revocation flows still need real-device validation.

Topology:

```text
Android -> VPS -> Desktop
```

Add:

- Desktop as a third member;
- membership-event synchronization;
- Android discovers Desktop through VPS;
- one-hop request forwarding;
- primary and backup bridge configuration;
- route update after an ngrok URL changes;
- revocation propagation;
- clear bridge-trust diagnostics for TLS-only forwarding.

### Milestone 3 — Cross-device assistant

Implementation status: code complete and type-checked; a real VPS-hosted thread writing to a Desktop root through Android still needs end-to-end manual validation.

Add:

- assistant thread hosted by VPS;
- one Desktop workspace root;
- matching thread access records on VPS and Desktop;
- read and write tools;
- a second thread with no Desktop access;
- target identity on every tool card;
- target-side audit records;
- denial when a thread ID, home device, or root does not match.

### Milestone 4 — Production encryption gate

Before real production use of forwarding:

- add the shared Rust security core;
- establish Noise sessions through a forwarding peer;
- prove the bridge cannot decrypt payloads;
- test route changes and re-handshake;
- add session expiry and rekeying;
- pass replay, tampering, key-loss, and revocation tests;
- remove or clearly isolate any TLS-only forwarding mode.

## Prototype review hardening

Four detailed review passes after Milestones 0–3 added these safeguards without changing the
capability-based architecture:

- only an existing administrator can change another device's administrator status;
- membership updates accept only HTTPS or local-development endpoints and validate device keys;
- pairing approvals are checked against the phone identity and every advertised device key;
- relayed responses must return over the expected authenticated connection;
- request IDs and cached responses are isolated by source device and exact signed request data;
- corrupt mobile routing data is discarded instead of preventing the phone identity from loading;
- workspace writes honor their optional base hash, and searches have bounded work;
- assistant prompt input and stored response history have explicit size bounds.

These are prototype defenses, not a replacement for Milestone 4. A forwarding bridge can still read
application payloads until destination-only encryption is implemented.

## Acceptance scenarios

### Capability modularity

- A device with only `device-core` can pair, discover members, route requests, and expose diagnostics.
- Removing `drone-control` removes its advertisement and UI without changing identity or membership data.
- Removing `assistant-threads` does not break Workspace.
- Removing `workspace` does not break Assistant Threads or Drone Control.
- An unknown capability or incompatible version is denied cleanly.
- A client without a bundled feature module does not render that feature even if the target advertises it.
- Capability advertisement never grants operational permission.

### Pairing and membership

1. Android pairs with VPS through a one-time QR.
2. Reusing the QR fails.
3. An unapproved Android installation receives no membership or operations.
4. Desktop joins through VPS and its membership appears on Android after synchronization.
5. Revoking Android prevents a new session and closes known active sessions.

### Permissions

6. Android discovers Desktop but receives no operational access by default.
7. Granting `drone-control/chats.prompt` on VPS does not grant it on Desktop.
8. Container creation succeeds while host creation remains denied.
9. Changing the requested runtime to host triggers denial.
10. Revoking a local grant affects the next request immediately.

### Routing

11. Android reaches Desktop through VPS with at most one forwarding hop.
12. A request with `hopCount > maxHops` is rejected.
13. Losing the primary bridge switches Android to its configured backup after reconnect.
14. A changed ngrok URL propagates as a newer signed route without re-pairing.
15. A route serving the wrong device identity is rejected.

### Reliability and safety

16. Retrying a timed-out create request with the same idempotency key creates one drone.
17. Expired, malformed, oversized, replayed, or incorrectly signed requests fail.
18. Responses do not expose Hub bearer tokens, environment secrets, or unintended host paths.
19. Android suspension appears as sleeping or offline rather than connected.
20. Local Drone Hub remains usable without any mesh connection.

### Assistant

21. Phone opens a VPS-hosted Thread 1 with Desktop `main-project` access.
22. Thread 1 reads and writes only inside that root.
23. Thread 2 receives no Desktop access.
24. Changing the thread ID, assistant home, root ID, or operation causes Desktop to deny the tool call.
25. VPS cannot reuse Thread 1's access interactively.
26. Every workspace tool result identifies VPS as assistant home and Desktop as target.

### Production encryption gate

27. VPS forwards a Phone-to-Desktop encrypted envelope without decrypting its contents.
28. Tampering at VPS causes destination authentication failure.
29. Replaying an encrypted tool call does not repeat the write.
30. Route failover creates a new authenticated session without changing device identity or permission.

## Explicitly deferred

- iOS product implementation;
- accounts;
- a separate coordination service;
- push notifications and Android wake-up;
- general multi-hop routing;
- automatic NAT traversal;
- continuous public LAN discovery;
- offline command queues;
- general file transfer;
- remote terminals;
- arbitrary filesystem access;
- automatic transcript replication;
- thread migration;
- permission changes while the target is offline;
- local device aliases;
- general approval workflows;
- multiple human users;
- recovery-key UI;
- quorum-based administration;
- automatic assistant target selection;
- several remote workspace or drone targets in one thread;
- full Remote Hub panel parity;
- dynamically downloaded capability code;
- remote-provided interface code;
- a capability marketplace or general plugin runtime;
- arbitrary remote procedure calls outside registered capability schemas;
- production use of plaintext-at-bridge TLS-only forwarding.

## Prototype completion checklist

- [ ] Milestones 0 through 3 work on real Android, VPS, and Desktop devices.
- [ ] Capability-modularity acceptance scenarios pass with optional modules removed independently.
- [ ] The acceptance scenarios through item 26 pass.
- [ ] Every prototype limitation is visible in documentation and diagnostics.
- [ ] No raw Hub bearer token leaves its owning device.
- [ ] No raw HTTP route proxy becomes part of the mesh protocol.
- [ ] Target permissions remain deny-by-default and locally enforced.
- [ ] Android loading, empty, disabled, offline, denial, and error states are understandable.
- [ ] The team has observed whether one-hop forwarding and thread-specific workspace access feel useful.
- [ ] Production forwarding remains blocked until the encryption-gate scenarios pass.

## Decisions after the prototype

Only after Milestones 0 through 3 should the project decide whether to add:

- multiple active bridges instead of primary/fallback;
- general multi-hop routing;
- always-on Android service or push wake-up;
- several tool targets per assistant thread;
- portable short-lived assistant delegation;
- encrypted transcript backup or migration;
- local aliases;
- recovery-key UX;
- iOS;
- broader Remote Hub parity.
