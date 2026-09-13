import { observeRequest } from '../request-diagnostics';
import React from 'react';
import { companionLiveReconnectDelay, connectCompanionLiveReplies, type CompanionClientController } from '@drone/assistant-chat';
import { CompanionLiveConnection } from './CompanionLiveConnection';
import { CompanionLiveConversation } from './CompanionLiveConversation';

type LiveStatus = 'idle' | 'connecting' | 'listening' | 'error';
type LiveSession = { connection: CompanionLiveConnection; conversation: CompanionLiveConversation; abort: AbortController; replies?: ReturnType<typeof connectCompanionLiveReplies>; muted: boolean };
type LiveState = {
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
  systemPrompt: string;
  defaultSystemPrompt: string;
  maxSystemPromptChars: number;
};
type LiveTarget = { runBackend: (prompt: string, signal: AbortSignal) => Promise<string>; workspaceLabel: string };
type ReconnectSchedule = (callback: () => void, delayMs: number) => () => void;

export function useCompanionLive(controller?: CompanionClientController, reconnectSchedule: ReconnectSchedule = scheduleTimeout) {
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
  const mounted = React.useRef(true);
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
    desiredTarget.current = null;
    desiredMuted.current = false;
    cancelReconnect();
    const session = active.current;
    active.current = null;
    session?.replies?.stop();
    session?.abort.abort();
    session?.conversation.stop();
    session?.connection.close();
    if (mounted.current) setState((previous) => ({ ...previous, status: 'idle', capturing: false, error: '', muted: false, queued: 0, playbackBlocked: false }));
  }, [cancelReconnect]);

  const reset = React.useCallback(() => {
    stop();
    if (mounted.current) setState(EMPTY_STATE);
  }, [stop]);

  const load = React.useCallback(async () => {
    if (writing.current) return;
    const generation = ++settingsGeneration.current;
    try {
      const result = await settingsRequest();
      if (!mounted.current || writing.current || generation !== settingsGeneration.current) return;
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
    const leave = () => stop();
    window.addEventListener('pagehide', leave);
    return () => {
      mounted.current = false;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pagehide', leave);
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
      enabledRef.current = result.enabled;
      setEnabled(result.enabled);
      setSystemPrompt(result.systemPrompt);
      setDefaultSystemPrompt(result.defaultSystemPrompt);
      setMaxSystemPromptChars(result.maxSystemPromptChars);
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
  }, []);

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
    if (active.current || desiredTarget.current !== target || !enabledRef.current) return;
    if (reconnecting) {
      setState((previous) => ({ ...previous, status: 'connecting', capturing: false, error: '', queued: 0, playbackBlocked: false }));
    } else {
      setState({ ...EMPTY_STATE, hasStarted: true, status: 'connecting', workspaceLabel: target.workspaceLabel });
    }
    let session: LiveSession;
    const update = (patch: Partial<LiveState>) => {
      if (mounted.current && active.current === session) setState((previous) => ({ ...previous, ...patch }));
    };
    const connection = new CompanionLiveConnection({
      onEvent: (event) => { if (active.current === session) session.conversation.receive(event); },
      onCapturing: () => update({ capturing: true }),
      onReady: (backendModel) => {
        if (active.current !== session) return;
        reconnectAttempt.current = 0;
        session.replies?.ready();
        update({ status: 'listening', error: '', backendModel });
      },
      onError: () => {
        if (active.current !== session) return;
        session.replies?.stop();
        session.conversation.stop();
        session.abort.abort();
        session.connection.close();
        active.current = null;
        scheduleReconnect(target);
      },
      onPlaybackBlocked: (playbackBlocked) => update({ playbackBlocked }),
    });
    const conversation = new CompanionLiveConversation({
      externalBackendReplies: Boolean(controller),
      runBackend: async (prompt) => {
        if (active.current !== session) throw new Error('Voice conversation ended.');
        return await target.runBackend(prompt, session.abort.signal);
      },
      send: (event) => connection.send(event),
      onTranscript: (rows) => update({ captions: rows.map((row) => `${row.role === 'user' ? 'You' : 'Companion'}: ${row.text}`).join('\n') }),
      onQueue: (queued) => update({ queued }),
    });
    session = { connection, conversation, abort: new AbortController(), muted: desiredMuted.current };
    session.replies = controller ? connectCompanionLiveReplies(controller, conversation) : undefined;
    active.current = session;
    if (session.muted) connection.mute(true);
    await connection.start();
  };

  const start = React.useCallback(async (runBackend: LiveTarget['runBackend'], workspaceLabel: string) => {
    if (active.current || !enabledRef.current) return;
    cancelReconnect();
    desiredMuted.current = false;
    const target = { runBackend, workspaceLabel };
    desiredTarget.current = target;
    await startAttempt.current(target, false);
  }, [cancelReconnect]);

  const toggleMute = React.useCallback(() => {
    const session = active.current;
    if (!session) return;
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

  return {
    ...state,
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
    toggleMute,
    play,
    cancelPending,
  };
}

const EMPTY_STATE: LiveState = {
  hasStarted: false, status: 'idle', capturing: false, error: '', captions: '', queued: 0, muted: false, playbackBlocked: false, backendModel: '', workspaceLabel: '',
};

async function settingsRequest(update?: Partial<Pick<LiveSettings, 'enabled' | 'systemPrompt'>>): Promise<LiveSettings> {
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
