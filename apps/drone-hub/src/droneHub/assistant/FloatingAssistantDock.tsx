import React from 'react';
import { requestJson } from '../http';
import { DesktopVoiceFloatingIndicator } from './DesktopVoiceFloatingIndicator';
import {
  summarizeAssistantActivity,
  type AssistantActivityCounts,
  type AssistantActivitySnapshot,
} from './assistant-activity';

const FLOATING_ASSISTANT_OPEN_STORAGE_KEY = 'droneHub.assistant.floatingOpen';
const FLOATING_ASSISTANT_ACTIVITY_ENABLED_STORAGE_KEY = 'droneHub.assistant.floatingActivityEnabled';
const ASSISTANT_ACTIVITY_IDLE_REFRESH_INTERVAL_MS = 15_000;
const ASSISTANT_ACTIVITY_ACTIVE_REFRESH_INTERVAL_MS = 1_000;
const ASSISTANT_ACTIVITY_HIDDEN_ACTIVE_REFRESH_INTERVAL_MS = 30_000;
const ASSISTANT_ACTIVITY_EVENT_REFRESH_DEBOUNCE_MS = 150;

const LazyAssistantDock = React.lazy(async () => ({
  default: (await import('./AssistantDock')).AssistantDock,
}));

function readInitialOpen(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(FLOATING_ASSISTANT_OPEN_STORAGE_KEY) === '1';
}

function readInitialActivityEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.localStorage.getItem(FLOATING_ASSISTANT_ACTIVITY_ENABLED_STORAGE_KEY) === '1' ||
    window.localStorage.getItem(FLOATING_ASSISTANT_OPEN_STORAGE_KEY) === '1'
  );
}

function isDocumentHidden(): boolean {
  if (typeof document === 'undefined') return false;
  return document.visibilityState === 'hidden';
}

export function minimizedAssistantActivityPollingIntervalMs({
  activeCount,
  documentHidden,
  eventsConnected,
}: {
  activeCount: number;
  documentHidden: boolean;
  eventsConnected: boolean;
}): number | null {
  if (eventsConnected) return null;
  if (documentHidden) return activeCount > 0 ? ASSISTANT_ACTIVITY_HIDDEN_ACTIVE_REFRESH_INTERVAL_MS : null;
  return activeCount > 0 ? ASSISTANT_ACTIVITY_ACTIVE_REFRESH_INTERVAL_MS : ASSISTANT_ACTIVITY_IDLE_REFRESH_INTERVAL_MS;
}

export function shouldConnectMinimizedAssistantEvents({
  activeCount,
  activityEnabled,
  documentHidden,
  enabled,
  eventSourceAvailable,
}: {
  activeCount: number;
  activityEnabled: boolean;
  documentHidden: boolean;
  enabled: boolean;
  eventSourceAvailable: boolean;
}): boolean {
  return enabled && eventSourceAvailable && !documentHidden && (activityEnabled || activeCount > 0);
}

