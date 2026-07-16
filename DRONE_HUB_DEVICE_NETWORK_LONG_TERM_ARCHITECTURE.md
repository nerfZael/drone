# Drone Hub Device Network: Long-Term Connectivity Architecture

## Status

Proposed long-term direction for reliable cross-device connectivity. This document refines the
current prototype and roadmap; it is not a description of the implementation as it exists today.

Related documents:

- `DRONE_HUB_DEVICE_NETWORK_SPEC.md`
- `DRONE_HUB_DEVICE_NETWORK_PROTOTYPE.md`
- `DRONE_HUB_DEVICE_NETWORK_ROADMAP.md`

## Core premise

The network must not assume that any URL, relay, or member device is permanently available.

- Devices can sleep, restart, move between networks, change addresses, or disappear permanently.
- Public tunnel URLs can rotate without warning.
- Relays can fail, be replaced, or move to new endpoints.
- A device can retain its identity while all of its previously known routes become invalid.
- Network partitions can last for an arbitrary amount of time.

The durable parts of the system are cryptographic identity, signed membership, revocation history,
and destination-owned permissions. Routes and presence are temporary observations.

Changing a route must never create a new device, grant authority, revoke authority, or reset
permissions.

## Required invariants

1. Pairing is enrollment of a previously unknown identity, not connection setup.
2. A known, non-revoked device can reconnect through a new route after proving possession of its
   existing private key.
3. Permissions are keyed by device identity and target device, never by URL, socket, relay, device
   name, or pairing session.
4. Offline means unreachable, not revoked or forgotten.
5. A relay transports and helps peers discover opaque traffic; it does not grant membership or
   permissions.
6. No single route or relay is required for correctness.
7. If no peers share a reachable route or discovery mechanism, the system reports a partition. It
   does not silently re-pair, weaken authentication, or pretend that automatic recovery is possible.

## Logical model

```text
                         optional relay A
                       /                  \
Phone  <---- LAN/direct ---->  Desktop  <---- outbound connection
   \                         /    \
    \---- optional relay B -/      \---- temporary tunnel

All paths are replaceable. Device identity and authorization are not paths.
```

The connection manager treats every address as a candidate route. It may use direct LAN, a public
tunnel, one or more relays, or a user-supplied recovery route. A preferred route is an optimization,
not a permanent primary.

## Separate identity, membership, authorization, and routing

### Identity

Each installation owns a long-lived signing key and derives its device ID from the public key.

- Android stores a non-exportable key in Android Keystore when supported.
- Desktop and server installations use an OS credential store where available, otherwise an
  owner-only file.
- Private keys never appear in QR codes, logs, route announcements, or relay payloads.
- App reinstall or unrecoverable key loss creates a new device identity.

An identity is stable only for the lifetime of that installation key. The design does not assume
that the physical device or key exists forever.

### Membership

Membership answers whether a device identity belongs to a mesh. It is represented by signed,
replicated events such as:

- `device_joined`
- `device_revoked`
- `device_key_rotated`
- `device_renamed`

Membership remains valid while a device is offline. Revocation is an explicit signed event, not a
timeout caused by loss of connectivity.

### Authorization

Each target owns and enforces the grants it gives to source devices. Grants are stored against the
source device ID. They are changed only by an explicit permission operation.

Pairing, reconnecting, route discovery, and route replacement must not write the permission store.
This prevents a harmless connectivity repair from clearing or expanding authority.

### Routing and presence

Routes are signed, sequenced, expiring records. A route record contains at least:

```ts
type RouteAnnouncement = {
  networkId: string;
  deviceId: string;
  sequence: number;
  candidates: Array<{
    kind: 'relay' | 'tunnel' | 'lan' | 'manual';
    endpoint: string;
    expiresAt: string;
    metadata?: Record<string, string>;
  }>;
  announcedAt: string;
  signature: string;
};
```

Route candidates have short, bounded lifetimes. Newer valid sequences replace older state. Expired
routes are unusable even when they remain in local history.

Presence is soft state derived from live authenticated sessions and recent heartbeats. It can report
online, sleeping, offline, partitioned, or unknown, but it has no effect on membership or grants.

## Discovery without a permanently stable endpoint

Every discovery mechanism is optional and replaceable. A device tries available mechanisms in
parallel or in a bounded sequence:

1. Existing authenticated connections to any mesh peer.
2. Cached, unexpired route candidates.
3. Multiple configured rendezvous or relay providers.
4. Local-network discovery followed by an identity challenge.
5. Signed route information received through platform notifications, where available.
6. A user-supplied URL, QR code, or short recovery code.

