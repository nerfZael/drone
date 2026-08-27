import type { DroneChatDeltaEvent } from './chat-api';

type DroneChatEventsSubscriber = (data: DroneChatDeltaEvent) => void;
type ConnectionSubscriber = (connected: boolean) => void;

const deltaSubscribers = new Set<DroneChatEventsSubscriber>();
const connectionSubscribers = new Set<ConnectionSubscriber>();

let source: EventSource | null = null;
let connected = false;

function notifyConnected(next: boolean): void {
  if (connected === next) return;
  connected = next;
  for (const subscriber of Array.from(connectionSubscribers)) subscriber(next);
}

function closeSourceIfIdle(): void {
  if (deltaSubscribers.size > 0 || connectionSubscribers.size > 0) return;
  source?.close();
  source = null;
  connected = false;
}

function ensureSource(): void {
  if (source) return;
  if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
    notifyConnected(false);
    return;
  }

  source = new window.EventSource('/api/drones/chat-events');
  source.addEventListener('connected', () => notifyConnected(true));
  const notifyChatEvent = (event: Event) => {
    let data: DroneChatDeltaEvent;
    try {
      data = JSON.parse((event as MessageEvent).data || '{}') as DroneChatDeltaEvent;
    } catch {
      return;
    }
    for (const subscriber of Array.from(deltaSubscribers)) subscriber(data);
  };
  source.addEventListener('chat_delta', notifyChatEvent);
  // A new Hub process has no prior broadcaster baseline, so reconnecting
  // clients receive a full snapshot rather than a delta. Treat its chat refs
  // as invalidations too, otherwise optimistic pending state can remain stale
  // until the 60-second fallback poll.
  source.addEventListener('snapshot', notifyChatEvent);
  source.addEventListener('stream-error', () => notifyConnected(false));
  source.onerror = () => notifyConnected(false);
}

export function subscribeDroneChatEvents(opts: {
  onDelta: DroneChatEventsSubscriber;
  onConnectedChange?: ConnectionSubscriber;
}): () => void {
  deltaSubscribers.add(opts.onDelta);
  if (opts.onConnectedChange) {
    connectionSubscribers.add(opts.onConnectedChange);
    opts.onConnectedChange(connected);
  }
  ensureSource();

  return () => {
    deltaSubscribers.delete(opts.onDelta);
    if (opts.onConnectedChange) connectionSubscribers.delete(opts.onConnectedChange);
    closeSourceIfIdle();
  };
}
