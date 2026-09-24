import { useCompanionLiveSettingsStore, type CompanionLiveSettingsStore } from './companion-live-settings-store';
import React from 'react';
import { CompanionLiveTiming, type CompanionClientTelemetry, companionLiveReconnectDelay, connectCompanionLiveReplies, type CompanionClientController } from '@drone/assistant-chat';
import { CompanionLiveConnection } from './CompanionLiveConnection';
import { CompanionLiveConversation } from './CompanionLiveConversation';
import { CompanionLiveAnnouncement } from './CompanionLiveAnnouncement';

type LiveStatus = 'idle' | 'connecting' | 'listening' | 'error';
type LiveSession = { connection: CompanionLiveConnection; conversation: CompanionLiveConversation; abort: AbortController; replies?: ReturnType<typeof connectCompanionLiveReplies>; announcement?: CompanionLiveAnnouncement; muted: boolean };
type LiveState = {
  announcing: boolean;
  hasStarted: boolean;
  status: LiveStatus;
  capturing: boolean;
  error: string;
  captions: string;
  queued: number;
  muted: boolean;
  playbackBlocked: boolean;
  backendModel: string;
  workspaceLabel: string;
};
type LiveTarget = { runBackend: (prompt: string, signal: AbortSignal, telemetry?: CompanionClientTelemetry) => Promise<string>; workspaceLabel: string; announcement?: string };
type ReconnectSchedule = (callback: () => void, delayMs: number) => () => void;

