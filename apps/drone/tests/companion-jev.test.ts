import { expect, test } from 'bun:test';
import { readCompanionLiveSettings, writeCompanionLiveSettings } from '../src/hub/companion/companion-live-settings';
import { upsertStoredProviderApiKey, resolveAiGatewayApiKeySettings, clearStoredProviderApiKey } from '../src/hub/hub-settings';
import { withTempDroneDataDir } from './test-helpers';
import { HubRouter } from '../src/hub/hub-router';
import { registerSettingsRoutes } from '../src/hub/routes/settings-routes';

test('Jev instructions and mode persist independently of GPT-Live instructions', async () => {
  await withTempDroneDataDir('jev-settings-', async () => {
    await writeCompanionLiveSettings({ enabled: true, mode: 'jev', jevSystemPrompt: 'Send only explicit requests.', systemPrompt: 'Speak briefly.' });
    await writeCompanionLiveSettings({ enabled: false });
    expect(await readCompanionLiveSettings()).toMatchObject({ enabled: false, mode: 'jev', jevSystemPrompt: 'Send only explicit requests.', systemPrompt: 'Speak briefly.' });
    await expect(writeCompanionLiveSettings({ mode: 'invalid' })).rejects.toThrow();
    await expect(writeCompanionLiveSettings({ jevSystemPrompt: '' })).rejects.toThrow();
    await expect(writeCompanionLiveSettings({ jevSystemPrompt: 'x'.repeat(8001) })).rejects.toThrow();
  });
});

test('Gateway credentials use their own saved setting', async () => {
  await withTempDroneDataDir('gateway-settings-', async () => {
    await upsertStoredProviderApiKey('ai-gateway', 'test-only-gateway-key');
    expect(await resolveAiGatewayApiKeySettings()).toMatchObject({ source: 'settings', apiKey: 'test-only-gateway-key' });
    await clearStoredProviderApiKey('ai-gateway');
  });
});

test('Gateway settings never reveal a saved credential, including reveal requests', async () => {
  await withTempDroneDataDir('gateway-routes-', async () => {
    let body: unknown;
    let result: any;
    const router = new HubRouter((_res, status, value) => { result = { status, body: value }; }, async () => body);
    registerSettingsRoutes(router, {
      upsertStoredProviderApiKey, clearStoredProviderApiKey,
      normalizeApiKey: (value: unknown) => typeof value === 'string' ? value.trim() : '',
    } as any);
    for (const method of ['POST', 'GET', 'DELETE']) {
      body = { apiKey: 'test-only-gateway-key' };
      await router.handle({ method } as any, {} as any, new URL('http://hub.test/api/settings/ai-gateway?reveal=1'));
      expect(result.status).toBe(200);
      expect(result.body.apiKey).toBeUndefined();
      expect(result.body.keyHint).toBeNull();
      expect(JSON.stringify(result)).not.toContain('test-only-gateway-key');
      if (method !== 'DELETE') expect(result.body.hasKey).toBe(true);
    }
  });
});
