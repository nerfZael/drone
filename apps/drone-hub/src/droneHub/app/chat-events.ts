import type { DroneChatDeltaEvent } from './chat-api';
import { subscribeDesktopEvents } from './desktop-events';

type DroneChatEventsSubscriber = (data: DroneChatDeltaEvent) => void;
type ConnectionSubscriber = (connected: boolean) => void;

const deltaSubscribers = new Set<DroneChatEventsSubscriber>();
const connectionSubscribers = new Set<ConnectionSubscriber>();

let unsubscribeSource: (() => void) | null = null;
let connected = false;

function notifyConnected(next: boolean): void {
  if (connected === next) return;
  connected = next;
  for (const subscriber of Array.from(connectionSubscribers)) subscriber(next);
}

function closeSourceIfIdle(): void {
  if (deltaSubscribers.size > 0 || connectionSubscribers.size > 0) return;
  unsubscribeSource?.();
  unsubscribeSource = null;
  connected = false;
}

function ensureSource(): void {
  if (unsubscribeSource) return;
  if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
    notifyConnected(false);
    return;
  }

  const notifyChatEvent = (event: Event) => {
    let data: DroneChatDeltaEvent;
    try {
      data = JSON.parse((event as MessageEvent).data || '{}') as DroneChatDeltaEvent;
    } catch {
      return;
    }
    for (const subscriber of Array.from(deltaSubscribers)) subscriber(data);
  };
  unsubscribeSource = subscribeDesktopEvents({
    handlers: {
      chat_delta: notifyChatEvent,
      // A new Hub process has no prior broadcaster baseline, so reconnecting
      // clients receive a full snapshot rather than a delta.
      chat_snapshot: notifyChatEvent,
      chat_stream_error: () => notifyConnected(false),
    },
    onConnectedChange: notifyConnected,
  });
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
