import * as React from 'react';
import { mergeWorkspaceTransferProgress } from '@drone/assistant-chat';
import type {
  BlipContextUsage,
  BlipHistoryEntry,
  BlipHistoryMessage,
  BlipHistoryPage,
  BlipPromptStreamEvent,
  BlipRuntimeEvent,
  BlipThreadStreamEvent,
} from '@blip/protocol';
import { assistantTranscriptHasErrorMessage } from './assistant-message-model';

const ASSISTANT_HISTORY_PAGE_SIZE = 200;

async function requestHistory(
  threadId: string,
  input?: { before?: number; limit?: number },
): Promise<BlipHistoryPage> {
  const query = new URLSearchParams();
  if (input?.before) query.set('before', String(input.before));
  if (input?.limit) query.set('limit', String(input.limit));
  const response = await fetch(
    `/api/assistant/threads/${encodeURIComponent(threadId)}/history${query.size ? `?${query}` : ''}`,
  );
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok)
    throw new Error(String(body?.error ?? text ?? `History request failed: ${response.status}`));
  return body as BlipHistoryPage;
}

function mergeEntries(
  current: BlipHistoryEntry[],
  incoming: BlipHistoryEntry[],
): BlipHistoryEntry[] {
  const bySequence = new Map(current.map((entry) => [entry.sequence, entry]));
  for (const entry of incoming) bySequence.set(entry.sequence, entry);
  return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
}

function messageFromHistoryEntry(
  entry: BlipHistoryEntry,
): BlipHistoryMessage & { id: string; createdAt: string } {
  return {
    ...entry.message,
    id: entry.id,
    createdAt: entry.timestamp,
  };
}

type BlipThreadSessionOptions = {
  threadId: string;
  enabled: boolean;
  onNativeChange?: () => void;
  initialHistory?: BlipHistoryPage | null;
};

