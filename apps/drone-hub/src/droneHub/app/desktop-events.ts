type DesktopEventHandler = (event: MessageEvent) => void;
type ConnectionHandler = (connected: boolean) => void;

const EVENT_NAMES = [
  'assistant_change',
  'registry_snapshot',
  'registry_delta',
  'registry_stream_error',
  'chat_snapshot',
  'chat_delta',
  'chat_stream_error',
] as const;

export type DesktopEventName = (typeof EVENT_NAMES)[number];

const handlers = new Map<DesktopEventName, Set<DesktopEventHandler>>();
const connectionHandlers = new Set<ConnectionHandler>();
let source: EventSource | null = null;
let connected = false;

function notifyConnected(next: boolean, force = false): void {
  if (!force && connected === next) return;
  connected = next;
  for (const handler of Array.from(connectionHandlers)) {
    try {
      handler(next);
    } catch {
      // A broken consumer must not interrupt the shared transport.
    }
  }
}

function subscriberCount(): number {
  let count = connectionHandlers.size;
  for (const subscribers of handlers.values()) count += subscribers.size;
  return count;
}

function closeIfIdle(): void {
  if (subscriberCount() > 0) return;
  source?.close();
  source = null;
  connected = false;
}

function ensureSource(): void {
  if (source) return;
  if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
    notifyConnected(false, true);
    return;
  }
  source = new window.EventSource('/api/desktop/events');
  source.addEventListener('connected', () => notifyConnected(true));
  for (const eventName of EVENT_NAMES) {
    source.addEventListener(eventName, (event) => {
      for (const handler of Array.from(handlers.get(eventName) ?? [])) {
        try {
          handler(event as MessageEvent);
        } catch {
          // Keep other consumers alive when one event handler fails.
        }
      }
    });
  }
  source.onerror = () => notifyConnected(false, true);
}

export function subscribeDesktopEvents(input: {
  handlers: Partial<Record<DesktopEventName, DesktopEventHandler>>;
  onConnectedChange?: ConnectionHandler;
}): () => void {
  for (const [eventName, handler] of Object.entries(input.handlers) as Array<
    [DesktopEventName, DesktopEventHandler]
  >) {
    let subscribers = handlers.get(eventName);
    if (!subscribers) {
      subscribers = new Set();
      handlers.set(eventName, subscribers);
    }
    subscribers.add(handler);
  }
  if (input.onConnectedChange) {
    connectionHandlers.add(input.onConnectedChange);
    if (connected) input.onConnectedChange(true);
  }
  ensureSource();

  return () => {
    for (const [eventName, handler] of Object.entries(input.handlers) as Array<
      [DesktopEventName, DesktopEventHandler]
    >) {
      const subscribers = handlers.get(eventName);
      subscribers?.delete(handler);
      if (subscribers?.size === 0) handlers.delete(eventName);
    }
    if (input.onConnectedChange) connectionHandlers.delete(input.onConnectedChange);
    closeIfIdle();
  };
}
