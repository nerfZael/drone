# Drone Hub Device Network — Product and Architecture Spec

## Status

Architecture reference. The focused prototype's Milestones 0 and 1 were implemented on 2026-07-13. Production encryption, audit, recovery, and wider feature decisions remain proposals in this document.

The focused build boundary is defined in `DRONE_HUB_DEVICE_NETWORK_PROTOTYPE.md`.

## Summary

Drone Hub should become a network of trusted devices instead of one Hub plus a separate remote web page.

Every Drone Hub installation belongs to a **device network**. Each installation appears as a named device, advertises what it can do, and connects to the rest of the network. Permissions are directional: the target device decides exactly what a source device may do.

Examples:

- `Phone -> Desktop`: view drones, send prompts, and create host or container drones.
- `Laptop -> Desktop`: view drones, send prompts, and create container drones, but not host drones.
- `Desktop -> VPS`: administer all drones.
- `VPS -> Desktop`: no access, even though Desktop can access VPS.

The React Native app should replace Remote Hub. It should use the same device protocol and permission model as desktop Drone Hub, not a second remote-only API.

The network should be self-hosted and peer-to-peer, with no separate coordination service and no required account. A user adds the URL or local address of one existing device, the two installations mutually authenticate and approve the relationship, and the signed membership update propagates to the rest of the user's device network.

Devices with a public URL, ngrok URL, public IP, or reachable LAN address accept direct connections. A phone or laptop without inbound reachability keeps an outbound WebSocket connection to one or more reachable member devices. Those existing peer connections are bidirectional and may carry end-to-end encrypted traffic for other members. A reachable VPS can therefore act as a bridge, but it remains an ordinary user-controlled device rather than a central service.

## Goals

- Show all joined computers and phones as named devices.
- Let users rename and revoke devices.
- Support desktop, laptop, VPS, and React Native clients.
- Work when a device cannot accept inbound Internet connections.
- Allow a different permission set in each direction between two devices.
- Separate container-drone creation from host-drone creation.
- Keep sensitive Hub credentials on the device that owns them.
- Enforce permissions on the target device, not only in the source UI or an intermediate peer.
- Give users a clear audit trail of remote actions and denials.
- Let a Drone Hub assistant use explicitly allowed tools across several target devices.
- Let every assistant thread narrow or remove cross-device access without changing the permanent device grants.
- Replace the current Remote Hub rather than maintain two remote products.

## Non-goals for the first release

- General file synchronization between devices.
- Arbitrary device-to-device TCP forwarding.
- Automatic multi-hop delegation, such as Phone asking Laptop to use Laptop's access to Desktop.
- A general policy language with scripts or user-written rules.
- Offline execution of sensitive commands queued for later.
- Automatic NAT traversal when no common LAN path or reachable member exists.
- Multiple human users, teams, or organization administration. The design should not prevent these later, but the first product can be a single-owner device network.

## Product vocabulary

Naming matters because several concepts are easy to mix together.

### Device

The user-facing installation of Drone Hub or the React Native app. Examples are `Workstation`, `Travel laptop`, and `Pixel phone`.

A device has a stable ID. Its display name is only a label and must never be used for authorization or routing. Duplicate display names should be allowed, with a short ID shown when needed.

### Device network

The set of devices joined by one owner. It is the boundary for device discovery, pairing, and permission management.

Use **device network** in settings and documentation. Avoid using **fleet** for this concept because Fleet already describes drone-to-drone coordination.

### Installation identity

The private cryptographic identity created by one app installation. Reinstalling an app creates a new identity and therefore a new device unless a deliberate recovery flow restores it.

### Capability

Something a target device is technically able to do. A phone may advertise chat and notification capabilities but no drone runtime. A desktop may advertise container and host runtimes.

### Permission grant

Something one source device is allowed to do on one target device. Capability and permission are different:

```text
action is available = target supports it
                   AND target granted it to source
                   AND target is reachable
                   AND any optional live-confirmation rule succeeds
```

### Route

The current network path between two devices. The route can be direct public HTTPS/WebSocket, ngrok, LAN, or an encrypted multi-hop path through another member device. A route must not carry permissions.

## Apps and services

### 1. Drone Hub desktop installation

The existing Hub backend and React UI remain the main desktop product. Each installation gains:

- a stable device identity;
- an outbound device connector;
- a local command handler that maps typed device operations to existing Hub services;
- a Devices screen;
- permission, pairing, revocation, presence, and audit UI.

It may host container drones, host drones, or both, depending on its local setup.

### 2. Drone Hub mobile

The React Native app replaces Remote Hub. It is a first-class network device, not a web session attached to one Hub.

Initial responsibilities:

- join a device network by QR code or link;
- list devices and their availability;
- select a target device;
- browse permitted drones and chats;
- send prompts, stop runs, and create drones when permitted;
- open permitted assistant threads and choose permitted workspace, drone, or assistant targets;
- show permission denials, optional confirmation requests, connection state, and audit context;
- receive notifications and future voice features.

The first mobile release does not need to host drones. It still participates in the bidirectional protocol over its outbound connection and can later advertise mobile-specific capabilities.

The app should use native secure storage for its long-lived identity and refresh credentials. A WebView cookie must not be its primary identity.

### 3. Peer mesh transport inside every installation

There is no separate coordination service. Each Drone Hub installation and mobile app includes the same mesh component. It provides:

