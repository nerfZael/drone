# Drone Hub Device Network — Delivery Roadmap

## Status

Active sequencing plan based on `DRONE_HUB_DEVICE_NETWORK_SPEC.md`. The focused prototype's Milestones 0 and 1 were implemented on 2026-07-13; the legacy browser client has been retired in favor of the Android app and device mesh, while release validation and later production-hardening phases remain.

The approved prototype slice and its acceptance scenarios are defined in `DRONE_HUB_DEVICE_NETWORK_PROTOTYPE.md`.

## Delivery principle

Prove identity, authorization, and universal connectivity before adding faster routes or broad feature parity.

The first vertical slice should send one harmless typed request directly between two real devices and show an enforced denial when permission is missing. A second slice should forward the same destination-encrypted request through a third member. This tests the security and routing boundaries before building a large remote UI on top of them.

## Phase 0 — Decisions and protocol threat review

### Scope

- Choose standard device identity and secure-storage mechanisms for desktop, Android, and iOS.
- Define signed route announcements, URL validation, endpoint identity proof, withdrawal, expiry, and stale-sequence handling.
- Define signed membership certificates, invite authority, revocation, deterministic mesh-record merge rules, and partition behavior.
- Choose a reviewed peer handshake and destination-level encryption protocol.
- Write a small threat model for stolen devices, malicious forwarding peers, invite theft, replay, stale policy, and partitioned membership.
- Freeze user-facing terms: Device, Device network, Capability, Permission, Target.
- Define Surface device, Assistant home device, Tool target device, and Thread target policy.
- Inventory existing Hub operations and classify their risk.

### Deliverables

- Version 1 protocol envelope schemas.
- Actor-chain and scoped assistant-delegation schemas, even if cross-device tools ship later.
- Version 1 permission registry with an owner for each permission.
- Pairing state machine.
- Pairwise policy evaluation and optional live-confirmation rules.
- Data retention and redaction rules.
- Optional offline recovery-key format and a documented no-recovery outcome.

### Exit criteria

- Every v1 operation maps to exactly one permission and target-side handler.
- No v1 operation accepts a raw Hub route or Hub bearer token.
- Replay, revocation, key loss, and protocol downgrade behavior is written down.
- URL changes cannot replace a device identity or public key.
- Mobile secure storage is validated on actual target platforms.
- Membership added through one peer converges safely to the other connected peers.

## Phase 1 — Device identity and local target boundary

### Scope

- Generate and persist a stable installation identity.
- Add a local device record and capabilities advertisement.
- Add a local route observer that can detect, normalize, announce, refresh, and withdraw public or ngrok routes.
- Build the target-side typed command dispatcher.
- Implement local policy evaluation with deny-by-default behavior.
- Add idempotency and bounded audit storage.
- Start with harmless operations such as `device.describe` and a sanitized drone list.

### Important tests

- Unknown source is denied.
- Revoked source is denied.
- Missing, malformed, expired, oversized, and replayed requests are denied.
- The same idempotency key cannot create duplicate work.
- A source cannot change `sourceDeviceId` and inherit another grant.
- An assistant home device cannot reuse one thread's authority for another thread or for interactive access.
- An old signed route announcement cannot replace a newer sequence.
- A signed URL that serves the wrong device fails the endpoint identity challenge.
- A container-only grant cannot create a host drone.
- Responses do not leak local Hub tokens, environment values, or unintended host paths.

### Exit criteria

- A local test transport can execute and deny typed requests without HTTP route proxying.
- Permission checks occur before all local side effects.
- Audit records explain every allow and denial.

## Phase 2 — Peer mesh membership and transport

### Scope

- Create a network genesis record and administrator-signed membership certificates.
- Pair directly through a supplied URL, QR/link, short code, or authenticated LAN candidate.
- Exchange and deterministically merge signed membership, revocation, profile, capability, and route records.
- Add authenticated direct peer WSS with heartbeats, reconnect, and protocol negotiation.
- Let outbound-only devices maintain bidirectional WSS connections to reachable member devices.
- Target two active bridge connections per outbound-only device, with at most three by default.
- Keep an HTTPS+SSE transport adapter available for environments where WebSocket is unsuitable, using SSE for delivery and authenticated POSTs for the return direction.
- Forward bounded request, response, cancellation, confirmation, and event messages toward connected destinations.
- Add rate, hop, loop, size, and connection limits at every forwarding peer and target.
- Add destination-level encryption before production forwarding carries sensitive content.
- Propagate policy summaries where useful while keeping the target's local policy authoritative.

