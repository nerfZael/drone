import { observeRequest } from '../request-diagnostics';
import React from 'react';
import { CompanionLiveController, type CompanionLiveTarget, type CompanionClientController } from '@drone/assistant-chat';
import { CompanionLiveConnection } from './CompanionLiveConnection';

type LiveSettings = {
  enabled: boolean;
  systemPrompt: string;
  defaultSystemPrompt: string;
  maxSystemPromptChars: number;
};
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
  const mounted = React.useRef(true);
  const writing = React.useRef(false);
  const enabledRef = React.useRef(false);
  const settingsGeneration = React.useRef(0);
  const scheduleRef = React.useRef(reconnectSchedule);
  scheduleRef.current = reconnectSchedule;
  const [live] = React.useState(() => new CompanionLiveController({
    canStart: () => enabledRef.current,
    createConnection: (options) => new CompanionLiveConnection(options),
    schedule: (callback, delay) => scheduleRef.current(callback, delay),
  }, controller));
  const state = React.useSyncExternalStore(live.subscribe, live.getSnapshot, live.getSnapshot);
  const { stop, reset, toggleMute, play } = live;

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

  const start = React.useCallback((run: CompanionLiveTarget['run'], workspaceLabel: string) =>
    live.start({ id: '', name: workspaceLabel, run }), [live]);
  const cancelPending = stop;

  return {
    ...state,
    workspaceLabel: state.targetName,
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