- a local signed directory of network members and their public keys;
- direct HTTPS/WSS connections to reachable peers;
- persistent outbound WSS connections from devices that cannot accept inbound connections;
- signed membership, rename, capability, route, and revocation propagation;
- end-to-end encrypted forwarding for a destination connected through another peer;
- bounded presence and route information;
- optional mobile notification wake-up support through a separately configured provider.

A forwarding peer must not receive another device's Hub API token, decrypt forwarded application payloads, or turn forwarded messages into its own local Hub calls. Forwarding is a network capability, not permission to act as the source or destination.

### 4. Shared device protocol package

A small shared package should own versioned message schemas and validation for desktop, mobile, and mesh code. This prevents the current Remote Hub pattern from growing into separate, loosely matched APIs.

The protocol package should contain data contracts, not target-specific business logic.

## Recommended architecture

```text
             direct WSS when reachable
      +------------------------------------+
      |                                    |
+-----+--------------+             +-------+-----------+
| Desktop Drone Hub |             | VPS Drone Hub     |
| reachable or LAN  |<----------->| public mesh peer  |
+-------------------+             +---+------------+--+
                                         ^            ^
                            outbound WSS  |            | outbound WSS
                                         |            |
                              +----------+--+    +----+-------------+
                              | Phone       |    | Laptop behind NAT|
                              | no inbound  |    | no inbound       |
                              +-------------+    +------------------+
```

Every device attempts direct connections to known reachable members and maintains outbound connections to bridge-capable peers when needed. The default redundancy target is two active bridge connections, with up to three when healthy candidates exist. One connection works, two survive one bridge failure, and more than three normally adds connection, battery, and routing cost without much benefit for a personal network. Once connected, a WebSocket is logically bidirectional: Phone does not need to expose an HTTP server to receive a request through its existing connection.

### Transport shape for outbound-only devices

WebSocket is the preferred ongoing mesh transport because one authenticated outbound connection can carry requests, responses, cancellations, and event streams in both directions.

An HTTPS plus SSE fallback is also possible:

- the outbound-only device opens a long-lived authenticated SSE connection to a reachable peer;
- the peer delivers request and event envelopes down that stream;
- the device sends responses and its own requests with authenticated HTTPS POSTs;
- both directions remain bound to the same device session and end-to-end encrypted envelope protocol.

Ordinary one-off HTTP polling should not be the normal inbound path. It is slower, produces unclear presence, and makes cancellation and streaming harder. Pairing and bootstrap may still use short HTTPS requests.

Neither WSS nor HTTPS+SSE requires Phone or Laptop to listen on a public port. They act as clients at the network layer while remaining full authenticated devices at the application layer.

### Necessary reachability rule

Pure peer-to-peer networking cannot connect two outbound-only devices unless they share a reachable LAN path or are both connected to at least one common reachable member. Therefore, a useful Internet device network needs at least one normally reachable member, such as:

- a Drone Hub on a VPS;
- a desktop with a stable public or ngrok URL;
- a user-selected always-on home device with port forwarding;
- later, an optional generic bridge mode running the same mesh component.

This reachable member is not globally authoritative. Several devices may bridge simultaneously, and losing one bridge should not change identity or permissions. It only removes routes that depended on it.

### Direct and forwarded routes

A device may advertise one or more reachable endpoints:

- a public HTTPS/WSS endpoint on a VPS;
- an ngrok URL;
- a LAN endpoint discovered through mDNS;
- a future WebRTC data channel or similar NAT traversal route.

Peers prefer a healthy direct route. If none works, they use a path through a connected member that advertises forwarding availability. Both paths carry the same authenticated, versioned, destination-encrypted device-protocol messages.

Do not make a public endpoint automatically more trusted. Public reachability is only a route property.

### Self-discovery and changing URLs

Every device maintains a local signed directory of the device network. Peers exchange and merge membership, presence, capability, rename, revocation, and route records over existing authenticated connections.

This avoids a bootstrap problem when a public URL changes. A VPS or ngrok-backed Hub does **not** need to contact every peer through its old URL. Instead:

1. The device detects its new public route.
2. It sends a signed, short-lived route announcement to its connected peers.
3. Each peer verifies the signature and merges the newer record into its local directory.
4. Peers gossip the valid update onward; offline peers receive the latest signed record when they reconnect to any current member.
5. Peers may try the new route, but use an available forwarded route if it is unavailable or cannot prove the expected target identity.
6. The old route is explicitly withdrawn or expires quickly.

The device's stable identity and permissions do not change when its IP address, hostname, port, ngrok URL, or preferred route changes.

A route announcement should roughly contain:

```ts
type DeviceRouteAnnouncement = {
  deviceId: string;
  routeId: string;
  kind: 'public-wss' | 'ngrok-wss' | 'lan-wss';
  url: string;
  priority: number;
  issuedAt: string;
  expiresAt: string;
  sequence: number;
  keyId: string;
  signature: string;
};
```

The signature covers every meaningful field, including the full normalized URL, device ID, sequence, and expiry. A monotonically increasing sequence prevents an old but correctly signed URL from replacing a newer one.

A valid signature proves which device announced the URL; it does not by itself prove that the URL currently reaches that device. After connecting, the peer must run a device-protocol challenge in which the endpoint proves possession of the expected device key, or establishes an authenticated end-to-end session tied to that key. Normal TLS certificate validation is still required for HTTPS/WSS, even when application-level identity is also checked.