### Keep forwarding narrow

A bridge peer should authenticate mesh members, choose a known next hop, and forward opaque envelopes. It should not know how to create a drone, interpret arbitrary Hub API routes, or gain the source's permissions.

### Exit criteria

- Two directly reachable desktop installations can exchange a typed request.
- Phone and Laptop can exchange a typed request while both maintain outbound connections to VPS.
- The same bounded request works through the HTTPS+SSE adapter without either outbound-only device opening a listening port.
- A disconnected target produces a clear offline result and no queued sensitive command.
- Revoking a device propagates and closes known active peer connections.
- Reconnect does not duplicate a completed state-changing request.
- An incompatible protocol version gives an upgrade-required state rather than a generic offline error.
- Changing an ngrok URL updates online and reconnecting peers without using the old URL.
- Old routes expire or are withdrawn and direct-route failure uses another available mesh path.
- A forwarding VPS cannot decrypt the Phone-to-Laptop application payload.

## Phase 3 — Pairing and Devices UI

### Scope

- One-time QR, link, and short-code invites.
- Explicit confirmation on an existing trusted device.
- Display-name entry and rename.
- Device list with online, sleeping, offline, revoked, and upgrade-required states.
- Directional permission templates and custom permission editor.
- Revoke and re-pair flows.
- Device and membership audit views.

### UX states to cover

- no other devices;
- creating an invite;
- invite expired or already used;
- new device awaiting confirmation;
- confirmation denied;
- initial policy still syncing;
- target offline;
- target online but missing a capability;
- permission denied;
- optional live confirmation waiting, confirmed, denied, or expired;
- revoked device attempting to reconnect;
- client upgrade required.

### Exit criteria

- A nontechnical user can add a second desktop without entering a URL or port.
- Pairing alone does not grant drone control.
- A user can express Phone-to-Desktop and Laptop-to-Desktop permissions differently.
- Device names can change without changing identity or breaking grants.

## Phase 4 — React Native mobile app

Ship Android first. Keep the shared protocol and application model platform-neutral, and run a small iOS technical validation for key storage, pairing, and encrypted peer sessions before making choices that would block a later iOS app.

### Scope

- Pair a mobile installation as a first-class device.
- Store identity and credentials in native secure storage.
- List devices and select the active target.
- Create, open, and prompt permitted assistant threads hosted by the selected target.
- List permitted drones and chats.
- Read chat state and stream updates.
- Send prompts and stop runs.
- Create container or host drones only when separately permitted.
- Surface optional confirmation, denial reasons, offline states, and target identity.
- Treat Android as reachable only while its mesh connection remains alive; report sleeping or offline clearly when the operating system suspends it.

### Suggested parity order

1. Device pairing and target selector.
2. Remote assistant thread access.
3. Drone and chat read-only views.
4. Prompt and stop.
5. Container creation.
6. Host creation and permission configuration.
7. Remaining desktop panels that are valuable on mobile.

Do not copy every desktop panel merely for parity. Mobile should keep a focused remote-control experience while using the same underlying operations.

### Exit criteria

- The mobile app covers the required mobile workflows.
- Host drones are not hidden globally; they appear only when the target supports them and policy permits them.
- Logging out or revoking mobile invalidates its network credentials, not just local UI state.
- The active target is visible near every state-changing action.
- The Android app can remain reachable through an outbound connection to a member bridge when the platform allows it, and reports sleeping clearly when background suspension stops that connection.

## Phase 5 — Desktop multi-device Hub experience

### Scope

- Add a persistent device selector to desktop Drone Hub.
- Namespace drones, chats, pending work, and unread state by device ID.
- Open permitted assistant threads on another device while keeping their home device visible.
- Allow desktop-to-desktop and desktop-to-VPS control.
- Add per-target create flows and clear runtime choices.
- Merge local and remote audit context without mixing local IDs.
- Provide explicit diagnostics for route and latency.

### Migration concern

Existing state often assumes one Hub owns all listed drones. Before displaying multiple devices in one UI, audit selections, URL construction, caches, unread keys, drag-and-drop IDs, event subscriptions, and optimistic updates for assumptions that `droneId` is globally unique.

Prefer a shared resource reference:

```ts
type DroneRef = {
  deviceId: string;
  droneId: string;
};
```

Do not solve collisions by prefixing display names.

