import * as React from 'react';
import type {
  BlipHistoryEntry,
  BlipHistoryMessage,
  BlipHistoryPage,
  BlipPromptStreamEvent,
  BlipRuntimeEvent,
  BlipThreadStreamEvent,
} from '@blip/protocol';

async function requestHistory(threadId: string, input?: { before?: number; limit?: number }): Promise<BlipHistoryPage> {
  const query = new URLSearchParams();
  if (input?.before) query.set('before', String(input.before));
  if (input?.limit) query.set('limit', String(input.limit));
  const response = await fetch(`/api/assistant/threads/${encodeURIComponent(threadId)}/history${query.size ? `?${query}` : ''}`);
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!response.ok) throw new Error(String(body?.error ?? text ?? `History request failed: ${response.status}`));
  return body as BlipHistoryPage;
}

function mergeEntries(current: BlipHistoryEntry[], incoming: BlipHistoryEntry[]): BlipHistoryEntry[] {
  const bySequence = new Map(current.map((entry) => [entry.sequence, entry]));
  for (const entry of incoming) bySequence.set(entry.sequence, entry);
  return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
}

export function useBlipThreadSession(threadId: string, enabled: boolean) {
  const [entries, setEntries] = React.useState<BlipHistoryEntry[]>([]);
  const [beforeCursor, setBeforeCursor] = React.useState<number | null>(null);
  const [hasOlder, setHasOlder] = React.useState(false);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [olderLoading, setOlderLoading] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [streamingText, setStreamingText] = React.useState('');
  const [runError, setRunError] = React.useState<string | null>(null);
  const [historyError, setHistoryError] = React.useState<string | null>(null);
  const threadIdRef = React.useRef(threadId);
  const seenEventKeysRef = React.useRef<string[]>([]);
  const latestHistoryRequestRef = React.useRef(0);
  threadIdRef.current = threadId;

  const refreshHistory = React.useCallback(async (options?: { quiet?: boolean }) => {
    if (!enabled || !threadId) return;
    const requestId = ++latestHistoryRequestRef.current;
    if (!options?.quiet) setHistoryLoading(true);
    try {
      const page = await requestHistory(threadId, { limit: 80 });
      if (threadIdRef.current !== threadId) return;
      setEntries((current) => mergeEntries(current, page.entries));
      if (requestId === latestHistoryRequestRef.current) {
        setBeforeCursor(page.page.beforeCursor);
        setHasOlder(page.page.hasOlder);
      }
      setHistoryError(null);
    } catch (error) {
      if (threadIdRef.current === threadId) setHistoryError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!options?.quiet && threadIdRef.current === threadId) setHistoryLoading(false);
    }
  }, [enabled, threadId]);

  React.useEffect(() => {
    setEntries([]);
    setBeforeCursor(null);
    setHasOlder(false);
    setRunning(false);
    setStreamingText('');
    setRunError(null);
    setHistoryError(null);
    seenEventKeysRef.current = [];
    latestHistoryRequestRef.current += 1;
    if (enabled && threadId) void refreshHistory();
  }, [enabled, refreshHistory, threadId]);

  const loadOlder = React.useCallback(async () => {
    if (!enabled || !threadId || !hasOlder || !beforeCursor || olderLoading) return;
    setOlderLoading(true);
    try {
      const page = await requestHistory(threadId, { before: beforeCursor, limit: 80 });
      if (threadIdRef.current !== threadId) return;
      setEntries((current) => mergeEntries(current, page.entries));
      setBeforeCursor(page.page.beforeCursor);
      setHasOlder(page.page.hasOlder);
      setHistoryError(null);
    } catch (error) {
      if (threadIdRef.current === threadId) setHistoryError(error instanceof Error ? error.message : String(error));
    } finally {
      if (threadIdRef.current === threadId) setOlderLoading(false);
    }
  }, [beforeCursor, enabled, hasOlder, olderLoading, threadId]);

  const handleRuntimeEvent = React.useCallback((event: BlipRuntimeEvent) => {
    if (event.type === 'session_started' || event.type === 'turn_started') {
      setRunning(true);
      setRunError(null);
      if (event.type === 'turn_started') setStreamingText('');
      void refreshHistory({ quiet: true });
      return;
    }
    if (event.type === 'assistant_delta') {
      setRunning(true);
      setStreamingText((current) => `${current}${event.text}`);
      return;
    }
    if (event.type === 'session_error') {
      setRunError(event.error);
      return;
    }
    if (event.type === 'transcript_changed') {
      void refreshHistory({ quiet: true });
      return;
    }
    if (event.type === 'assistant_message' || event.type === 'tool_call_started' || event.type === 'tool_call_completed' || event.type === 'tool_call_failed') {
      setRunning(true);
      void refreshHistory({ quiet: true });
      return;
    }
    if (event.type === 'session_finished') {
      setRunning(false);
      setStreamingText('');
      if (event.status === 'error') setRunError(event.error ?? 'Assistant failed.');
      void refreshHistory({ quiet: true });
    }
  }, [refreshHistory]);

  const handleStreamEvent = React.useCallback((envelope: BlipPromptStreamEvent | BlipThreadStreamEvent | any) => {
    if (envelope?.type === 'connected' && envelope.version === 1 && envelope.threadId === threadId) {
      const nextRunning = envelope.running === true;
      setRunning(nextRunning);
      if (!nextRunning) setStreamingText('');
      void refreshHistory({ quiet: true });
      return;
    }
    if (envelope?.type !== 'blip_event' || envelope.version !== 1 || envelope.threadId !== threadId) return;
    const eventKey = String(envelope.event?.eventId ?? '') || JSON.stringify(envelope.event);
    if (seenEventKeysRef.current.includes(eventKey)) return;
    seenEventKeysRef.current = [...seenEventKeysRef.current.slice(-399), eventKey];
    handleRuntimeEvent(envelope.event);
  }, [handleRuntimeEvent, refreshHistory, threadId]);

  React.useEffect(() => {
    if (!enabled || !threadId || typeof window === 'undefined' || typeof window.EventSource === 'undefined') return;
    const source = new EventSource(`/api/assistant/threads/${encodeURIComponent(threadId)}/events`);
    const onEvent = (raw: MessageEvent<string>) => {
      try { handleStreamEvent(JSON.parse(raw.data)); } catch { /* Ignore malformed events and let EventSource continue. */ }
    };
    source.addEventListener('connected', onEvent as EventListener);
    source.addEventListener('blip_event', onEvent as EventListener);
    return () => source.close();
  }, [enabled, handleStreamEvent, threadId]);

  const streamingMessage = React.useMemo<BlipHistoryMessage | null>(() => streamingText
    ? { role: 'assistant', content: [{ type: 'text', text: streamingText }], timestamp: Date.now() }
    : null, [streamingText]);
  const messages = React.useMemo(() => entries.map((entry) => entry.message), [entries]);

  return {
    messages,
    streamingMessage,
    running,
    runError,
    historyError,
    historyLoading,
    olderLoading,
    hasOlder,
    loadOlder,
    refreshHistory,
    handleStreamEvent,
  };
}