Every receiving peer must validate route shape and apply strict URL rules. In particular, a remote announcement must not make another peer probe arbitrary loopback, link-local, cloud-metadata, or private-network addresses. LAN routes should be learned and tried only under an explicit LAN-discovery policy.

#### LAN discovery

Optional mDNS or similar LAN discovery can find candidate devices and routes when peers share a network. It must not create trust. A discovered candidate becomes usable only after its stable identity matches an existing network member and the normal authenticated handshake succeeds.

#### Bootstrap discovery

The first connection still requires one address or local discovery result. The user may type or paste an existing device URL, open an invite link, scan a QR, or select a LAN-discovered candidate. After pairing, the signed device directory supplies additional routes and members.

An invitation URL is only a bootstrap route. The accepting device must still prove its stable key, and both sides must confirm the join before it becomes a member.

### Signed membership propagation

The first device creates a random network ID and a genesis membership record tied to its public key. It becomes the first network administrator.

Every device with the administrator role may invite devices. When an administrator approves a new join, it signs a membership certificate containing at least:

- network ID;
- new device ID and public key;
- issuing administrator device ID;
- assigned network role;
- certificate ID, issue time, and protocol version;
- optional expiry for temporary members.

Other peers accept the new member only when they can verify a certificate chain back to the network genesis and confirm that the issuer was an administrator. The certificate is gossiped through the mesh, so Device 3 may join through VPS and become known to Phone, Laptop, and Desktop without pairing separately with each one.

Becoming a member means that peers can authenticate Device 3 and show it in the device list. It does not silently grant Device 3 permission to operate their drones, assistants, files, or terminals. The fixed new-device default is basic discovery with every operational permission denied. A target must explicitly grant any additional access after learning about the member.

Revocation is also an administrator-signed record and takes priority over older membership, name, capability, and route records. A revoked device cannot rejoin by replaying its old certificate.

### Mesh record convergence

The mesh needs a small signed record protocol rather than copying one mutable device-list file between peers. Records should be immutable and include issuer, subject, type, logical sequence, creation time, and signature.

Initial record types include:

- membership certificate;
- revocation;
- device key rotation;
- self-profile and display-name update;
- capability advertisement;
- route announcement and withdrawal;
- administrator-role or invite-authority change.

Peers exchange record summaries and request missing records when they connect. Merge rules must be deterministic:

- valid revocation wins over older records for that device;
- higher valid per-issuer sequence wins for replaceable records;
- an unauthorized issuer is ignored;
- a key replacement requires an authorized signed transition;
- conflicting security records are retained for audit and resolved conservatively rather than by wall-clock time alone.

Presence is not durable mesh state. It is a best-effort observation derived from recent direct or forwarded connections and can differ briefly between peers.

### Pairwise permissions remain local

Membership propagates across the network; operational permission does not become global. Each target owns a policy for every source device and may share a signed summary so the source can render accurate controls.

For example:

```text
Phone joins through VPS.
VPS grants Phone host-drone creation.
Desktop applies its default read-only profile to Phone.
Laptop applies deny-all operational access to Phone.
```

All three devices recognize the same Phone identity, but each relationship has different permissions.

### Recovery without an account

A recovery secret is not required for daily operation. Any surviving administrator device can invite a replacement device and revoke a lost one.

Recovery matters only when no administrator key survives and the user wants to preserve the same network identity. The recommended setup is an optional offline recovery key generated with the network:

- show it once as an encrypted recovery file or recovery phrase;
- never upload it or use it for ordinary connections;
- allow it only to authorize a new administrator key or rotate the network trust root;
- require a visible recovery event and invalidate old administrator authority as configured;
- do not let it decrypt past prompts, transcripts, or file contents.

If the user declines the recovery key and loses every administrator device, the safe result is to create a new device network and pair surviving installations again. There is no account operator who can restore the old trust root.

## Device model

A device record should roughly contain:

```ts
type Device = {
  id: string;
  networkId: string;
  displayName: string;
  deviceType: 'desktop' | 'laptop' | 'server' | 'mobile' | 'unknown';
  platform: string;
  appVersion: string;
  protocolVersions: number[];
  publicIdentityKey: string;
  capabilities: DeviceCapabilities;
  status: 'online' | 'offline' | 'sleeping' | 'revoked' | 'upgrade-required';
  lastSeenAt: string | null;
  joinedAt: string;
  revokedAt: string | null;
};
```

Some fields, such as platform and app version, may be visible only to devices with diagnostics permission.

### Names

- Let any device rename itself.
- Let a network administrator rename any device.
- Sync the main display name across the network.
- Consider local-only aliases later if users need different labels on different devices.
- Never reuse a revoked device ID for a new installation.

### Capabilities

Capabilities should be explicit and versioned. An initial desktop advertisement could include:

```ts
type DeviceCapabilities = {
  droneRuntimes: Array<'container' | 'host'>;
  operations: string[];
  eventStreams: string[];
  directRoutes: Array<'public-wss' | 'ngrok-wss' | 'lan-wss'>;
};
```

Capability advertisement is not authorization. A malicious source cannot gain access by claiming that it supports an operation.

## Permission model

Permissions are directional and target-owned.

For a request from Phone to Desktop, Desktop's policy for Phone is authoritative. Phone may hide unavailable buttons, and an intermediate peer may reject malformed traffic, but Desktop must make the final decision.

### Initial permission keys

Use stable operation names rather than granting raw URL access.