DNS names and stable tunnel domains are useful operational improvements, but they are not protocol
invariants. Relay descriptors should contain a service identity and multiple replaceable endpoint
candidates. Peers accept updated relay locations only from an authenticated source.

The system should normally maintain connections to more than one reachable route or relay when the
cost is acceptable. Connection attempts use bounded exponential backoff with jitter, and successful
authentication verifies that the endpoint serves the expected device or relay identity.

### Unavoidable partition case

No protocol can automatically reconnect two isolated devices when all of the following are true:

- neither device knows a currently reachable address for the other;
- they share no reachable relay or discovery service;
- local discovery cannot see the other device; and
- no external channel delivers new route information.

In that case Drone Hub must show a clear partitioned/offline state. A manual bootstrap can restore
reachability, but an already-enrolled device must still use authenticated rebind rather than new
pairing.

## Enrollment, reconnect, rebind, and recovery

These are separate protocol operations.

### New-device enrollment

Use this only when the presented public key is not a current, non-revoked member.

1. An existing administrator creates a short-lived, single-use invitation.
2. The new installation presents its public key and proposed name.
3. An administrator compares identities and approves or denies membership.
4. Approval creates a signed membership event.
5. Operational permissions remain deny-by-default and are granted separately.

### Normal reconnect

A known device opens any candidate transport and completes mutual challenge-response authentication.
No approval UI appears and no permission state changes.

### Authenticated rebind

Rebind handles a known device arriving through a new bootstrap route when all cached routes are dead.

1. The receiver returns a fresh nonce and its identity.
2. The joining side signs a transcript binding the nonce, network ID, both device IDs, protocol
   version, requested route, and expiration time.
3. The receiver verifies the signature against current, non-revoked membership.
4. Both sides exchange current signed membership and route records.
5. The new route is stored with an expiration and sequence number.
6. Existing grants and administrator status remain unchanged.

Copying a known device ID or public key is insufficient because the claimant must sign with the
corresponding private key.

### Lost identity or reinstall

If the device cannot prove possession of its enrolled key, it is a new identity. It must be enrolled
and approved again. The old identity should be revoked explicitly after the owner confirms the loss.

Key rotation can avoid re-enrollment when the old key is still available: the old and new keys sign a
rotation event. Without the old key, rotation requires administrator recovery approval.

## Relay behavior

Relays improve reachability but are not trusted authorities and are not assumed to be permanent.

- Devices initiate outbound authenticated connections to any reachable relay candidate.
- A mesh can advertise several relays and can add or retire them through signed records.
- Relays forward bounded opaque envelopes and presence hints.
- Relays cannot edit membership, routes, revocations, or destination-owned grants.
- Sensitive commands are not queued merely because a target is offline.
- Relay disappearance causes route failover or an offline state, never re-pairing.

Before carrying production prompts, files, credentials, or commands through a relay, messages must be
encrypted end to end for the destination with forward secrecy and replay protection. TLS protects a
connection to a relay but does not prevent that relay from reading plaintext. A reviewed Noise-based
session protocol remains a suitable direction.

## Route selection and failover

The connection manager should:

- race a small number of promising candidates instead of trusting one permanent primary;
- prefer already-authenticated live connections, then direct routes, then relayed routes according
  to measured health and policy;
- retain at least one alternative route when practical;
- verify peer identity after every transport connection;
- withdraw a local route before replacing a known-dead tunnel when possible;
- accept only newer, valid signed route sequences;
- expire stale candidates automatically;
- avoid unbounded multi-hop routing, loops, and broadcast floods.

A route URL is never sufficient evidence of peer identity. Connecting to the wrong identity at a
previously valid URL must fail closed.

## Local state and synchronization

Each device persists:

- its private identity key;
- network ID and signed membership history;
- known revocations;
- destination-owned permissions;
- recent signed route records and discovery descriptors;
- bounded audit history.

Peers exchange summaries and request missing signed records after authentication. Security-relevant
events are immutable. Route and presence projections can be rebuilt from the newest valid records.

Offline retention must be explicit and generous. Garbage collection may remove expired route and
presence data, but it must not interpret age as device revocation. Revocation tombstones must outlive
ordinary membership and route records so an old device cannot return after local compaction.

## Current implementation changes required

1. Add a signed known-device rebind flow; do not send known devices through the invitation approval
   path solely to refresh an endpoint.
2. Make pairing approval refuse to overwrite an existing device's grants implicitly. Permission
   changes must use the dedicated permission API.
3. Prefill any exceptional recovery UI from existing grants and label it as connectivity recovery,
   not new-device approval.
4. Replace the mobile profile's single endpoint per connection with a set of signed, expiring route
   candidates.
