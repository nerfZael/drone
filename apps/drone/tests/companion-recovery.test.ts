import { CompanionRuntime } from '../src/hub/companion/companion-runtime';
import { loadBlipNodeRuntime } from '../src/hub/assistant/blip-runtime-loader';
import { summaryText } from '../../../blip/packages/core/tests/helpers/compaction-fixtures';
import { expect, test, spyOn } from 'bun:test';
import path from 'node:path';
import { registerFauxProvider, fauxAssistantMessage } from '@mariozechner/pi-ai';
import { BlipAssistantHost } from '../src/hub/assistant/blip-assistant-host';
import { HubSessionRepository } from '../src/hub/assistant/hub-session-repository';
import { saveCodexCatalog, loadCodexCatalog } from '../src/hub/codex-model-catalog';
import { resolveNativeModel } from '../src/hub/assistant/resolve-native-model';
import { DEFAULT_COMPANION_SETTINGS, writeCompanionSettings, readCompanionSettings, companionSettingsResponse } from '../src/hub/companion/companion-config';
import { getHubSettingsRepository, resetHubSettingsRepositoryForTests } from '../src/host/hub-settings-repository';
import { withTempDroneDataDir } from './test-helpers';

const config = { provider: 'faux', model: 'large', thinkingLevel: 'off' as const, systemPrompt: 'Help.', tools: [], getApiKey: () => 'faux-key' };

async function isolated(run: (dir: string) => Promise<void>) {
  await withTempDroneDataDir('companion-recovery-', async (dir) => {
    resetHubSettingsRepositoryForTests();
    try { await run(dir); }
    finally { resetHubSettingsRepositoryForTests(); }
  });
}

test('newly discovered models have explicit unknown limits and cannot replace the working selection', async () => {
  await isolated(async () => {
    await writeCompanionSettings(DEFAULT_COMPANION_SETTINGS);
    await saveCodexCatalog([{ id: 'unknown-large-model', label: 'New model', reasoningLevels: ['high'] } as any]);
    await loadCodexCatalog();
    try {
      await expect(resolveNativeModel('codex', 'unknown-large-model')).rejects.toThrow('Token limits are unavailable');
      await expect(writeCompanionSettings({ ...DEFAULT_COMPANION_SETTINGS, model: 'unknown-large-model', thinkingLevel: 'high' }))
        .rejects.toThrow('Token limits are unavailable');
      expect((await readCompanionSettings()).model).toBe(DEFAULT_COMPANION_SETTINGS.model);
      const response = await companionSettingsResponse();
      expect(response.models.find((model) => model.id === 'unknown-large-model')).toMatchObject({
        contextWindow: null, unavailableReason: 'Token limits unavailable',
      });
      expect(response.models.find((model) => model.id === DEFAULT_COMPANION_SETTINGS.model)?.contextWindow).toBeGreaterThan(32768);
    } finally {
      // Clear discovery in this isolated store and restore the in-process catalog.
      await (await getHubSettingsRepository()).put('llm.codex-models', []);
      await loadCodexCatalog();
    }
  });
});

test('a conversation above 32k rejects an impossible switch and retains its working handle and full history', async () => {
  await isolated(async (dir) => {
    const faux = registerFauxProvider({ models: [
      { id: 'large', contextWindow: 272000, maxTokens: 4096 },
      { id: 'small', contextWindow: 32768, maxTokens: 4096 },
    ], tokensPerSecond: 0 });
    const resolver = spyOn(await loadBlipNodeRuntime(), 'resolveBlipModel').mockImplementation((_provider, id) => faux.getModel(id)!);
    const repository = new HubSessionRepository(path.join(dir, 'companion.sqlite'));
    const host = new BlipAssistantHost(async () => config, undefined, repository);
    try {
      await host.prepareThread('companion:test');
      const id = (await repository.sessionIdForThread('companion:test'))!;
      const state = await repository.load(id);
      await repository.appendMessage(state, { role: 'user', content: 'important '.repeat(18000), timestamp: Date.now() });
      const original = await repository.readMessages(state);
      await expect(host.ensureModelFits('companion:test', { provider: 'faux', model: 'small' })).rejects.toThrow('current model and conversation have been kept');
      expect(host.hasThreadHandle('companion:test')).toBe(true);
      expect((await repository.load(id)).modelId).toBe('large');
      expect(await repository.readMessages(state)).toEqual(original);
      await host.ensureModelFits('companion:test', { provider: 'faux', model: 'large' });
    } finally { await host.close(); resolver.mockRestore(); faux.unregister(); }
  });
});

