import { expect, test } from 'bun:test';
import { CompanionLiveSettingsStore } from '../src/droneHub/companion/companion-live-settings-store';

const settings = { enabled: true, mode: 'live', systemPrompt: 'Original', defaultSystemPrompt: '', maxSystemPromptChars: 8000 };

test('shared settings deduplicate loads and a stale read cannot undo a completed save', async () => {
  const original = globalThis.fetch;
  const requests: Array<(value: typeof settings) => void> = [];
  globalThis.fetch = (async () => new Promise<Response>(resolve => requests.push(value => resolve(Response.json(value))))) as typeof fetch;
  try {
    const store = new CompanionLiveSettingsStore();
    const initial = store.load();
    expect(store.load()).toBe(initial);
    expect(requests).toHaveLength(1);
    requests[0](settings); await initial;
    const refreshing = store.load();
    expect(store.getSnapshot().loading).toBe(false);
    const saving = store.save({ systemPrompt: 'Saved' });
    expect(requests).toHaveLength(3);
    requests[2]({ ...settings, systemPrompt: 'Saved' }); await saving;
    requests[1](settings); await refreshing;
    expect(store.getSnapshot()).toMatchObject({ systemPrompt: 'Saved', enabled: true, loading: false, saving: false });
  } finally { globalThis.fetch = original; }
});

test('refresh notifications during a save run afterward, and failed writes preserve shared preferences', async () => {
  const original = globalThis.fetch;
  const requests: Array<(response: Response) => void> = [];
  globalThis.fetch = (async () => new Promise<Response>(resolve => requests.push(resolve))) as typeof fetch;
  try {
    const store = new CompanionLiveSettingsStore();
    const initial = store.load(); requests[0](Response.json(settings)); await initial;
    const saving = store.save({ enabled: false });
    await store.load(); await store.load();
    expect(requests).toHaveLength(2);
    requests[1](new Response('', { status: 500 }));
    expect(await saving).toBeNull();
    expect(store.getSnapshot()).toMatchObject({ enabled: true, saving: false, loading: false });
    expect(store.getSnapshot().settingsError).toContain('save');
    expect(requests).toHaveLength(3);
    const refresh = store.load();
    requests[2](Response.json({ ...settings, systemPrompt: 'Changed elsewhere' })); await refresh;
    expect(store.getSnapshot()).toMatchObject({ systemPrompt: 'Changed elsewhere', settingsError: '', loading: false });
  } finally { globalThis.fetch = original; }
});
