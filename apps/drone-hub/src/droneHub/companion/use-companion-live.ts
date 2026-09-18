import { useCompanionJev } from './use-companion-jev';
import { observeRequest } from '../request-diagnostics';
import React from 'react';
import { CompanionLiveTiming, type CompanionClientTelemetry, companionLiveReconnectDelay, connectCompanionLiveReplies, type CompanionAutonomy, type CompanionClientController, type CompanionSenseSources } from '@drone/assistant-chat';
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
type LiveSettings = {
  enabled: boolean;
  mode?: 'live' | 'jev';
  jevSystemPrompt?: string;
  jevDecisionIntervalMs?: number;
  autonomy?: CompanionAutonomy;
  brain?: boolean;
  defaultJevSystemPrompt?: string;
  systemPrompt: string;
  defaultSystemPrompt: string;
  maxSystemPromptChars: number;
};
type LiveTarget = { runBackend: (prompt: string, signal: AbortSignal, telemetry?: CompanionClientTelemetry) => Promise<string>; workspaceLabel: string; announcement?: string };
type ReconnectSchedule = (callback: () => void, delayMs: number) => () => void;

export function useCompanionLive(controller?: CompanionClientController, reconnectSchedule: ReconnectSchedule = scheduleTimeout) {
  const [jevDecisionIntervalMs, setJevDecisionIntervalMs] = React.useState(250);
  const [mode, setMode] = React.useState<'live' | 'jev'>('live');
  const modeRef = React.useRef(mode);
  const [jevSystemPrompt, setJevSystemPrompt] = React.useState('');
  const [defaultJevSystemPrompt, setDefaultJevSystemPrompt] = React.useState('');
  const [autonomy, setAutonomy] = React.useState<CompanionAutonomy>('off');
  const [brain, setBrain] = React.useState(false);
  const jev = useCompanionJev(jevDecisionIntervalMs, jevSystemPrompt || defaultJevSystemPrompt, { autonomy, brain });
  const acceptMode = (result: LiveSettings) => {
    setJevDecisionIntervalMs(result.jevDecisionIntervalMs ?? 250);
    setAutonomy(result.autonomy ?? 'off'); setBrain(result.brain === true);
    modeRef.current = result.mode ?? 'live'; setMode(modeRef.current);
    setJevSystemPrompt(result.jevSystemPrompt ?? ''); setDefaultJevSystemPrompt(result.defaultJevSystemPrompt ?? '');
  };
  const [enabled, setEnabled] = React.useState(false);
  const [resolved, setResolved] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [settingsError, setSettingsError] = React.useState('');
  const [systemPrompt, setSystemPrompt] = React.useState('');
  const [defaultSystemPrompt, setDefaultSystemPrompt] = React.useState('');
  const [maxSystemPromptChars, setMaxSystemPromptChars] = React.useState(0);
  const [state, setState] = React.useState<LiveState>(EMPTY_STATE);
  const active = React.useRef<LiveSession | null>(null);
  const pendingCleanup = React.useRef<Promise<void> | undefined>(undefined);
  const mounted = React.useRef(true);
  const pageActive = React.useRef(true);
  const writing = React.useRef(false);
  const enabledRef = React.useRef(false);
  const settingsGeneration = React.useRef(0);
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
    jev.stop();
    desiredTarget.current = null;
    desiredMuted.current = false;
    cancelReconnect();
    const session = active.current;
    active.current = null;
    session?.announcement?.stop();
    session?.replies?.stop();
    session?.abort.abort();
    session?.conversation.stop();
    if (session) pendingCleanup.current = Promise.all([pendingCleanup.current, session.connection.close()]).then(() => undefined);
    if (mounted.current) setState((previous) => ({ ...previous, announcing: false, status: 'idle', capturing: false, error: '', muted: false, queued: 0, playbackBlocked: false }));
  }, [cancelReconnect, jev.stop]);

  const reset = React.useCallback(() => {
    stop();
    jev.reset();
    if (mounted.current) setState(EMPTY_STATE);
  }, [stop, jev.reset]);

  const load = React.useCallback(async () => {
    if (writing.current) return;
    const generation = ++settingsGeneration.current;
    try {
      const result = await settingsRequest();
      if (!mounted.current || writing.current || generation !== settingsGeneration.current) return;
      if ((result.mode ?? 'live') !== modeRef.current) stop();
      acceptMode(result);
      enabledRef.current = result.enabled;
      setEnabled(result.enabled);
      setSystemPrompt(result.systemPrompt);
      setDefaultSystemPrompt(result.defaultSystemPrompt);
      setMaxSystemPromptChars(result.maxSystemPromptChars);
      setResolved(true);
      setSettingsError('');
      if (!result.enabled) stop();
    } catch (error) {
      if (mounted.current && generation === settingsGeneration.current) setSettingsError(error instanceof Error ? error.message : 'Could not load Live voice setting.');
    } finally { if (mounted.current && generation === settingsGeneration.current) setLoading(false); }
  }, [stop]);

  React.useEffect(() => {
    mounted.current = true;
    void load();
    const refresh = () => void load();
    window.addEventListener('focus', refresh);
    const leave = () => { pageActive.current = false; stop(); };
    const show = () => { pageActive.current = true; };
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', show);
    return () => {
      mounted.current = false;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', show);
      stop();
    };
  }, [load, stop]);

  const toggleEnabled = React.useCallback(async () => {
    if (loading || writing.current) return;
    writing.current = true;
    settingsGeneration.current += 1;
    setSaving(true);
    setSettingsError('');
    try {
      const result = await settingsRequest({ enabled: !enabledRef.current });
      if (!mounted.current) return;
      if ((result.mode ?? 'live') !== modeRef.current) stop();
      acceptMode(result);
      enabledRef.current = result.enabled;
      setEnabled(result.enabled);
      setSystemPrompt(result.systemPrompt);
      setDefaultSystemPrompt(result.defaultSystemPrompt);
      setMaxSystemPromptChars(result.maxSystemPromptChars);
      setResolved(true);
      if (!result.enabled) stop();
      return result.enabled;
    } catch (error) {
      if (mounted.current) setSettingsError(error instanceof Error ? error.message : 'Could not save Live voice setting.');
    } finally {
      writing.current = false;
      if (mounted.current) setSaving(false);
    }
  }, [loading, stop]);

  const saveSystemPrompt = React.useCallback(async (nextSystemPrompt: string) => {
    if (writing.current) return false;
    writing.current = true;
    const generation = ++settingsGeneration.current;
    setSaving(true);
    setSettingsError('');
    try {
      const result = await settingsRequest({ systemPrompt: nextSystemPrompt });
      if (!mounted.current || generation !== settingsGeneration.current) return false;
      if ((result.mode ?? 'live') !== modeRef.current) stop();
      acceptMode(result);
      enabledRef.current = result.enabled;
      setEnabled(result.enabled);
      setSystemPrompt(result.systemPrompt);
      setDefaultSystemPrompt(result.defaultSystemPrompt);
      setMaxSystemPromptChars(result.maxSystemPromptChars);
      if (!result.enabled) stop();
      return true;
    } catch (error) {
      if (mounted.current && generation === settingsGeneration.current) {
        setSettingsError(error instanceof Error ? error.message : 'Could not save Live voice system prompt.');
      }
      return false;
    } finally {
      writing.current = false;
      if (mounted.current && generation === settingsGeneration.current) setSaving(false);
    }
  }, [stop]);

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
    if (active.current || desiredTarget.current !== target || modeRef.current === 'jev' || !enabledRef.current || !pageActive.current) return;
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
    if (!controller) return;
    let previous = controller.getSnapshot();
    return controller.subscribe(() => {
      const next = controller.getSnapshot();
      const completed = next.status === 'completed' && previous.status !== 'completed';
      previous = next;
      if (!completed || next.trigger !== 'subscription' || !next.reply.trim() || !enabledRef.current || modeRef.current === 'jev' || !mounted.current || !pageActive.current) return;
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
  }, [controller]);

  const start = React.useCallback(async (runBackend: LiveTarget['runBackend'], workspaceLabel: string, cancelBackend?: () => Promise<void>, senses?: CompanionSenseSources) => {
    if (modeRef.current === 'jev' && enabledRef.current && pageActive.current) { await jev.start(runBackend, cancelBackend, senses); return; }
    if (active.current?.announcement) stop();
    if (active.current || !enabledRef.current || !pageActive.current) return;
    cancelReconnect();
    desiredMuted.current = false;
    const target = { runBackend, workspaceLabel };
    desiredTarget.current = target;
    await startAttempt.current(target, false);
  }, [cancelReconnect, stop, jev.start]);

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

  const saveVoiceMode = async (next: 'normal' | 'live' | 'jev') => {
    if (writing.current || loading) return;
    writing.current = true; settingsGeneration.current += 1; setSaving(true); setSettingsError('');
    stop();
    try {
      const result = await settingsRequest({ enabled: next !== 'normal', mode: next === 'jev' ? 'jev' : 'live' });
      if (!mounted.current) return;
      acceptMode(result); enabledRef.current = result.enabled; setEnabled(result.enabled);
    } catch { setSettingsError('Could not save voice mode.'); }
    finally { writing.current = false; if (mounted.current) setSaving(false); }
  };
  const saveJevSystemPrompt = async (prompt: string) => {
    if (writing.current) return false;
    writing.current = true; settingsGeneration.current += 1; setSaving(true); setSettingsError('');
    try {
      const result = await settingsRequest({ jevSystemPrompt: prompt });
      if (!mounted.current) return false;
      acceptMode(result); return true;
    } catch { setSettingsError('Could not save Jev instructions.'); return false; }
    finally { writing.current = false; if (mounted.current) setSaving(false); }
  };

  const saveJevDecisionInterval = async (intervalMs: number) => {
    if (writing.current) return false;
    writing.current = true; settingsGeneration.current += 1; setSaving(true); setSettingsError('');
    try {
      const result = await settingsRequest({ jevDecisionIntervalMs: intervalMs });
      if (!mounted.current) return false;
      acceptMode(result); return true;
    } catch { setSettingsError('Could not save Jev decision interval. Use 50–10000 milliseconds.'); return false; }
    finally { writing.current = false; if (mounted.current) setSaving(false); }
  };

  const saveAutonomy = async (next: CompanionAutonomy) => {
    if (writing.current) return false;
    writing.current = true; settingsGeneration.current += 1; setSaving(true); setSettingsError('');
    try {
      const result = await settingsRequest({ autonomy: next });
      if (!mounted.current) return false;
      acceptMode(result); return true;
    } catch { setSettingsError('Could not save the autonomy level.'); return false; }
    finally { writing.current = false; if (mounted.current) setSaving(false); }
  };
  const saveBrain = async (next: boolean) => {
    if (writing.current) return false;
    writing.current = true; settingsGeneration.current += 1; setSaving(true); setSettingsError('');
    try {
      const result = await settingsRequest({ brain: next });
      if (!mounted.current) return false;
      acceptMode(result); return true;
    } catch { setSettingsError('Could not save the brain setting.'); return false; }
    finally { writing.current = false; if (mounted.current) setSaving(false); }
  };

  return {
    ...state,
    autonomy, brain, saveAutonomy, saveBrain,
    jevRequests: jev.requests,
    jevTable: jev.table,
    jevInsight: jev.insight,
    resetJevTable: jev.resetTable,
    jevCompiling: jev.compiling,
    ...(mode === 'jev' ? { captions: jev.captions, error: jev.error, status: jev.status, hasStarted: jev.hasStarted, capturing: jev.capturing, queued: jev.queued, muted: jev.muted, announcing: false, playbackBlocked: false } : {}),
    jevDecisionIntervalMs, saveJevDecisionInterval,
    mode, jevSystemPrompt, defaultJevSystemPrompt, saveVoiceMode, saveJevSystemPrompt,
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
    load,
    start,
    stop,
    reset,
    toggleMute: mode === 'jev' ? jev.toggleMute : toggleMute,
    play,
    cancelPending,
  };
}