test('detach and process shutdown retain the full transcript, checkpoint, and resumable binding', async () => {
  await isolated(async (dir) => {
    const faux = registerFauxProvider({ models: [{ id: 'large', contextWindow: 272000 }], tokensPerSecond: 0 });
    const databasePath = path.join(dir, 'companion.sqlite');
    const repository = new HubSessionRepository(databasePath);
    const host = new BlipAssistantHost(async () => config, undefined, repository);
    await host.prepareThread('companion:saved');
    const id = (await repository.sessionIdForThread('companion:saved'))!;
    const state = await repository.load(id);
    await repository.appendMessage(state, { role: 'user', content: 'Important original draft', timestamp: 1 });
    await repository.appendMessage(state, { role: 'toolResult', toolCallId: 'read', toolName: 'read_file', content: [{ type: 'text', text: 'Full source material' }], isError: false, timestamp: 2 });
    await repository.appendEntry(state, { type: 'compaction', id: 'checkpoint', createdAt: new Date().toISOString(), trigger: 'auto', summary: 'Draft checkpoint', tokensBefore: 1000, tokensAfterEstimate: 10 } as any);
    const transcript = await repository.readTranscript(state);
    await host.detachThread('companion:saved');
    expect(await repository.sessionIdForThread('companion:saved')).toBe(id);
    await host.prepareThread('companion:saved');
    await host.close(true);
    const reopened = new HubSessionRepository(databasePath);
    const restarted = new BlipAssistantHost(async () => config, undefined, reopened);
    try {
      await restarted.prepareThread('companion:saved');
      expect(await reopened.sessionIdForThread('companion:saved')).toBe(id);
      const restored = await reopened.load(id);
      expect((await reopened.readTranscript(restored)).filter((entry) => entry.type !== 'runtime_event')).toEqual(transcript.filter((entry) => entry.type !== 'runtime_event'));
      expect(JSON.stringify(await reopened.readModelMessages(restored))).toContain('Draft checkpoint');
      expect(JSON.stringify(await reopened.readMessages(restored))).toContain('Full source material');
    } finally { await restarted.close(); faux.unregister(); }
  });
});

test('a smaller model is allowed after a validated compaction while original material stays recoverable', async () => {
  await isolated(async (dir) => {
    const faux = registerFauxProvider({ models: [
      { id: 'large', contextWindow: 272000, maxTokens: 4096 },
      { id: 'small', contextWindow: 32768, maxTokens: 4096 },
    ], tokensPerSecond: 0 });
    faux.setResponses(Array.from({ length: 10 }, () => fauxAssistantMessage(summaryText('Preserve the important draft and continue editing.'))));
    const resolver = spyOn(await loadBlipNodeRuntime(), 'resolveBlipModel').mockImplementation((_provider, id) => faux.getModel(id)!);
    const repository = new HubSessionRepository(path.join(dir, 'companion.sqlite'));
    const host = new BlipAssistantHost(async () => config, undefined, repository);
    try {
      await host.prepareThread('companion:compact');
      const state = await repository.load((await repository.sessionIdForThread('companion:compact'))!);
      await repository.appendMessage(state, { role: 'user', content: 'Prepare the important draft.', timestamp: 1 });
      await repository.appendMessage(state, fauxAssistantMessage('Draft source material. '.repeat(6000)));
      await repository.appendMessage(state, { role: 'user', content: 'Continue editing.', timestamp: 3 });
      const original = await repository.readMessages(state);
      await host.ensureModelFits('companion:compact', { provider: 'faux', model: 'small' });
      expect((await repository.readTranscript(state)).some((entry) => entry.type === 'compaction')).toBe(true);
      expect(await repository.readMessages(state)).toEqual(original);
      expect(JSON.stringify(await repository.readModelMessages(state)).length).toBeLessThan(20000);
    } finally { await host.close(); resolver.mockRestore(); faux.unregister(); }
  });
});

test('settings save is atomic with the fit check and new prompts cannot race it', async () => {
  await isolated(async () => {
    await writeCompanionSettings(DEFAULT_COMPANION_SETTINGS);
    const checking = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const runtime = Object.create(CompanionRuntime.prototype) as CompanionRuntime;
    Object.assign(runtime, {
      contexts: new Map([['companion:active', { settings: DEFAULT_COMPANION_SETTINGS }]]),
      activeRunIds: new Set(), changingSettings: false,
      host: { ensureModelFits: async () => { checking.resolve(); await release.promise; throw new Error('Cannot fit; current model kept'); } },
    });
    const update = runtime.updateSettings({ ...DEFAULT_COMPANION_SETTINGS, provider: 'openai' });
    await Promise.race([checking.promise, update.then(() => { throw new Error('Settings saved without checking'); })]);
    expect((await readCompanionSettings()).provider).toBe('codex');
    await expect(runtime.run({ runId: 'racing' } as any)).rejects.toThrow('checking the model change');
    release.resolve();
    await expect(update).rejects.toThrow('Cannot fit');
    expect((await readCompanionSettings()).provider).toBe('codex');
    expect((runtime as any).changingSettings).toBe(false);
  });
});