### Exit criteria

- Switching targets cannot send an action to the previously selected device.
- Concurrent event streams from two devices do not mix state.
- A device going offline leaves understandable stale state and disables writes.
- Local Drone Hub operation remains usable when no other mesh device is reachable.

## Phase 6 — Cross-device assistant and thread policies

### Scope

- Give every assistant thread an explicit home device and network-wide compound reference.
- Allow permitted surfaces to create, view, and prompt assistant threads hosted on another device.
- Add per-thread target policies for workspace roots, drones, groups, and assistant services.
- Add separate defaults for workspace targets and drone targets.
- Add assistant-use scopes to destination permissions.
- Issue short-lived, thread-and-run-bound delegation for cross-device tool calls.
- Show surface, home, and target devices in optional confirmations and tool UI.
- Add thread-policy versioning, immediate narrowing, expiry, and audit.

### Security rules

- A thread policy cannot silently exceed a destination device grant.
- The assistant home device receives no reusable credential for the destination.
- A destination validates the full actor chain and final tool arguments.
- One thread's delegation cannot be replayed from another thread or interactive client.
- Removing a thread target stops future tool calls and invalidates old authorization promptly.
- Destination permissions distinguish interactive requests from assistant-produced requests.

### UX states to cover

- thread has no cross-device access;
- inherited named profile;
- target available but not permitted for this thread;
- source device permits an action but destination denies assistant use;
- workspace and drone defaults point to different devices;
- target changed during a conversation;
- optional live confirmation waiting on another device;
- thread home device offline;
- delegation expired or policy changed.

### Exit criteria

- A Phone-created thread hosted on VPS can write to an allowed Desktop root and operate allowed VPS drones.
- A second Phone-created thread can have no Desktop access without changing Phone's permanent grants.
- VPS cannot use the first thread's delegation for its own interactive access to Desktop.
- Desktop executing a tool does not gain access back to Phone or VPS.
- Every tool card and audit entry identifies the resolved target and actor chain.

## Phase 7 — Legacy browser-client retirement (complete)

### Scope

- Browser pairing and its broad persisted sessions are no longer issued.
- Mobile pairing is available through the Devices screen and device mesh.
- ngrok is managed independently as an optional mesh route provider.
- The legacy proxy, PWA, lifecycle controls, sessions, and compatibility endpoints have been deleted.

### Exit criteria

- Required workflows exist in mobile or desktop device-network surfaces.
- No broad browser-session authentication remains in the product.
- Support documentation explains that not every device needs public ingress, but outbound-only devices need a reachable member path.
- Removing the old proxy does not remove unrelated Hub SSE or local APIs.

## Phase 8 — Mesh routing hardening

### Scope

- Public VPS WSS route.
- Existing ngrok endpoint as a route provider.
- LAN discovery and direct TLS/WSS.
- Multi-hop forwarding with loop prevention and bounded hop counts.
- Multiple simultaneous bridge connections for outbound-only devices.
- Route negotiation, health-based selection, and fallback through another member.
- Short-lived authorization leases and policy freshness checks across partitions.
- Route health, timeout, and failover diagnostics.

### Route-selection rule

Choose a route using reachability, security, hop count, and measured health. Never choose it from device permissions. A direct route failure should use another available mesh path without changing the operation or grant.

### Exit criteria

- The same protocol conformance tests pass over direct and forwarded transports.
- An isolated path cannot retain revoked authority after its lease expires.
- Route changes during an event stream do not duplicate state-changing actions.
- Losing one bridge does not interrupt an outbound-only device when another healthy bridge connection exists.

## Phase 9 — Later extensions

Potential follow-ups after the core is stable:

- multiple human users and roles;
- per-device notification and voice capabilities;
- file transfer with explicit roots and size limits;
- encrypted thread replication and migration;
- device groups and bulk policy templates;
- temporary time-bound grants;
- recovery-key rotation and richer recovery UX;
- richer permission profiles and temporary grants;
- device health and capacity-aware drone placement;
- opt-in offline queues for carefully selected idempotent operations.

These should use the same device identity, typed protocol, policy evaluator, and audit model rather than introduce side channels.

## Recommended first milestone

Build the smallest end-to-end proof with this exact behavior:

1. Desktop A and Desktop B join one test device network.
2. A connects directly to B through B's supplied URL and both verify their device keys.
3. A sees B as online.
4. A requests B's sanitized device description and drone list.
5. B denies the drone list because no grant exists, and both sides show the reason.
6. On B, the user grants A `drones.read`.
7. A retries and receives the sanitized list.
8. Device C joins through B and its signed membership propagates to A.
9. C receives basic membership visibility but no operational permission on A until A configures it.
10. C sends a destination-encrypted read request to A through B; B forwards it without decrypting it.
11. A revokes C, the signed revocation propagates, known C connections close, and another request fails.

This milestone proves device identity, membership, routing, target-side authorization, policy updates, sanitization, audit, and revocation without taking on mobile UI or drone creation yet.

## Workstreams

These areas can later be developed in parallel once Phase 0 contracts are stable:

| Workstream | Main responsibility |
| --- | --- |
| Protocol | Schemas, version negotiation, conformance fixtures |
| Target security | Identity, policy evaluator, dispatcher, audit, idempotency |
| Mesh transport | Membership records, pairing, gossip, direct connections, forwarding, route selection |
| Desktop UX | Devices, grants, target selector, diagnostics |
| Mobile | Native pairing, secure storage, focused control UI |
| Migration | Legacy-client inventory, parity, session revocation, retirement |

The protocol and target-security contracts should land before other workstreams depend on them.

## Manual acceptance scenarios

Run these scenarios on real networks, not only local test sockets:

1. Phone on cellular and Desktop behind a home router both connect outbound to VPS; Phone controls Desktop through VPS without VPS seeing payload contents.
2. Laptop on hotel Wi-Fi controls a public VPS.
3. Desktop controls Laptop with no ngrok or open port through a reachable member to which Laptop is already connected.
4. Phone may create host drones on Desktop, while Laptop receives a clear denial for the same action.
5. Laptop may create container drones on Desktop and cannot change the request to host at the protocol level.
6. A target disconnects during creation; retry does not create a duplicate drone.
7. A device is revoked while connected and loses access promptly.
8. A stolen or expired pairing QR cannot be reused.
9. Two devices and two drones share the same display names without routing mistakes.
10. The current bridge goes offline; local Hubs remain usable and peers choose another known path when one exists.
11. Protocol version mismatch produces a clear upgrade message.
12. Audit entries identify the real source and target without storing prompt text.
13. Restart ngrok with a different URL; peers learn it through mesh propagation, reject the old sequence, verify the target key, and reconnect without re-pairing.
14. Replace a signed URL with an endpoint controlled by another device; the endpoint identity handshake fails and another mesh path remains available.
15. Create two threads from Phone: one can write to Desktop and use VPS drones, while the other has no cross-device tools.
16. Host the first thread on VPS; verify that VPS cannot reuse the thread authorization outside that thread or after access is removed.

## Main risks

### Risk: treating a forwarding peer as the permission boundary

Mitigation: every target evaluates every operation before local execution. Forwarder checks are only traffic protection and defense in depth.

### Risk: expanding the existing HTTP proxy

Mitigation: require a typed operation and explicit permission mapping for every remote action.

### Risk: hidden single-Hub assumptions in the UI

Mitigation: introduce compound resource references before merging remote data into desktop state.

### Risk: permissions become too hard to understand

Mitigation: use a few templates, plain descriptions, visible target context, and effective-policy previews.

### Risk: peer networking becomes a distributed-systems project

Mitigation: start with direct two-peer connections and one-hop forwarding through a known member. Add multi-hop routing and redundancy only after signed membership convergence is reliable.

### Risk: membership records diverge during a partition

Mitigation: use immutable signed records, deterministic merge rules, revocation precedence, bounded authorization leases, and conservative failure for stale privileged access.

### Risk: mobile background suspension appears as random failure

Mitigation: model sleeping separately from offline and never assume a mobile socket is permanent. The first Android release does not depend on push wake-up; evaluate that separately later.

### Risk: broad host access leaks through a smaller permission

Mitigation: review operation-to-permission mappings, keep host creation separate, scope files and terminals separately, and test argument tampering.

## Questions to answer before Phase 1 implementation

1. Do the proposed 24-hour privileged-write and seven-day low-risk-read isolation windows match the desired security/availability balance?
2. What exact actions may the optional offline recovery key authorize?
3. Does the Noise/`snow` Rust core pass the Node and Android spike, packaging, test-vector, and license checks?
4. May an administrator configure another target's policy while that target is offline, or must target-owned changes wait for it to reconnect?
5. What audit retention is useful without collecting excessive sensitive metadata?