const EMPTY_STATE: LiveState = {
  announcing: false,
  hasStarted: false, status: 'idle', capturing: false, error: '', captions: '', queued: 0, muted: false, playbackBlocked: false, backendModel: '', workspaceLabel: '',
};

async function settingsRequest(update?: Partial<Pick<LiveSettings, 'enabled' | 'systemPrompt' | 'mode' | 'jevSystemPrompt' | 'jevDecisionIntervalMs' | 'autonomy' | 'brain'>>): Promise<LiveSettings> {
  const url = '/api/settings/companion/live-voice';
  const init: RequestInit = {
    signal: AbortSignal.timeout(10_000),
    ...(update === undefined ? {} : {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update),
    }),
  };
  const diagnostic = observeRequest(url, init);
  const headers = new Headers(init.headers);
  if (diagnostic) headers.set('x-drone-client-request-id', diagnostic.requestId);
  try {
    const response = await fetch(url, { ...init, headers });
    diagnostic?.response(response);
    if (!response.ok) throw new Error(`Could not ${update === undefined ? 'load' : 'save'} Live voice setting (${response.status}).`);
    const value = await response.json();
    if (!value || typeof value.enabled !== 'boolean' || typeof value.systemPrompt !== 'string' ||
      typeof value.defaultSystemPrompt !== 'string' || typeof value.maxSystemPromptChars !== 'number') {
      throw new Error('Invalid Live voice setting response.');
    }
    diagnostic?.finish();
    return value;
  } catch (error) { diagnostic?.fail(error); throw error; }
}

function scheduleTimeout(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
}