export function useBlipThreadSession({
  threadId,
  enabled,
  onNativeChange,
  initialHistory,
}: BlipThreadSessionOptions) {
  const [entries, setEntries] = React.useState<BlipHistoryEntry[]>([]);
  const [entriesThreadId, setEntriesThreadId] = React.useState('');
  const [beforeCursor, setBeforeCursor] = React.useState<number | null>(null);
  const [hasOlder, setHasOlder] = React.useState(false);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [olderLoading, setOlderLoading] = React.useState(false);
  const [runtimeThreadId, setRuntimeThreadId] = React.useState('');
  const [running, setRunning] = React.useState(false);
  const [compactionInProgress, setCompactionInProgress] = React.useState(false);
  const [toolProgress, setToolProgress] = React.useState<Record<string, BlipHistoryMessage>>({});
  const [runError, setRunError] = React.useState<string | null>(null);
  const [historyError, setHistoryError] = React.useState<string | null>(null);
  const [contextUsage, setContextUsage] = React.useState<BlipContextUsage | null>(
    initialHistory?.contextUsage ?? null,
  );
  const threadIdRef = React.useRef(threadId);
  const runEpochRef = React.useRef(0);
  const seenEventKeysRef = React.useRef<string[]>([]);
  const latestHistoryRequestRef = React.useRef(0);
  const onNativeChangeRef = React.useRef(onNativeChange);
  threadIdRef.current = threadId;
  onNativeChangeRef.current = onNativeChange;
  const bootstrapHistory = initialHistory?.threadId === threadId ? initialHistory : null;

  const refreshHistory = React.useCallback(
    async (options?: { quiet?: boolean; preserveContextUsage?: boolean }) => {
      if (!enabled || !threadId) return;
      const requestId = ++latestHistoryRequestRef.current;
      if (!options?.quiet) setHistoryLoading(true);
      try {
        const page = await requestHistory(threadId, { limit: ASSISTANT_HISTORY_PAGE_SIZE });
        if (threadIdRef.current !== threadId) return;
        setEntries((current) => mergeEntries(current, page.entries));
        setRunError((current) =>
          assistantTranscriptHasErrorMessage(
            page.entries.map((entry) => entry.message),
            current,
          )
            ? null
            : current,
        );
        if (!options?.preserveContextUsage) setContextUsage(page.contextUsage ?? null);
        setEntriesThreadId(threadId);
        const persistedToolCalls = new Set(
          page.entries.flatMap((entry) => {
            const message = entry.message as any;
            return message?.role === 'toolResult' && message.toolCallId
              ? [String(message.toolCallId)]
              : [];
          }),
        );
        if (persistedToolCalls.size > 0)
          setToolProgress((current) => {
            const next = { ...current };
            let changed = false;
            for (const callId of persistedToolCalls) {
              if (!(callId in next)) continue;
              delete next[callId];
              changed = true;
            }
            return changed ? next : current;
          });
        if (requestId === latestHistoryRequestRef.current) {
          setBeforeCursor(page.page.beforeCursor);
          setHasOlder(page.page.hasOlder);
        }
        setHistoryError(null);
      } catch (error) {
        if (threadIdRef.current === threadId)
          setHistoryError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!options?.quiet && threadIdRef.current === threadId) setHistoryLoading(false);
      }
    },
    [enabled, threadId],
  );

  React.useEffect(() => {
    setEntries(bootstrapHistory?.entries ?? []);
    setEntriesThreadId(threadId);
    setBeforeCursor(bootstrapHistory?.page.beforeCursor ?? null);
    setHasOlder(bootstrapHistory?.page.hasOlder ?? false);
    setHistoryLoading(false);
    setOlderLoading(false);
    setContextUsage(bootstrapHistory?.contextUsage ?? null);
    setRuntimeThreadId(threadId);
    setRunning(false);
    setCompactionInProgress(false);
    setToolProgress({});
    setRunError(null);
    setHistoryError(null);
    runEpochRef.current += 1;
    seenEventKeysRef.current = [];
    latestHistoryRequestRef.current += 1;
    if (enabled && threadId && !bootstrapHistory) void refreshHistory();
  }, [bootstrapHistory, enabled, refreshHistory, threadId]);

  const activeBeforeCursor =
    entriesThreadId === threadId
      ? beforeCursor
      : (bootstrapHistory?.page.beforeCursor ?? null);
  const activeHasOlder =
    entriesThreadId === threadId
      ? hasOlder
      : (bootstrapHistory?.page.hasOlder ?? false);

  const loadOlder = React.useCallback(async () => {
    if (!enabled || !threadId || !activeHasOlder || !activeBeforeCursor || olderLoading) return;
    setOlderLoading(true);
    try {
      const page = await requestHistory(threadId, {
        before: activeBeforeCursor,
        limit: ASSISTANT_HISTORY_PAGE_SIZE,
      });
      if (threadIdRef.current !== threadId) return;
      setEntries((current) => mergeEntries(current, page.entries));
      setEntriesThreadId(threadId);
      setBeforeCursor(page.page.beforeCursor);
      setHasOlder(page.page.hasOlder);
      setHistoryError(null);
    } catch (error) {
      if (threadIdRef.current === threadId)
        setHistoryError(error instanceof Error ? error.message : String(error));
    } finally {
      if (threadIdRef.current === threadId) setOlderLoading(false);
    }
  }, [activeBeforeCursor, activeHasOlder, enabled, olderLoading, threadId]);

  const handleRuntimeEvent = React.useCallback(
    (event: BlipRuntimeEvent) => {
      if (event.type === 'session_started' || event.type === 'turn_started') {
        runEpochRef.current += 1;
        setRunning(true);
        setCompactionInProgress(false);
        setRunError(null);
        void refreshHistory({ quiet: true });
        return;
      }
      if (event.type === 'assistant_delta') {
        // Native chats render only durable assistant messages. Per-token updates are intentionally
        // ignored so partial text never competes with canonical history.
        return;
      }
      if (event.type === 'session_error') {
        setCompactionInProgress(false);
        setRunError(event.error);
        return;
      }
      if (event.type === 'compaction_started') {
        setCompactionInProgress(true);
        return;
      }
      if (event.type === 'compaction_skipped') {
        setCompactionInProgress(false);
        return;
      }
      if (event.type === 'transcript_changed') {
        void refreshHistory({ quiet: true });
        return;
      }
      if (event.type === 'compaction_completed') {
        setCompactionInProgress(false);
        setContextUsage((current) =>
          current
            ? {
                ...current,
                tokens: event.tokensAfter,
                percent: (event.tokensAfter / current.contextWindow) * 100,
                confidence: 'heuristic',
                breakdown: undefined,
              }
            : current,
        );
        void refreshHistory({ quiet: true, preserveContextUsage: true });
        return;
      }
      if (
        event.type === 'assistant_message' ||
        event.type === 'tool_call_started' ||
        event.type === 'tool_call_completed' ||
        event.type === 'tool_call_failed'
      ) {
        setRunning(true);
        void refreshHistory({ quiet: true });
        return;
      }
      if (event.type === 'tool_call_progress') {
        setRunning(true);
        setToolProgress((current) => {
          const previous = current[event.callId];
          return {
            ...current,
            [event.callId]: {
              role: 'toolResult',
              toolCallId: event.callId,
              toolName: event.tool,
              content: event.message,
              details: mergeWorkspaceTransferProgress(previous?.details, event.details),
              timestamp: Date.now(),
            },
          };
        });
        return;
      }
      if (event.type === 'session_finished') {
        setCompactionInProgress(false);
        if (event.contextUsage) setContextUsage(event.contextUsage);
        const finishedRunEpoch = runEpochRef.current;
        if (event.status === 'error') setRunError(event.error ?? 'Assistant failed.');
        // The final message is persisted before this event, but the UI history request is async.
        // Keep the run visibly active until that refresh lands so the tool row cannot briefly turn
        // idle (or disappear) before the final assistant response is available.
        void refreshHistory({ quiet: true }).finally(() => {
          if (
            threadIdRef.current === threadId &&
            runEpochRef.current === finishedRunEpoch
          ) {
            setRunning(false);
          }
        });
      }
    },
    [refreshHistory],
  );

  const handleStreamEvent = React.useCallback(
    (envelope: BlipPromptStreamEvent | BlipThreadStreamEvent | any) => {
      if (
        envelope?.type === 'connected' &&
        envelope.version === 1 &&
        envelope.threadId === threadId
      ) {
        const nextRunning = envelope.running === true;
        if (nextRunning) runEpochRef.current += 1;
        setRuntimeThreadId(threadId);
        setRunning(nextRunning);
        setCompactionInProgress(false);
        void refreshHistory({ quiet: true });
        return;
      }
      if (
        envelope?.type !== 'blip_event' ||
        envelope.version !== 1 ||
        envelope.threadId !== threadId
      )
        return;
      const eventKey = String(envelope.event?.eventId ?? '') || JSON.stringify(envelope.event);
      if (seenEventKeysRef.current.includes(eventKey)) return;
      seenEventKeysRef.current = [...seenEventKeysRef.current.slice(-399), eventKey];
      handleRuntimeEvent(envelope.event);
    },
    [handleRuntimeEvent, refreshHistory, threadId],
  );

  React.useEffect(() => {
    if (
      !enabled ||
      !threadId ||
      typeof window === 'undefined' ||
      typeof window.EventSource === 'undefined'
    )
      return;
    const source = new EventSource(`/api/assistant/threads/${encodeURIComponent(threadId)}/events`);
    const onEvent = (raw: MessageEvent<string>) => {
      try {
        handleStreamEvent(JSON.parse(raw.data));
      } catch {
        /* Ignore malformed events and let EventSource continue. */
      }
    };
    source.addEventListener('connected', onEvent as EventListener);
    source.addEventListener('blip_event', onEvent as EventListener);
    source.addEventListener('native_change', () => onNativeChangeRef.current?.());
    return () => source.close();
  }, [enabled, handleStreamEvent, threadId]);

  const visibleEntries = React.useMemo(
    () =>
      entriesThreadId === threadId
        ? entries
        : (bootstrapHistory?.entries ?? []),
    [bootstrapHistory?.entries, entries, entriesThreadId, threadId],
  );
  const messages = React.useMemo(
    () => [
      ...visibleEntries.map(messageFromHistoryEntry),
      ...(runtimeThreadId === threadId ? Object.values(toolProgress) : []),
    ],
    [runtimeThreadId, threadId, toolProgress, visibleEntries],
  );
  const historyReady =
    !enabled || !threadId || entriesThreadId === threadId || Boolean(bootstrapHistory);
  const activeContextUsage =
    entriesThreadId === threadId ? contextUsage : (bootstrapHistory?.contextUsage ?? null);

  return {
    messages,
    contextUsage: activeContextUsage,
    compactionInProgress: runtimeThreadId === threadId && compactionInProgress,
    running: runtimeThreadId === threadId && running,
    runError: runtimeThreadId === threadId ? runError : null,
    historyError: entriesThreadId === threadId ? historyError : null,
    historyLoading: historyLoading || !historyReady,
    olderLoading: entriesThreadId === threadId && olderLoading,
    hasOlder: activeHasOlder,
    loadOlder,
    refreshHistory,
    handleStreamEvent,
  };
}
