import {
  capabilityEventPolicy,
  MESH_SAFE_MESSAGE_BYTES,
  type CapabilityEvent,
  type MeshDevice,
} from '@drone/device-protocol';

export type CapabilityEventDecision = 'accept' | 'drop' | 'disconnect';

type GuardOptions = {
  now?: () => number;
  maxDirectEventsPerMinute?: number;
  maxRelayEventsPerMinute?: number;
  maxSourceEventsPerMinute?: number;
  maxReplayEntries?: number;
};

const RATE_WINDOW_MS = 60_000;
const DEFAULT_MAX_SOURCE_EVENTS_PER_MINUTE = 600;
const DEFAULT_MAX_RELAY_EVENTS_PER_MINUTE = 2_400;
const DEFAULT_MAX_REPLAY_ENTRIES = 4_096;

export class MobileCapabilityEventGuard {
  private readonly peerTimes = new Map<string, number[]>();
  private readonly sourceTimes = new Map<string, number[]>();
  private readonly typeTimes = new Map<string, number[]>();
  private readonly seen = new Map<string, number>();
  private readonly now: () => number;
  private readonly maxDirectEventsPerMinute: number;
  private readonly maxRelayEventsPerMinute: number;
  private readonly maxSourceEventsPerMinute: number;
  private readonly maxReplayEntries: number;

  constructor(options: GuardOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxDirectEventsPerMinute =
      options.maxDirectEventsPerMinute ?? DEFAULT_MAX_SOURCE_EVENTS_PER_MINUTE;
    this.maxRelayEventsPerMinute =
      options.maxRelayEventsPerMinute ?? DEFAULT_MAX_RELAY_EVENTS_PER_MINUTE;
    this.maxSourceEventsPerMinute =
      options.maxSourceEventsPerMinute ?? DEFAULT_MAX_SOURCE_EVENTS_PER_MINUTE;
    this.maxReplayEntries = options.maxReplayEntries ?? DEFAULT_MAX_REPLAY_ENTRIES;
  }

  inspectEnvelope(immediatePeerId: string, value: unknown): CapabilityEventDecision {
    const sourceDeviceId =
      value && typeof value === 'object' && !Array.isArray(value)
        ? String((value as Record<string, unknown>).sourceDeviceId ?? '')
        : '';
    const direct = sourceDeviceId === immediatePeerId;
    const limit = direct ? this.maxDirectEventsPerMinute : this.maxRelayEventsPerMinute;
    if (!recordWithinLimit(this.peerTimes, immediatePeerId, limit, this.now())) {
      // A direct peer owns its traffic. A relay can carry many independent signed sources, so
      // overload from one source must not tear down every other source routed through it.
      return direct ? 'disconnect' : 'drop';
    }
    return 'accept';
  }

  acceptValidated(immediatePeerId: string, event: CapabilityEvent): CapabilityEventDecision {
    const now = this.now();
    this.pruneSeen(now);
    const replayKey = `${event.sourceDeviceId}:${event.eventId}`;
    if ((this.seen.get(replayKey) ?? 0) > now) return 'drop';

    if (
      !recordWithinLimit(
        this.sourceTimes,
        event.sourceDeviceId,
        this.maxSourceEventsPerMinute,
        now,
      )
    ) {
      return event.sourceDeviceId === immediatePeerId ? 'disconnect' : 'drop';
    }
    const policy = capabilityEventPolicy(event.capability, event.event);
    if (!policy) return 'drop';
    const typeKey = `${event.sourceDeviceId}\0${event.capability}\0${event.event}`;
    if (!recordWithinLimit(this.typeTimes, typeKey, policy.maxEventsPerMinute, now)) return 'drop';

    this.seen.set(replayKey, Date.parse(event.expiresAt));
    while (this.seen.size > this.maxReplayEntries) {
      const oldest = this.seen.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.seen.delete(oldest);
    }
    return 'accept';
  }

  clear(): void {
    this.peerTimes.clear();
    this.sourceTimes.clear();
    this.typeTimes.clear();
    this.seen.clear();
  }

  private pruneSeen(now: number): void {
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= now) this.seen.delete(key);
    }
  }
}

export function meshSocketFrameIsTooLarge(raw: string): boolean {
  const bytes =
    typeof TextEncoder === 'undefined'
      ? raw.length * 3
      : new TextEncoder().encode(raw).byteLength;
  return bytes > MESH_SAFE_MESSAGE_BYTES;
}

export function activeDevicePublicKey(
  devices: readonly MeshDevice[] | undefined,
  deviceId: string,
): JsonWebKey | undefined {
  const device = devices?.find((candidate) => candidate.id === deviceId);
  return device && !device.revokedAt ? device.publicKey : undefined;
}

function recordWithinLimit(
  entries: Map<string, number[]>,
  key: string,
  limit: number,
  now: number,
): boolean {
  const recent = (entries.get(key) ?? []).filter((time) => time > now - RATE_WINDOW_MS);
  if (recent.length >= limit) {
    entries.set(key, recent);
    return false;
  }
  recent.push(now);
  entries.set(key, recent);
  return true;
}