| Permission | Allows | Suggested default |
| --- | --- | --- |
| `devices.read` | See basic devices and presence | Allow after joining |
| `drones.read` | List permitted drones and basic status | Deny |
| `chats.read` | Read permitted chat names and transcripts | Deny |
| `chats.prompt` | Send prompts to permitted chats | Deny |
| `chats.stop` | Stop a permitted run | Deny |
| `drones.container.create` | Create container drones | Deny |
| `drones.host.create` | Create host drones | Deny and mark high risk |
| `drones.rename` | Rename permitted drones | Deny |
| `drones.delete` | Remove permitted drones | Deny and mark high risk |
| `files.read` | Read files in explicitly allowed roots | Deny |
| `files.write` | Modify files in explicitly allowed roots | Deny until explicitly granted |
| `terminal.open` | Open a terminal on the target | Deny and mark high risk |
| `assistants.threads.read` | List and read permitted assistant threads hosted by the target | Deny |
| `assistants.threads.prompt` | Send prompts to permitted assistant threads hosted by the target | Deny |
| `assistants.threads.create` | Create an assistant thread on the target | Deny |
| `settings.manage` | Change target Hub settings | Deny and mark administrative |
| `devices.permissions.manage` | Change device grants | Deny; administrator only |

Do not start with one broad `remote-control` permission. It would recreate the current static route allowlist and make the phone/laptop example impossible to express safely.

### Resource scopes

A permission can be limited further:

- drone runtime: `container`, `host`, or both;
- named drones or groups;
- repository IDs or configured workspace roots;
- allowed creation groups and repository templates;
- optional maximum concurrent creations or requests per minute.

Avoid arbitrary filesystem paths in network policy. Use stable configured root IDs.

An initial grant could look like:

```json
{
  "sourceDeviceId": "phone-id",
  "targetDeviceId": "desktop-id",
  "permissions": {
    "drones.read": { "effect": "allow" },
    "chats.read": { "effect": "allow" },
    "chats.prompt": { "effect": "allow" },
    "drones.container.create": {
      "effect": "allow",
      "scope": { "groups": ["personal"] }
    },
    "drones.host.create": { "effect": "allow" }
  },
  "version": 4
}
```

### Permission templates

Templates make setup understandable, but storage should remain explicit permission grants.

Suggested templates:

- **Observe**: device, drone, and chat reads.
- **Chat operator**: Observe plus prompt and stop.
- **Container operator**: Chat operator plus container creation.
- **Full operator**: all ordinary drone actions, with dangerous actions still shown clearly.
- **Custom**: individual permissions and scopes.

Joining a network should grant only basic device visibility. Pairing must not silently grant Full operator.

### Preconfigured grants and optional live confirmation

The normal policy result is deny or allow. If VPS grants Phone `drones.host.create`, Phone may create a host drone on VPS whenever the grant and its scope are valid. Nobody needs to be physically present at VPS to approve each request.

Sensitive permissions should be difficult to enable accidentally: show the exact source, target, scope, and risk when saving the grant, then enforce the saved decision consistently.

Live confirmation remains an optional extra policy mode for users who want it on a particular permission or thread. It is not the default security model and is not required for unattended targets. A source-side "Are you sure?" confirmation can prevent mistakes but does not add protection against a compromised source device.

### No transitive authority

Permissions must not be transitive. If Phone can control Laptop and Laptop can control Desktop, Phone does not thereby gain access to Desktop.

If Phone asks a drone running on Laptop to contact Desktop, that is a separate Fleet or agent-delegation decision and must carry its own actor identity and policy. Do not hide it as a normal device request.

## Cross-device assistant and thread model

The Drone Hub assistant should span devices, but it must not become a way around device permissions.

A single assistant thread may, for example:

- be opened from Phone;
- run its model and store its transcript on VPS;
- read a workspace root on Laptop;
- write to a different allowed root on Desktop;
- inspect or prompt drones on VPS;
- have no access to those same targets in another thread.

### Three device roles in one assistant action

Keep these roles separate:

1. **Surface device**: where the user opened or prompted the thread, such as Phone.
2. **Assistant home device**: where the thread, model runtime, and authoritative transcript live, such as VPS.
3. **Tool target device**: where a particular tool executes, such as Desktop for a workspace write.

One device can fill all three roles, but the protocol must not assume that it does.

Calling this an "assistant running on Phone" can mean that Phone is the user surface even when VPS actually hosts the model. The UI should show the thread's home device when that distinction matters.

### Threads are stable principals

Every assistant thread needs a network-wide thread ID and an explicit home device. Remote devices refer to it as `{ homeDeviceId, threadId }`, because thread IDs may collide across Hubs.

The thread should be represented in authorization and audit records as its own limited principal. A destination must see the full origin chain:

```text
user -> surface device -> assistant thread -> assistant run -> tool call -> target device
                         hosted by assistant home device
```

Do not reduce this chain to "VPS called Desktop." Doing so would either incorrectly require broad VPS access or let VPS reuse authority that was meant only for one Phone-created thread.

### Device grants are the ceiling; thread policy narrows it

Permanent directional device grants define the maximum possible access. A thread policy then selects a subset for one thread.

```text
effective assistant access = active network membership
                           AND destination device grant
                           AND assistant-use permission
                           AND thread target policy
                           AND assistant home is allowed to present this delegation
                           AND resource scope
                           AND any optional live-confirmation rule
```