5. Add a rendezvous-provider abstraction with multiple simultaneous providers and no required
   provider.
6. Add local discovery and manual authenticated bootstrap as independent recovery mechanisms.
7. Synchronize signed route updates over every authenticated peer connection.
8. Add destination-level encryption before treating relays as safe for sensitive production data.
9. Keep ngrok or another tunnel provider as one route source, not as identity or membership state.

The managed-ngrok restart recovery is still useful, but it only restores one local route source. It
cannot by itself inform an isolated phone that the URL changed.

## Short-term recovery implementation

The first incremental recovery step keeps the existing QR transport while separating known-device
recovery from new enrollment:

- Current clients sign a canonical claim containing the invitation token, claim secret, inviter,
  endpoint, expiry, and public identity.
- A current, non-revoked member with a valid signature is recognized automatically. The QR supplies
  a fresh route, but the existing membership, administrator status, and grants are reused unchanged.
- An unknown signed identity remains pending until an administrator approves it.
- A revoked identity is rejected even when it still possesses its old private key.
- A forged claim that copies a known public identity cannot take the automatic path because it
  cannot produce the matching signature.
- Older clients without signed-claim support remain on the manual approval path during rollout.
  Even there, the backend preserves an existing device's authorization rather than accepting blank
  approval-form values.
- Mobile labels the known-mesh action **Update connection** and explains that it replaces an
  unreachable route without resetting trust.
- Before consuming a recovery invitation, an already-enrolled mobile or desktop client verifies
  that its inviter is a current, non-revoked member already present in its saved mesh membership. A
  code from an unknown mesh must not create a dangling approval on that other network.
- Managed ngrok state is recovered on Hub startup, stale URLs are withdrawn, replacement URLs are
  announced, and tunnel errors are shown in the desktop UI. A persisted process PID is checked
  against its command line before it is signalled so an OS-recycled PID cannot terminate an
  unrelated process.
- Expired invitations plus stale pending, approved, and rejected requests are pruned at startup and
  periodically while the Hub runs.

This step does not claim automatic recovery from a total partition. When no shared discovery path
exists, the user still obtains a fresh QR through any available channel. The improvement is that the
QR securely rebinds a known identity instead of enrolling it again.

## Acceptance scenarios

1. Desktop restarts and obtains a different tunnel URL while Phone is offline. Phone later learns the
   new signed route through any reachable peer or relay without pairing again.
2. Every previously known relay endpoint changes. A signed relay update learned through another
   discovery channel restores connectivity.
3. No automatic discovery channel remains. The user supplies a new bootstrap URL; the known phone
   proves its key and reconnects without an approval prompt or permission changes.
4. Phone remains offline for thirty days and reconnects with the same identity and grants.
5. Phone is revoked while offline. Its later reconnect and rebind attempts are denied.
6. An attacker copies Phone's device ID and public key but cannot answer the private-key challenge.
7. Reinstalling the phone app creates a new key and correctly requires new enrollment.
8. A relay is compromised. It cannot decrypt destination-encrypted operations or grant itself
   authority.
9. An old route announcement arrives after a newer route. The old sequence is ignored.
10. Every candidate route fails. The UI reports offline or partitioned and does not start pairing
    automatically.
11. A known device reconnects through a new URL. Its grants and administrator status remain exactly
    unchanged.
12. A URL is reassigned to another service or device. Identity authentication fails before mesh data
    or operations are exchanged.

## Practical rollout

### Stage 1: Correctness

- Preserve existing permissions during all connectivity recovery.
- Add signed rebind and identity challenge endpoints.
- Distinguish enrollment, reconnect, and partitioned states in the UI.
- Keep multiple route candidates with expiration and sequence validation.

### Stage 2: Reachability

- Add one relay implementation, but design the client for a list of relay descriptors.
- Add LAN discovery and manual authenticated bootstrap.
- Propagate signed route changes across every live peer connection.
- Test relay loss, rotating URLs, device sleep, and prolonged partitions.

### Stage 3: Production security and resilience

- Add destination-level encrypted sessions with forward secrecy.
- Run multiple independent relay instances or providers.
- Add signed relay replacement and key-rotation flows.
- Complete Android Keystore and desktop key-storage validation.
- Perform protocol, abuse-resistance, and recovery reviews.

## External references

- Android Keystore: <https://developer.android.com/privacy-and-security/keystore>
- Noise Protocol Framework: <https://noiseprotocol.org/>
- ngrok reserved domains: <https://ngrok.com/docs/api-reference/reserveddomains/create>
- Cloudflare Tunnel architecture: <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/>

Static domains and named tunnels are useful route sources, but this design remains correct when they
are unavailable or replaced.
