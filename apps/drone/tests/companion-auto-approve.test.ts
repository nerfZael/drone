import { expect, test } from 'bun:test';
import { readCompanionAutoApproveSettings, writeCompanionAutoApproveSettings } from '../src/hub/companion/companion-auto-approve-settings';
import { getHubSettingsRepository, resetHubSettingsRepositoryForTests } from '../src/host/hub-settings-repository';
import { withTempDroneDataDir } from './test-helpers';
import { HubRouter } from '../src/hub/hub-router';
import { registerCompanionRoutes } from '../src/hub/companion/companion-routes';

test('Auto-approve defaults off, survives reopening storage, and does not overwrite model settings', async () => {
  await withTempDroneDataDir('companion-auto-approve-', async () => {
    const repository = await getHubSettingsRepository();
    const backend = { provider: 'gemini', model: 'chosen-model', thinkingLevel: 'medium' };
    await repository.put('companion', backend);
    expect(await readCompanionAutoApproveSettings()).toEqual({ enabled: false });
    await writeCompanionAutoApproveSettings({ enabled: true });
    resetHubSettingsRepositoryForTests();
    expect(await readCompanionAutoApproveSettings()).toEqual({ enabled: true });
    expect((await getHubSettingsRepository()).get('companion')?.value).toEqual(backend);
    await expect(writeCompanionAutoApproveSettings({ enabled: 'false' })).rejects.toThrow('boolean');
    await writeCompanionAutoApproveSettings({ enabled: false });
    expect(await readCompanionAutoApproveSettings()).toEqual({ enabled: false });
  });
});

test('Auto-approve settings routes validate writes and return persisted state', async () => {
  await withTempDroneDataDir('companion-auto-approve-routes-', async () => {
    let body: unknown;
    let result: { status: number; body: any };
    const router = new HubRouter((_res, status, value) => { result = { status, body: value }; }, async () => body);
    registerCompanionRoutes(router);
    const request = async (method: string, value?: unknown) => {
      body = value;
      await router.handle({ method } as any, {} as any, new URL('http://hub.test/api/settings/companion/auto-approve'));
      return result!;
    };
    expect((await request('GET')).body.enabled).toBe(false);
    expect((await request('PUT', { enabled: true })).body.enabled).toBe(true);
    expect((await request('PUT', {})).status).toBe(400);
    expect((await request('GET')).body.enabled).toBe(true);
  });
});