function useMinimizedAssistantActivity(enabled: boolean, activityEnabled: boolean): AssistantActivityCounts {
  const [counts, setCounts] = React.useState<AssistantActivityCounts>({ normal: 0, voice: 0, total: 0 });
  const [eventsConnected, setEventsConnected] = React.useState(false);
  const [documentHidden, setDocumentHidden] = React.useState(isDocumentHidden);
  const enabledRef = React.useRef(enabled);
  const countsRef = React.useRef(counts);
  const documentHiddenRef = React.useRef(documentHidden);
  const refreshTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  React.useEffect(() => {
    countsRef.current = counts;
  }, [counts]);

  React.useEffect(() => {
    documentHiddenRef.current = documentHidden;
  }, [documentHidden]);

  const refresh = React.useCallback(async () => {
    if (!enabledRef.current) return;
    if (documentHiddenRef.current && countsRef.current.total <= 0) return;
    try {
      const snapshot = await requestJson<AssistantActivitySnapshot>('/api/assistant/threads');
      if (!enabledRef.current) return;
      setCounts(summarizeAssistantActivity(snapshot));
    } catch {
      if (!enabledRef.current) return;
      setCounts({ normal: 0, voice: 0, total: 0 });
    }
  }, []);

  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleVisibilityChange = () => setDocumentHidden(isDocumentHidden());
    handleVisibilityChange();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const scheduleRefresh = React.useCallback(() => {
    if (!enabledRef.current || typeof window === 'undefined') return;
    if (refreshTimerRef.current != null) {
      window.clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void refresh();
    }, ASSISTANT_ACTIVITY_EVENT_REFRESH_DEBOUNCE_MS);
  }, [refresh]);

  React.useEffect(() => {
    if (!enabled) {
      if (refreshTimerRef.current != null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      setCounts({ normal: 0, voice: 0, total: 0 });
      return;
    }
    if (!documentHidden) {
      void refresh();
    }
  }, [documentHidden, enabled, refresh]);

  React.useEffect(() => {
    const eventSourceAvailable = typeof window !== 'undefined' && typeof window.EventSource !== 'undefined';
    if (
      !shouldConnectMinimizedAssistantEvents({
        activeCount: counts.total,
        activityEnabled,
        documentHidden,
        enabled,
        eventSourceAvailable,
      })
    ) {
      setEventsConnected(false);
      return;
    }
    let closed = false;
    const source = new window.EventSource('/api/assistant/events');
    const markConnected = () => {
      if (closed) return;
      setEventsConnected(true);
      scheduleRefresh();
    };
    const markChanged = () => {
      if (closed) return;
      scheduleRefresh();
    };
    source.onopen = markConnected;
    source.onmessage = markChanged;
    source.addEventListener('connected', markConnected);
    source.addEventListener('assistant_change', markChanged);
    source.onerror = () => {
      if (closed) return;
      setEventsConnected(false);
    };
    return () => {
      closed = true;
      source.close();
    };
  }, [activityEnabled, counts.total, documentHidden, enabled, scheduleRefresh]);

  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const intervalMs = minimizedAssistantActivityPollingIntervalMs({
      activeCount: counts.total,
      documentHidden,
      eventsConnected,
    });
    if (intervalMs == null) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [counts.total, documentHidden, enabled, eventsConnected, refresh]);

  React.useEffect(() => {
    return () => {
      if (refreshTimerRef.current != null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, []);

  return counts;
}

function MinimizedAssistantActivityBadge({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: 'normal' | 'voice';
}) {
  if (count <= 0) return null;
  return (
    <span
      className={`inline-flex h-5 min-w-5 items-center justify-center gap-1 rounded-full border px-1.5 text-[10px] font-semibold leading-none ${
        tone === 'voice'
          ? 'border-[rgba(74,222,128,.38)] bg-[rgba(74,222,128,.10)] text-[var(--green)]'
          : 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
      }`}
      title={`${count} active ${label}`}
      aria-label={`${count} active ${label}`}
    >
      {tone === 'voice' ? (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <path d="M12 18v3" />
          <path d="M8 21h8" />
        </svg>
      ) : null}
      <span>{count > 9 ? '9+' : count}</span>
    </span>
  );
}

export function FloatingAssistantDock({ embeddedVisible }: { embeddedVisible: boolean }) {
  const [open, setOpen] = React.useState(readInitialOpen);
  const [activityEnabled, setActivityEnabled] = React.useState(readInitialActivityEnabled);
  const activityCounts = useMinimizedAssistantActivity(!embeddedVisible && !open, activityEnabled);

  const markActivityEnabled = React.useCallback(() => {
    setActivityEnabled(true);
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(FLOATING_ASSISTANT_ACTIVITY_ENABLED_STORAGE_KEY, '1');
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(FLOATING_ASSISTANT_OPEN_STORAGE_KEY, open ? '1' : '0');
  }, [open]);

  React.useEffect(() => {
    if (open) markActivityEnabled();
  }, [markActivityEnabled, open]);

  if (embeddedVisible) return null;

  if (!open) {
    return (
      <div
        data-floating-assistant-dock="minimized"
        className="absolute bottom-4 right-4 z-30 flex flex-col items-end gap-2.5 pointer-events-auto"
      >
        <DesktopVoiceFloatingIndicator />
        <button
          type="button"
          onClick={() => {
            markActivityEnabled();
            setOpen(true);
          }}
          className={`group flex h-10 items-center gap-2 rounded border bg-[var(--panel-alt)] px-3 text-[11px] font-semibold uppercase tracking-wide shadow-[0_16px_40px_rgba(0,0,0,.35)] transition-all hover:bg-[var(--accent-subtle)] ${
            activityCounts.total > 0
              ? 'border-[var(--accent)] text-[var(--accent)] shadow-[0_0_0_1px_rgba(59,130,246,.24),0_0_24px_rgba(59,130,246,.26),0_16px_40px_rgba(0,0,0,.35)]'
              : 'border-[var(--accent-muted)] text-[var(--accent)]'
          }`}
          style={{ fontFamily: 'var(--display)' }}
          title={activityCounts.total > 0 ? `${activityCounts.total} assistant thread${activityCounts.total === 1 ? '' : 's'} active` : 'Open global assistant'}
        >
          <span className="relative flex h-2 w-2 flex-shrink-0">
            {activityCounts.total > 0 ? (
              <>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-45" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent)]" />
              </>
            ) : (
              <span className="h-2 w-2 rounded-full bg-[var(--muted-dim)] opacity-60" />
            )}
          </span>
          <span data-floating-assistant-label="true">Assistant</span>
          <span data-floating-assistant-compact-label="true" className="hidden">AI</span>
          <MinimizedAssistantActivityBadge label="assistant threads" count={activityCounts.normal} tone="normal" />
          <MinimizedAssistantActivityBadge label="voice assistant threads" count={activityCounts.voice} tone="voice" />
        </button>
      </div>
    );
  }

  return (
    <div
      data-floating-assistant-dock="open"
      className="absolute bottom-4 right-4 z-30 flex h-[min(720px,calc(100%-2rem))] w-[min(440px,calc(100%-2rem))] flex-col overflow-hidden rounded border border-[var(--border)] bg-[var(--panel-alt)] shadow-[0_24px_70px_rgba(0,0,0,.48)] pointer-events-auto"
    >
      <div className="flex h-9 flex-shrink-0 items-center justify-between border-b border-[var(--border)] bg-[rgba(255,255,255,.025)] px-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
          Global Assistant
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-7 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:text-[var(--fg-secondary)]"
          style={{ fontFamily: 'var(--display)' }}
          title="Minimize assistant"
        >
          Minimize
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <React.Suspense
          fallback={
            <div className="flex h-full min-h-0 items-center justify-center bg-[var(--panel-alt)] px-3 text-[12px] text-[var(--muted)]">
              Loading assistant...
            </div>
          }
        >
          <LazyAssistantDock />
        </React.Suspense>
      </div>
    </div>
  );
}