A thread override may deny or narrow inherited access immediately. It must not silently widen the destination's permanent grant. Expanding a thread beyond the current ceiling requires an explicit destination policy change signed by the target or an authorized administrator and should create a scoped grant or temporary lease. It is a configuration change, not an assumption made by the thread.

This gives the desired behavior:

- Phone may generally use VPS assistants, drones, and selected filesystem roots.
- Thread A may use VPS drones and Desktop workspace writes.
- Thread B may use only VPS chat and no files.
- A new thread may start with no cross-device targets, even though Phone has broader permanent grants.
- VPS does not gain general access to Desktop merely because it hosts Thread A.
- Desktop gains no access back to Phone merely because it executes a tool for the thread.

### Separate interactive and assistant use

A target should be able to distinguish actions directly requested by a person from tool calls produced by an assistant.

For example, Desktop might allow:

- Phone user to read and write the `personal-projects` root;
- assistants started from Phone to read that root;
- assistants to write only after an optional live confirmation;
- Laptop users to read the root but never let Laptop-originated assistants use it.

Resource grants therefore need an actor/use scope such as `interactive`, `assistant`, or both. A generic `files.write` grant must not automatically imply assistant file writing.

### Thread target policy

A thread policy should roughly contain:

```ts
type AssistantThreadTargetPolicy = {
  homeDeviceId: string;
  threadId: string;
  createdFromDeviceId: string;
  targets: Array<{
    deviceId: string;
    permissions: string[];
    workspaceRootIds?: string[];
    droneIds?: string[];
    droneGroupIds?: string[];
    liveConfirmation?: 'inherit' | 'always';
  }>;
  defaults: {
    workspaceDeviceId?: string;
    workspaceRootId?: string;
    droneDeviceId?: string;
  };
  version: number;
};
```

The policy stores allowed targets and convenient defaults. It does not store destination secrets or Hub tokens.

Thread settings should support:

- no cross-device access;
- inherit an explicitly chosen source-device profile;
- a custom list of target devices and resource scopes;
- temporary access for this thread or run;
- removal of a target at any time.

The safest default for a new thread is no cross-device write access. The product may offer named profiles such as `Personal devices` or `VPS read-only`, but the selected profile and resulting targets must be visible when the thread is created.

### Target selection inside tools

Do not use one hidden global target for every assistant tool. Workspace, drone, and assistant operations may reasonably point to different devices in the same turn.

Recommended assistant-facing operations include:

- list devices and capabilities available to this thread;
- list permitted workspace targets and roots;
- select or change the default workspace target for this thread;
- list permitted drone targets;
- select or change the default drone target;
- execute every tool call with an explicit resolved `targetDeviceId` and resource ID.

The assistant may say "use Desktop for workspace changes and VPS for drones," but the final tool envelope must contain concrete IDs. A target change should be visible in the conversation or tool UI, especially before writes.

### Delegated execution

When an assistant home device sends a tool call to another device, it must use a short-lived authorization bound to the source device, thread, run, destination, allowed operations, and resource scopes. It must not copy the Phone's device credential to VPS or give VPS a reusable Desktop credential.

The concrete mechanism can be a reviewed capability or delegation token design, but it needs these properties:

- short expiry;
- exact destination and thread binding;
- bounded operations and resources;
- no ability to widen arguments beyond the grant;
- revocation or policy-version checking;
- replay protection and idempotency;
- audit linkage to the initiating surface and executing assistant home device.

If the user closes a thread's access to Desktop, later calls from that thread must fail even if VPS retained an old connection.

### Where thread data lives

For the first version, one assistant home device should remain authoritative for the thread and transcript. Other devices remotely view or prompt it through `assistants.threads.read` and `assistants.threads.prompt`.

This is simpler and safer than automatically copying every transcript to every device. Network-wide encrypted thread replication or thread migration can be designed later as a separate feature.

If the home device is offline, the thread is unavailable unless a deliberate migration or replicated-thread feature exists. The UI should say this plainly rather than silently opening a different thread.

### Assistant-specific audit

Each cross-device tool audit entry should include:

- surface device;
- thread ID and home device;
- run and tool-call IDs;
- target device and resolved resource IDs;
- effective permission and thread-policy versions;
- optional live-confirmation result;
- completion or denial result.

Do not record hidden reasoning. Tool arguments and results should be redacted and bounded according to the destination's audit policy.

## Request protocol

Do not forward arbitrary HTTP methods and paths between devices. Define typed operations and adapt them to the local Hub behind the target boundary.

The bidirectional protocol needs these message families:

- `hello` and negotiated protocol version;
- `request`;
- `response`;
- `event_subscribe` and `event`;
- `cancel`;
- optional `confirmation_required` and `confirmation_result`;
- `capabilities_changed`;
- `ping` and `pong`.

Example request envelope:

```json
{
  "version": 1,
  "type": "request",
  "requestId": "uuid",
  "sourceDeviceId": "phone-id",
  "senderDeviceId": "vps-id",
  "actor": {
    "kind": "assistant",
    "surfaceDeviceId": "phone-id",
    "threadId": "thread-id",
    "threadHomeDeviceId": "vps-id",
    "runId": "run-id",
    "toolCallId": "tool-call-id"
  },
  "targetDeviceId": "desktop-id",
  "operation": "drones.create",
  "arguments": {
    "runtime": "host",
    "name": "researcher",
    "group": "personal"
  },
  "createdAt": "2026-07-12T12:00:00Z",
  "expiresAt": "2026-07-12T12:00:30Z",
  "idempotencyKey": "uuid"
}
```

