import { expect, test } from 'bun:test';
import { isGranted } from '@drone/device-protocol';
import { companionBehaviorSettings } from '../src/hub/device-mesh/companion-behavior-settings';
import { readCompanionSettings } from '../src/hub/companion/companion-config';
import { CompanionLiveMeshSessions } from '../src/hub/device-mesh/CompanionLiveMeshSessions';
import { writeCompanionLiveSettings } from '../src/hub/companion/companion-live-settings';
import { withTempDroneDataDir } from './test-helpers';

test('behavior settings patch only edited fields; instructions reject stale revisions', async () => {
  await withTempDroneDataDir('mobile-behavior-', async () => {
    const original = await readCompanionSettings();
    await companionBehaviorSettings('behavior.settings.update', { promptDeliveryMode: 'queue', model: 'ignored', systemPrompt: 'Shared task prompt' });
    const saved = await readCompanionSettings();
    expect(saved).toEqual({ ...original, promptDeliveryMode: 'queue', systemPrompt: 'Shared task prompt' });
    await expect(companionBehaviorSettings('behavior.settings.update', { promptDeliveryMode: 'invalid' })).rejects.toThrow('ASAP or Queue');
    await expect(companionBehaviorSettings('behavior.settings.update', { enabledTools: ['unknown'] })).rejects.toThrow('unknown Companion tools');
    const first = await companionBehaviorSettings('instructions.get', {}) as any;
    const updated = await companionBehaviorSettings('instructions.update', { content: 'Prefer short replies', revision: first.instructions.revision }) as any;
    expect(updated.instructions.content).toBe('Prefer short replies');
    await expect(companionBehaviorSettings('instructions.update', { content: 'Stale', revision: first.instructions.revision })).rejects.toThrow('changed');
    expect((await companionBehaviorSettings('instructions.get', {}) as any).instructions.content).toBe('Prefer short replies');
  });
});

test('running Companion and editing models do not grant behavior or instructions access', () => {
  const grants = [{ capability: 'companion', version: 1, operations: ['run.start', 'model.settings.get', 'model.settings.update'] }];
  for (const operation of ['behavior.settings.get', 'behavior.settings.update', 'instructions.get', 'instructions.update']) {
    expect(isGranted(grants, 'companion', 1, operation)).toBe(false);
    expect(isGranted([{ capability: 'companion', version: 1, operations: [operation] }], 'companion', 1, operation)).toBe(true);
  }
});

test('mobile exposes a legacy JEV preference, rejects its startup, and explicitly selects Live or Normal', async () => {
  await withTempDroneDataDir('mobile-voice-modes-', async () => {
    const live = new CompanionLiveMeshSessions({ emit: async () => {} });
    try {
      await writeCompanionLiveSettings({ enabled: true, mode: 'jev' });
      expect(await live.invoke('phone', 'live.settings.get', {})).toEqual({ enabled: true, mode: 'jev' });
      await expect(live.invoke('phone', 'live.start', { sessionId: 'session' })).rejects.toThrow('does not support');
      expect(await live.invoke('phone', 'live.settings.update', { enabled: true, mode: 'live' })).toEqual({ enabled: true, mode: 'live' });
      expect(await live.invoke('phone', 'live.settings.update', { enabled: false, mode: 'live' })).toEqual({ enabled: false, mode: 'live' });
      await expect(live.invoke('phone', 'live.settings.update', { enabled: true, mode: 'jev' })).rejects.toThrow('Normal and Live');
    } finally { live.close(); }
  });
});
