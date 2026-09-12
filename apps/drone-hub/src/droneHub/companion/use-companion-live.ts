import { observeRequest } from '../request-diagnostics';
import React from 'react';
import { CompanionLiveConnection } from './CompanionLiveConnection';
import { CompanionLiveConversation } from './CompanionLiveConversation';

type LiveStatus = 'idle' | 'connecting' | 'listening' | 'error';
type LiveSession = { connection: CompanionLiveConnection; conversation: CompanionLiveConversation; abort: AbortController; muted: boolean };
type LiveState = {
  status: LiveStatus;
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

export function useCompanionLive() {
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

  const stop = React.useCallback(() => {
    const session = active.current;
    active.current = null;
    session?.abort.abort();
    session?.conversation.stop();
    session?.connection.close();
    if (mounted.current) setState((previous) => ({ ...previous, status: 'idle', error: '', muted: false, queued: 0, playbackBlocked: false }));
  }, []);

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

  const start = React.useCallback(async (runBackend: (prompt: string, signal: AbortSignal) => Promise<string>, workspaceLabel: string) => {
    if (active.current || !enabledRef.current) return;
    setState({ ...EMPTY_STATE, status: 'connecting', workspaceLabel });
    let session: LiveSession;
    const update = (patch: Partial<LiveState>) => {
      if (mounted.current && active.current === session) setState((previous) => ({ ...previous, ...patch }));
    };
    const connection = new CompanionLiveConnection({
      onEvent: (event) => { if (active.current === session) session.conversation.receive(event); },
      onReady: (backendModel) => update({ status: 'listening', backendModel }),
      onError: (error) => {
        if (active.current !== session) return;
        session.conversation.stop();
        session.abort.abort();
        update({ status: 'error', error, queued: 0 });
        active.current = null;
      },
      onPlaybackBlocked: (playbackBlocked) => update({ playbackBlocked }),
    });
    const conversation = new CompanionLiveConversation({
      runBackend: async (prompt) => {
        if (active.current !== session) throw new Error('Voice conversation ended.');
        return await runBackend(prompt, session.abort.signal);
      },
      send: (event) => connection.send(event),
      onTranscript: (rows) => update({ captions: rows.map((row) => `${row.role === 'user' ? 'You' : 'Companion'}: ${row.text}`).join('\n') }),
      onQueue: (queued) => update({ queued }),
    });
    session = { connection, conversation, abort: new AbortController(), muted: false };
    active.current = session;
    await connection.start();
  }, []);

  const toggleMute = React.useCallback(() => {
    const session = active.current;
    if (!session) return;
    session.muted = !session.muted;
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
  status: 'idle', error: '', captions: '', queued: 0, muted: false, playbackBlocked: false, backendModel: '', workspaceLabel: '',
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