The target validates the envelope, authenticates the source, resolves `drones.host.create`, checks scopes and any optional live-confirmation rule, then calls a narrow local service. It returns a sanitized result.

`senderDeviceId` is the device whose authenticated connection delivered the envelope. `sourceDeviceId` is the device from which the user or automation originally delegated the action. For an ordinary interactive request they are normally the same. For an assistant request hosted elsewhere, the target must authenticate the sender and validate the signed delegation that links it to the source, surface, thread, and run.

For an interactive request, `actor.kind` is `interactive` and assistant fields are absent. For an assistant request, the target also validates the thread/run delegation and assistant-specific resource scope. The assistant home device must appear separately from the originating surface device when they differ.

### Reliability rules

- Every state-changing request needs an idempotency key.
- Requests expire quickly and are rejected outside an allowed clock-skew window.
- A reconnect may retry an unresolved request with the same idempotency key.
- The target stores bounded recent request results so a retry cannot create two drones.
- Cancellation is best effort and reports whether the local operation had already completed.
- Event subscriptions resume from a cursor when the local event source supports it.
- Sensitive commands are not queued while the target is offline by default.

## Security model

### Device identity

- Generate a public/private identity key during installation. The private key never leaves the installation.
- Store the private key in the OS keychain, Android Keystore, or iOS Keychain where available.
- Bind the device ID and network membership to the public key during confirmed pairing.
- Use the identity key to authenticate connection setup and sign route announcements and other small control records.
- Authenticate peer sessions with the device identity and derive short-lived session keys.
- Rotate session credentials without changing the stable device ID.
- Support deliberate identity-key rotation through a signed transition approved by an administrator; do not silently replace a key because a URL changed.
- Treat reinstallations and key loss as new devices unless a deliberate encrypted recovery process exists.

Use established platform cryptography and reviewed protocols. Do not design custom encryption primitives or invent a signature canonicalization format casually. Select the concrete algorithm and library only after confirming secure-storage and crypto support across Node, Android, and iOS. Broad platform support may make a hardware-backed P-256 identity preferable; Ed25519 signing plus a suitable key-agreement protocol is also reasonable when every target platform supports it reliably.

The signing key and any key-agreement or payload-encryption key should have distinct purposes, even if a reviewed protocol derives them from one protected root. Published key records need a `keyId`, algorithm, creation time, status, and rotation history so peers can reject an unknown replacement.

### Pairing

The pairing flow should be mutual and short-lived:

1. A trusted device creates a one-time invite, normally displayed as a QR code and short fallback code.
2. The new installation generates its own key and redeems the invite.
3. The trusted device shows the new device's name, platform, and a short verification fingerprint.
4. The user confirms the join and chooses the joining peer's initial pairwise permission profile.
5. The approving administrator signs the new membership certificate and shares the current signed mesh records.
6. Both devices record a pairing audit event.

An invite should expire within a few minutes, be single-use, and become useless after confirmation or cancellation. Scanning a QR must not immediately create a broad authenticated browser session as the current Remote Hub flow does.

For a new desktop without a camera, let it display a code that an existing trusted device confirms.

### Encryption

All Internet routes require TLS. Application-layer end-to-end encryption between source and target is the intended production design so a forwarding peer handles opaque request contents. An intermediate peer may still see routing metadata such as source and destination device IDs, timestamps, sizes, and presence.

The earliest development milestone may temporarily use authenticated TLS-only peer connections to validate pairing, routing, and permissions. Before forwarded routes carry real prompts, transcripts, file contents, or commands in a production release, destination-level encryption should be complete. Document any interim trust clearly and do not market it as end-to-end encrypted. Do not add home-grown cryptography to meet a date.

TLS protects each network connection. Signed route records and the application-level device handshake solve a different problem: they keep a changing hostname or tunnel URL from becoming the device's identity. Both layers are required for a secure direct route.

### Provisional cross-platform cryptography stack

The recommended implementation direction is a small shared Rust security core rather than separate JavaScript and Android protocol implementations:

- use the Noise Protocol Framework for mutually authenticated, forward-secret peer sessions;
- use the Rust `snow` implementation as the first library candidate;
- use a standard Noise suite based on X25519 key agreement, ChaCha20-Poly1305 authenticated encryption, and a Noise-supported hash;
- use a separate Ed25519 signing key, through a maintained Rust implementation such as `ed25519-dalek`, for membership, revocation, profile, and route records;
- expose a narrow API to the Node Hub and Android app through reviewed native bindings;
- wrap or protect long-lived private material with the operating-system key store.

During manual-URL pairing, a Noise XX-style first-contact handshake plus a fingerprint shown on both devices can support mutual confirmation. A QR or invite may pin the existing device's public key before the handshake. After membership, peers already know each other's authenticated static keys and should use the appropriate pre-known-key Noise pattern selected during the security review.

Noise defines the authenticated session handshake and transport encryption, avoiding a custom combination of raw primitives. Libsodium remains a strong alternative source of portable primitives, but it does not by itself define the complete pairing, transcript binding, key confirmation, or session state machine needed here. Signal's `libsignal` is designed for a broader asynchronous messaging system, adds substantial integration complexity, and its license and intended use need separate review before considering it.

This choice remains provisional until a small spike proves all of the following:

- deterministic test vectors match on Node and Android;
- Android Keystore wrapping and reinstall behavior work correctly;
- native packaging supports the required desktop and Android architectures;
- handshake interruption, reconnect, route change, and key rotation are handled safely;
- the library licenses fit the repository;
- the final pattern and key separation receive focused security review.

