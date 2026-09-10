import { describe, expect, test } from 'bun:test';
import { discoverCodexModels } from '../src/hub/agent-model-catalog/codex-discovery';
import { AgentModelCatalogService } from '../src/hub/agent-model-catalog/service';
import { saveCodexCatalog } from '../src/hub/codex-model-catalog';
import { HubAssistantService } from '../src/hub/assistant';
import { BlipAssistantHost } from '../src/hub/assistant/blip-assistant-host';
import { withTempDroneDataDir } from './test-helpers';
import type { AgentModelCatalogCacheEntry, AgentModelCatalogRuntime } from '../src/hub/agent-model-catalog/types';

const model = { id: 'future-codex-model', label: 'Future Codex', reasoningLevels: ['low', 'xhigh'], defaultReasoningLevel: 'low' };
const astra = { ...model, id: 'gpt-6-astra', label: 'GPT-6 Astra' };

function catalogFixture() {
  let now = Date.parse('2026-09-10T10:00:00Z');
  let discoveries = 0;
  let fileReads = 0;
  let failure = false;
  let stored: AgentModelCatalogCacheEntry | null = null;
  const runtime: AgentModelCatalogRuntime = {
    async discoverCodexModels() {
      discoveries++;
      if (failure) throw new Error('offline');
      return [astra];
    },
    async runHost() {
      fileReads++;
      return { code: 0, stdout: JSON.stringify({ fetched_at: new Date(now).toISOString(), models: [{ slug: 'gpt-5.5' }] }) };
    },
    async runContainer() { throw new Error('unexpected container call'); },
    hostModelListCommand: () => null,
    timeoutMs: () => 1000,
    now: () => now,
  };
  const store = { read: () => stored, async write(entry: AgentModelCatalogCacheEntry) { stored = entry; } };
  return {
    service: new AgentModelCatalogService(runtime, store),
    request: { agentId: 'codex' as const, target: { runtime: 'container' as const, containerName: 'drone-a' } },
    advance(ms: number) { now += ms; },
    fail() { failure = true; },
    reload() { return new AgentModelCatalogService(runtime, store); },
    get discoveries() { return discoveries; },
    get fileReads() { return fileReads; },
  };
}
// Allow a background discovery (including persistence) to complete.
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('Codex discovery', () => {
  test('ordinary container discovery uses model/list even with a freshly written older file catalog', async () => {
    const fixture = catalogFixture();
    const result = await fixture.service.get(fixture.request);
    expect(result).toMatchObject({ source: 'live', models: [astra], installationFingerprint: 'host:codex-app-server' });
    expect(fixture.discoveries).toBe(1);

    // A newer file containing only GPT-5.5 must not remove Astra, even after restart.
    fixture.advance(60_000);
    expect((await fixture.reload().get(fixture.request)).models).toEqual([astra]);
    expect(fixture.fileReads).toBe(1);
    expect(fixture.discoveries).toBe(1);
  });

  test('automatically refreshes an expired live catalog without hiding its models', async () => {
    const fixture = catalogFixture();
    await fixture.service.get(fixture.request);
    fixture.advance(31 * 60_000);
    expect(await fixture.service.get(fixture.request)).toMatchObject({ source: 'cache', stale: true, models: [astra] });
    await flush();
    expect(fixture.discoveries).toBe(2);
    expect(fixture.fileReads).toBe(1);
    expect(await fixture.service.get(fixture.request)).not.toHaveProperty('stale');
  });

  test('failed refresh remains visibly stale on ordinary reads and backs off before retrying', async () => {
    const fixture = catalogFixture();
    await fixture.service.get(fixture.request);
    fixture.fail();
    expect(await fixture.service.get({ ...fixture.request, forceRefresh: true })).toMatchObject({ stale: true, error: 'offline', models: [astra] });
    expect(await fixture.service.get(fixture.request)).toMatchObject({ stale: true, error: 'offline', models: [astra] });
    expect(fixture.discoveries).toBe(2);
    fixture.advance(5 * 60_000);
    expect(await fixture.service.get(fixture.request)).toMatchObject({ stale: true, models: [astra] });
    await flush();
    expect(fixture.discoveries).toBe(3);
    expect((await fixture.service.get(fixture.request)).models).toEqual([astra]);
  });

  test('file fallback is persisted but must be verified after restart, regardless of its timestamp', async () => {
    const fixture = catalogFixture();
    fixture.fail();
    expect(await fixture.service.get(fixture.request)).toMatchObject({ source: 'cache', stale: true, error: 'offline' });
    await fixture.service.get(fixture.request);
    expect(fixture.discoveries).toBe(1);
    expect(fixture.fileReads).toBe(1);
    expect(await fixture.reload().get(fixture.request)).toMatchObject({ source: 'cache', stale: true, error: 'offline' });
    expect(fixture.discoveries).toBe(2);
    expect(fixture.fileReads).toBe(1);
  });

  test('reads every page and closes the connection without starting a turn', async () => {
    let calls = 0;
    let stopped = false;
    const models = await discoverCodexModels({
      async call(method, params) {
        expect(method).toBe('model/list');
        expect(params.includeHidden).toBe(false);
        calls++;
        if (calls === 1) return { data: [{ id: 'first', displayName: 'First' }], nextCursor: 'next' };
        expect(params.cursor).toBe('next');
        return { data: [{ id: model.id, displayName: model.label, supportedReasoningEfforts: [{ reasoningEffort: 'xhigh' }], defaultReasoningEffort: 'xhigh' }], nextCursor: null };
      },
      stop() { stopped = true; },
    });
    expect(models.map((entry) => entry.id)).toEqual(['first', model.id]);
    expect(models[1].reasoningLevels).toEqual(['xhigh']);
    expect(stopped).toBe(true);
  });

  test('forced refresh bypasses the file cache and reports cached fallback on failure', async () => {
    let fails = false;
    let discoveries = 0;
    const service = new AgentModelCatalogService({
      async discoverCodexModels() { discoveries++; if (fails) throw new Error('offline'); return [model]; },
      async runHost() { return { code: 0, stdout: JSON.stringify({ fetched_at: '2020-01-01T00:00:00Z', models: [{ slug: 'old' }] }) }; },
      async runContainer() { throw new Error('unexpected container call'); },
      hostModelListCommand: () => null, timeoutMs: () => 1000,
    });
    const request = { agentId: 'codex' as const, target: { runtime: 'host' as const }, forceRefresh: true };
    expect((await service.get(request)).models[0].id).toBe(model.id);
    fails = true;
    const result = await service.get(request);
    expect(discoveries).toBe(2);
    expect(result).toMatchObject({ source: 'cache', stale: true, error: 'offline' });
    expect(result.models[0].id).toBe(model.id);
    expect((await service.get({ ...request, forceRefresh: false })).models[0].id).toBe(model.id);
  });

  test('saved discovered models validate and initialize the built-in runtime after reload', async () => {
    await withTempDroneDataDir('codex-model-discovery-', async () => {
      await saveCodexCatalog([model]);
      const service = new HubAssistantService({ listDrones: async () => [] });
      await service.updateDefaultModel({ provider: 'codex', model: model.id, thinkingLevel: 'xhigh' });
      const reloaded = new HubAssistantService({ listDrones: async () => [] });
      expect((await reloaded.defaultSettings()).defaultModel.model).toBe(model.id);
      const host = new BlipAssistantHost(async () => ({ provider: 'codex', model: model.id, thinkingLevel: 'xhigh', systemPrompt: 'Test', tools: [] }));
      try { await host.prepareThread('new-codex-model'); expect(host.hasThreadHandle('new-codex-model')).toBe(true); }
      finally { await host.close(); }
    });
  });
});
