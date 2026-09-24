import React from 'react';
import { observeRequest } from '../request-diagnostics';
import { useCompanionMirror } from './CompanionMirrorContext';

type LiveSettings = {
  enabled: boolean;
  systemPrompt: string;
  defaultSystemPrompt: string;
  maxSystemPromptChars: number;
};

type LiveSettingsUpdate = Partial<Pick<LiveSettings, 'enabled' | 'systemPrompt'>>;
type Snapshot = Required<LiveSettings> & {
  loading: boolean;
  resolved: boolean;
  saving: boolean;
  settingsError: string;
};

/** Voice preferences are shared by all desktop sessions; microphone state is not. */
export class CompanionLiveSettingsStore {
  private snapshot: Snapshot = {
    enabled: false, systemPrompt: '', defaultSystemPrompt: '', maxSystemPromptChars: 0,
    loading: true, resolved: false, saving: false, settingsError: '',
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private pendingLoad: Promise<void> | null = null;
  private refreshAfterSave = false;
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(patch: Partial<Snapshot>) {
    const next = { ...this.snapshot, ...patch };
    if (Object.keys(next).every(key => Object.is(next[key as keyof Snapshot], this.snapshot[key as keyof Snapshot]))) return;
    this.snapshot = next;
    this.listeners.forEach(listener => listener());
  }
  private accept(value: LiveSettings) {
    this.update({
      enabled: value.enabled,
      systemPrompt: value.systemPrompt, defaultSystemPrompt: value.defaultSystemPrompt, maxSystemPromptChars: value.maxSystemPromptChars,
      resolved: true, loading: false, settingsError: '',
    });
  }
  load = (): Promise<void> => {
    // A server notification during a write must refresh after the write settles.
    if (this.snapshot.saving) { this.refreshAfterSave = true; return Promise.resolve(); }
    if (this.pendingLoad) return this.pendingLoad;
    const generation = ++this.generation;
    if (!this.snapshot.resolved) this.update({ loading: true });
    const request = settingsRequest().then(value => {
      if (generation === this.generation) this.accept(value);
    }).catch(error => {
      if (generation === this.generation) this.update({ settingsError: error instanceof Error ? error.message : 'Could not load Live voice setting.' });
    }).finally(() => {
      if (generation === this.generation) this.update({ loading: false });
      if (this.pendingLoad === request) this.pendingLoad = null;
    });
    this.pendingLoad = request;
    return request;
  };
  save = async (patch: LiveSettingsUpdate, failure?: string): Promise<LiveSettings | null> => {
    if (this.snapshot.saving) return null;
    ++this.generation; // A previous GET must not undo a newer saved preference.
    this.pendingLoad = null;
    this.update({ saving: true, settingsError: '' });
    try {
      const value = await settingsRequest(patch);
      this.accept(value);
      return value;
    } catch (error) {
      this.update({ settingsError: failure ?? (error instanceof Error ? error.message : 'Could not save Live voice setting.') });
      return null;
    } finally {
      this.update({ saving: false, loading: false });
      if (this.refreshAfterSave) { this.refreshAfterSave = false; void this.load(); }
    }
  };
}

/** Only the owner loads and refreshes shared preferences. Session selection never reloads them. */
export function useCompanionLiveSettingsStore(shared?: CompanionLiveSettingsStore) {
  const [store] = React.useState(() => shared ?? new CompanionLiveSettingsStore());
  const liveSettingsVersion = useCompanionMirror()?.liveSettingsVersion;
  React.useEffect(() => {
    if (shared) return;
    void store.load();
    const refresh = () => { void store.load(); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [store, shared]);
  React.useEffect(() => {
    if (!shared && liveSettingsVersion) void store.load();
  }, [store, shared, liveSettingsVersion]);
  return store;
}

async function settingsRequest(update?: LiveSettingsUpdate): Promise<LiveSettings> {
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