### Enforcement order on the target

1. Validate protocol version, size, and schema.
2. Verify source identity and active network membership.
3. Reject replayed, expired, or duplicate-invalid envelopes.
4. Resolve the typed operation to a permission key.
5. Evaluate target-owned permission and resource scope.
6. Obtain optional live confirmation when the saved policy requires it.
7. Validate local arguments again.
8. Execute through the local Hub service.
9. Sanitize the response.
10. Append an audit event.

### Secrets

- Never send the local Hub bearer token to an intermediate or another device.
- Never accept a remote request containing a replacement local Hub token.
- Do not return environment variables, raw host paths, provider keys, or daemon tokens in summaries.
- Treat transcript text and prompts as sensitive user data.
- Keep forwarding, pairing, and device credentials out of diagnostic logs.

### Revocation and policy freshness

Revocation must close known active peer sessions and prevent new ones. Each target must check locally known signed membership, revocation, and policy state before executing a request.

Because mesh propagation is not instantaneous, authorization and delegated assistant leases must be short-lived. A target that learns a newer revocation or policy version rejects older authority immediately. A peer that has been isolated too long should fail closed for privileged remote writes until it synchronizes security records with a non-revoked member.

### Isolation and delayed revocation

An **isolated device** is still running and may still have one peer connection, but it has not synchronized security records with the wider mesh recently.

Example:

1. Phone, Desktop, and VPS are members.
2. VPS loses its routes to Desktop but remains connected to Phone.
3. Desktop revokes Phone because it was stolen.
4. The signed revocation cannot reach VPS yet.
5. VPS still has an old local record saying Phone is a valid member with host-drone permission.

VPS cannot know whether "no new revocation received" means nothing changed or means the revocation is stuck behind a network partition. No peer-to-peer design can perfectly preserve both availability and immediate global revocation in that situation without another reachable authority or a quorum of peers.

There are three possible policies:

- **Availability first**: VPS keeps honoring its saved grant indefinitely. This is convenient, but a revoked device may retain access until the partition heals.
- **Security first**: VPS stops privileged remote actions whenever it cannot prove recent synchronization. This limits stale access, but legitimate remote control may stop during an outage.
- **Tiered freshness**: allow low-risk reads longer, but stop high-risk writes after a shorter security-sync window.

Recommended first policy:

- target-owned local permissions do not change while the target is offline; another device cannot silently rewrite them in storage;
- a global signed member revocation takes effect immediately when the target receives it;
- low-risk remote reads may use cached membership for up to seven days;
- when other administrator devices exist, host creation, deletion, terminal access, file writes, settings changes, and assistant writes require a mesh security sync within the previous 24 hours;
- if the target is the only administrator currently authorized to revoke or change the relevant relationship, its own local policy is authoritative and no impossible third-party freshness proof is required;
- targets expose `lastSecuritySyncAt` and explain stale-security denials;
- an advanced per-target **availability first** setting may allow an unattended VPS to keep honoring selected grants beyond that window, with a clear stolen-device warning;
- local actions on the target remain available regardless of mesh freshness.

The 24-hour and seven-day values are starting defaults, not cryptographic constants. Real use should inform them. A security sync should come from another currently valid administrator or enough independent peers to make the requesting device alone unable to certify that it has not been revoked.

### Threat boundaries

- A compromised source device can perform only actions granted to it on each target.
- A compromised target device controls its own local Hub and local data; the network cannot make that machine safe.
- A compromised forwarding peer must not receive local Hub tokens. End-to-end encryption protects forwarded request contents, but the peer may still disrupt or observe routing metadata.
- A stolen pairing invite has limited value because it is short-lived, single-use, and requires confirmation.
- A hidden or disabled UI control is not a security boundary.

## Devices user experience

### Device list

Each Drone Hub surface should show:

- display name and type;
- online, sleeping, offline, revoked, or upgrade-required state;
- last seen time;
- supported drone runtimes;
- current route, under diagnostics rather than as a primary concept;
- what this device may do on the selected target;
- recent denied or allowed remote actions.

Loading, empty, offline, error, and protocol-upgrade states need explicit copy. An offline target should disable actions and explain that sensitive actions are not queued.

### Target selection

The main Hub UI should have a visible device selector. Selecting a device changes the namespace for the drone list, chats, and creation actions.

Use compound identity internally, such as `{ deviceId, droneId }`. Existing drone IDs and names cannot be assumed unique across devices.

The UI should always show the active target near dangerous actions. For example:

```text
Create host drone "researcher" on Workstation
```

Assistant threads need target chips or equivalent visible state for workspace, drones, and assistant home. A thread-level override should be reachable from the conversation, and a new thread should clearly show whether it inherited a profile or started with no cross-device access.

### Permission editor

The permission screen should be written from the target's point of view:

```text
What may Travel laptop do on Workstation?
```

Show a template first, then expandable custom permissions. Dangerous permissions need plain explanations. Saving a grant should display the effective result, including scopes and any optional live-confirmation rule.

### Audit

Minimum audit fields:

- event ID and timestamp;
- source and target device IDs and display names at that time;
- operation and resource IDs;
- allow, deny, optional confirmation requested, confirmed, failed, or completed result;
- policy version and denial reason;
- request ID and idempotency key;
- bounded, redacted metadata.

Do not store full prompts or transcripts in a general security audit log by default.