export function useCompanionLive(controller?: CompanionClientController, reconnectSchedule: ReconnectSchedule = scheduleTimeout, selected = true, sharedSettings?: CompanionLiveSettingsStore) {
  const settingsStore = useCompanionLiveSettingsStore(sharedSettings);
  const settings = React.useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot, settingsStore.getSnapshot);
  const { enabled, resolved, loading, saving, settingsError, systemPrompt, defaultSystemPrompt, maxSystemPromptChars } = settings;
  const enabledRef = React.useMemo(() => ({ get current() { return settingsStore.getSnapshot().enabled; } }), [settingsStore]);
  const [state, setState] = React.useState<LiveState>(EMPTY_STATE);
  const active = React.useRef<LiveSession | null>(null);
  const pendingCleanup = React.useRef<Promise<void> | undefined>(undefined);
  const mounted = React.useRef(true);
  const pageActive = React.useRef(true);
  const desiredTarget = React.useRef<LiveTarget | null>(null);
  const desiredMuted = React.useRef(false);
  const reconnectAttempt = React.useRef(0);
  const cancelScheduledReconnect = React.useRef<(() => void) | null>(null);
  const startAttempt = React.useRef<(target: LiveTarget, reconnecting: boolean) => Promise<void>>(async () => {});

  const cancelReconnect = React.useCallback((resetAttempts = true) => {
    cancelScheduledReconnect.current?.();
    cancelScheduledReconnect.current = null;
    if (resetAttempts) reconnectAttempt.current = 0;
  }, []);

  const stop = React.useCallback(() => {
    desiredTarget.current = null;
    desiredMuted.current = false;
    cancelReconnect();
    const session = active.current;
    active.current = null;
    session?.announcement?.stop();
    session?.replies?.stop();
    session?.abort.abort();
    session?.conversation.stop();
    pendingCleanup.current = Promise.all([pendingCleanup.current, session?.connection.close()]).then(() => undefined);
    if (mounted.current) setState((previous) => ({ ...previous, announcing: false, status: 'idle', capturing: false, error: '', muted: false, queued: 0, playbackBlocked: false }));
    return pendingCleanup.current;
  }, [cancelReconnect]);

  const reset = React.useCallback(() => {
    stop();
    if (mounted.current) setState(EMPTY_STATE);
  }, [stop]);

  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stop(); };
  }, [stop]);
  React.useEffect(() => {
    if (!selected) return;
    const leave = () => { pageActive.current = false; stop(); };
    const show = () => { pageActive.current = true; };
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', show);
    return () => {
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', show);
      stop();
    };
  }, [stop, selected]);
  React.useEffect(() => {
    let previous = settingsStore.getSnapshot();
    return settingsStore.subscribe(() => {
      const next = settingsStore.getSnapshot();
      if (previous.enabled && !next.enabled) stop();
      previous = next;
    });
  }, [settingsStore, stop]);

  const toggleEnabled = React.useCallback(async () => {
    const current = settingsStore.getSnapshot();
    if (current.loading || current.saving) return;
    return (await settingsStore.save({ enabled: !current.enabled }))?.enabled;
  }, [settingsStore]);
  const saveSystemPrompt = React.useCallback(async (systemPrompt: string) => {
    return Boolean(await settingsStore.save({ systemPrompt }));
  }, [settingsStore]);

  const scheduleReconnect = React.useCallback((target: LiveTarget) => {
    if (!mounted.current || desiredTarget.current !== target) return;
    cancelScheduledReconnect.current?.();
    const delay = companionLiveReconnectDelay(reconnectAttempt.current++);
    setState((previous) => ({
      ...previous,
      hasStarted: true,
      status: 'connecting',
      capturing: false,
      error: '',
      queued: 0,
      playbackBlocked: false,
      workspaceLabel: target.workspaceLabel,
    }));
    cancelScheduledReconnect.current = reconnectSchedule(() => {
      cancelScheduledReconnect.current = null;
      if (!mounted.current || desiredTarget.current !== target || active.current) return;
      void startAttempt.current(target, true);
    }, delay);
  }, [reconnectSchedule]);

  startAttempt.current = async (target, reconnecting) => {
    if (active.current || desiredTarget.current !== target || !enabledRef.current || !pageActive.current) return;
    if (reconnecting) {
      setState((previous) => ({ ...previous, status: 'connecting', capturing: false, error: '', queued: 0, playbackBlocked: false }));
    } else {
      setState({ ...EMPTY_STATE, hasStarted: true, announcing: Boolean(target.announcement), muted: desiredMuted.current, status: 'connecting', workspaceLabel: target.workspaceLabel });
    }
    let session: LiveSession;
    const update = (patch: Partial<LiveState>) => {
      if (mounted.current && active.current === session) setState((previous) => ({ ...previous, ...patch }));
    };
    const timing = new CompanionLiveTiming();
    const connection = new CompanionLiveConnection({
      timing,
      onEvent: (event) => {
        if (active.current !== session) return;
        // An automatic announcement cannot create new backend work or capture a request.
        if (!session.announcement || event.type === 'session.output_transcript.delta') session.conversation.receive(event);
      },
      onCapturing: () => update({ capturing: true }),
      onReady: (backendModel) => {
        if (active.current !== session) return;
        reconnectAttempt.current = 0;
        session.replies?.ready();
        session.announcement?.connected();
        update({ status: 'listening', error: '', backendModel });
      },
      onError: (error) => {
        if (active.current !== session) return;
        if (session.announcement) {
          stop();
          setState((previous) => ({ ...previous, error }));
          return;
        }
        session.replies?.stop();
        session.conversation.stop();
        session.abort.abort();
        pendingCleanup.current = Promise.all([pendingCleanup.current, session.connection.close()]).then(() => undefined);
        active.current = null;
        scheduleReconnect(target);
      },
      onPlaybackBlocked: (playbackBlocked) => {
        if (active.current !== session) return;
        session.announcement?.playbackBlocked(playbackBlocked);
        update({ playbackBlocked });
      },
      onAnnouncementPlayback: target.announcement ? (event) => {
        if (active.current === session) session.announcement?.playback(event);
      } : undefined,
    });
    const conversation = new CompanionLiveConversation({
      timing,
      externalBackendReplies: Boolean(controller),
      runBackend: async (prompt, telemetry) => {
        if (active.current !== session) throw new Error('Voice conversation ended.');
        return await target.runBackend(prompt, session.abort.signal, telemetry);
      },
      send: (event) => connection.send(event),
      onTranscript: (rows) => update({ captions: rows.map((row) => `${row.role === 'user' ? 'You' : 'Companion'}: ${row.text}`).join('\n') }),
      onQueue: (queued) => update({ queued }),
    });
    session = { connection, conversation, abort: new AbortController(), muted: desiredMuted.current };
    if (target.announcement) {
      session.announcement = new CompanionLiveAnnouncement((event) => connection.send(event), (error) => {
        if (active.current !== session) return;
        stop();
        if (error) setState((previous) => ({ ...previous, error }));
      });
      session.announcement.deliver(target.announcement);
    } else session.replies = controller ? connectCompanionLiveReplies(controller, conversation) : undefined;
    active.current = session;
    if (session.muted) connection.mute(true);
    // Keep observing replies during cleanup, but do not acquire the microphone
    // until the preceding connection has released it. Stop also cancels this wait.
    const cleanup = pendingCleanup.current;
    if (cleanup) {
      await cleanup;
      if (pendingCleanup.current === cleanup) pendingCleanup.current = undefined;
    }
    if (active.current !== session) return;
    await connection.start();
  };

  React.useEffect(() => {
    if (!controller || !selected) return;
    let previous = controller.getSnapshot();
    return controller.subscribe(() => {
      const next = controller.getSnapshot();
      const completed = next.status === 'completed' && previous.status !== 'completed';
      previous = next;
      if (!completed || next.trigger !== 'subscription' || !next.reply.trim() || !enabledRef.current || !mounted.current || !pageActive.current) return;
      if (active.current?.announcement) { active.current.announcement.deliver(next.reply); return; }
      // Active conversations and reconnects already own their reply delivery.
      if (active.current || desiredTarget.current) return;
      desiredMuted.current = true;
      const target: LiveTarget = {
        announcement: next.reply, workspaceLabel: 'Subscription update',
        runBackend: async () => { throw new Error('Subscription announcements do not run backend tasks.'); },
      };
      desiredTarget.current = target;
      void startAttempt.current(target, false);
    });
  }, [controller, selected]);

  const start = React.useCallback(async (runBackend: LiveTarget['runBackend'], workspaceLabel: string, initiallyMuted = false) => {
    if (active.current?.announcement) stop();
    if (active.current || !enabledRef.current || !pageActive.current) return;
    cancelReconnect();
    desiredMuted.current = initiallyMuted;
    const target = { runBackend, workspaceLabel };
    desiredTarget.current = target;
    await startAttempt.current(target, false);
  }, [cancelReconnect, stop]);

  const toggleMute = React.useCallback(() => {
    const session = active.current;
    if (!session || session.announcement) return;
    session.muted = !session.muted;
    desiredMuted.current = session.muted;
    session.connection.mute(session.muted);
    setState((previous) => ({ ...previous, muted: session.muted }));
  }, []);
  const play = React.useCallback(() => { void active.current?.connection.play(); }, []);
  const cancelPending = React.useCallback(() => {
    // Stop voice as well so pending delegation cannot restart a user-cancelled backend task.
    stop();
  }, [stop]);

  const saveVoiceMode = async (next: 'normal' | 'live') => {
    const current = settingsStore.getSnapshot();
    if (current.loading || current.saving) return;
    stop();
    await settingsStore.save({ enabled: next === 'live' }, 'Could not save voice mode.');
  };

  return {
    ...state,
    saveVoiceMode,
    enabled,
    resolved,
    loading,
    saving,
    settingsError,
    systemPrompt,
    defaultSystemPrompt,
    maxSystemPromptChars,
    toggleEnabled,
    saveSystemPrompt,
    load: settingsStore.load,
    start,
    stop,
    reset,
    toggleMute,
    play,
    cancelPending,
  };
}

const EMPTY_STATE: LiveState = {
  announcing: false,
  hasStarted: false, status: 'idle', capturing: false, error: '', captions: '', queued: 0, muted: false, playbackBlocked: false, backendModel: '', workspaceLabel: '',
};

function scheduleTimeout(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
}