## Fit with current code

### What can be reused

- Existing Hub domain operations and drone lifecycle services remain the target's local execution layer.
- Existing SSE drone and chat events can feed the target-side event adapter.
- Current QR generation and remote-access UX provide useful pairing UI lessons.
- The Voice Stream Next extension bridge demonstrates that an outbound WebSocket device can receive typed requests and return bounded results.
- Existing Drone SDK types can inform operation names and result schemas.

### What should not become the new boundary

The current Remote Hub server:

- authenticates a browser with one broad persisted cookie;
- proxies a static allowlist of Hub HTTP routes;
- has one permission level for all paired sessions;
- filters out host drones instead of expressing a permission;
- is tied to one Hub and one public URL.

That is appropriate as a limited bridge, but it should not be expanded into the multi-device security layer. The new target command handler should use typed operations and per-source policies.

The Voice Stream Next bridge is useful evidence but should not be imported as the Drone Hub network wholesale. It currently routes extension calls through a central server and is designed around a different product and user model.

## Data ownership

Recommended ownership for the first version:

| Data | Authoritative owner |
| --- | --- |
| Network membership and revocation | Administrator-signed mesh records replicated by peers |
| Main device name | Device-signed self-profile replicated by peers |
| Presence | Each observing peer, short-lived and best effort |
| Installation private key | Device only |
| Signed route announcements | Advertising device, verified and cached by peers |
| Device capability advertisement | Device, cached by peers |
| Directional grants and policy versions | Target device; optional signed summary shared with source |
| Local Hub data and credentials | Target device only |
| Detailed execution audit | Target device |
| Network membership audit | The replicated signed mesh record set |

No peer needs a central policy cache. A target enforces its own local grants. Short-lived assistant delegation and isolated-peer rules still need explicit expiry so stale mesh knowledge cannot retain privileged authority indefinitely.

## Recommended first-release product slice

The first useful release should include:

- one device network per owner;
- desktop and Android React Native device identities;
- direct peer WSS plus outbound WSS to a reachable member for devices without inbound access;
- signed membership and mesh-record propagation;
- destination-encrypted forwarding through a peer before production carries sensitive content;
- QR/link/code pairing with confirmation;
- device list, rename, presence, and revoke;
- target selection;
- read drones and chats;
- prompt and stop;
- container creation and host creation as separate permissions;
- directional permission templates plus custom toggles;
- target-side enforcement and audit;
- actor-chain fields in the protocol so later assistant delegation cannot be mistaken for ordinary device access;
- no offline command queue;
- clear migration path from Remote Hub.

This slice directly supports the Phone, Laptop, Desktop, and VPS examples as long as each outbound-only device can reach at least one currently connected public, ngrok, or LAN member.

## Decisions recorded

1. Use a self-hosted peer device mesh with no separate coordination service.
2. Require no account; device keys and signed membership are the identity system.
3. Offer an optional offline recovery key, but do not require it for normal use.
4. Permit an early TLS-only development milestone, but require destination-level end-to-end encryption before production forwarding carries sensitive data.
5. Use preconfigured pairwise grants as the normal authorization model; do not require live approval for every sensitive action.
6. Build Android first. Keep shared code platform-neutral and validate iOS cryptography and protocol support before the architecture hardens.
7. Every administrator may invite and sign membership for new devices.
8. A newly propagated member receives discovery visibility and no operational access by default.
9. Outbound-only devices should target two active bridge connections for redundancy and use at most three by default.
10. The first Android release is reachable only while its mesh connection remains alive; do not require an external push provider initially.

## Additional architecture recommendations

1. Use **device network** as the product term and reserve **Fleet** for drones.
2. Treat direct, ngrok, LAN, and forwarded peer paths as interchangeable routes under one protocol.
3. Let reachable members bridge outbound-only peers without gaining transitive authority or plaintext access.
4. Make permissions directional, deny-by-default, and enforced on the target.
5. Split host creation from container creation from the beginning.
6. Use typed operations rather than remotely proxying Hub HTTP routes.
7. Make the React Native app the replacement for Remote Hub.
8. Pairing grants membership and basic visibility, not broad control.
9. Do not allow transitive device permissions.
10. Use compound device-and-resource IDs throughout the UI and protocol.
11. Discover devices through signed mesh records and treat changing URLs as signed, expiring routes rather than identities.
12. Make permanent device grants the ceiling and let assistant threads only narrow them unless a destination explicitly approves an expansion.
13. Keep surface, assistant home, and tool target devices distinct in protocol, policy, UX, and audit.
14. Use Noise through one shared Rust security core as the provisional encryption direction, subject to the cross-platform spike and security review.

## Open product decisions

These choices matter, but they do not block the recommended architecture:

1. Should the tiered isolation defaults be 24 hours for privileged writes and seven days for low-risk reads, or should availability win by default?
2. Does the proposed Noise/`snow` Rust core pass the Node and Android implementation spike and license review?
3. Should basic device presence be visible to every network member, or may a device be hidden from selected members?
4. How long should offline devices remain in the normal list before moving to an inactive section?
5. Should a new assistant thread default to no cross-device access or inherit a visible named profile?
6. How long may a thread or run delegation remain valid while a destination is temporarily unreachable?
7. Which assistant thread data, if any, should eventually replicate away from its home device?
8. May an administrator configure another target's policy while that target is offline, or must target-owned changes wait for it to reconnect?
9. What exact actions may the optional offline recovery key authorize?
