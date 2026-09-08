import { expect, test } from 'bun:test';
import { CompanionRuntime } from '../src/hub/companion/companion-runtime';
import { DEFAULT_COMPANION_SETTINGS, normalizeCompanionSettings } from '../src/hub/companion/companion-config';

test('recorder patch tools require recorder reads', () => {
  expect(normalizeCompanionSettings({ ...DEFAULT_COMPANION_SETTINGS, enabledTools: ['apply_recorder_patch'] }).enabledTools)
    .toEqual(['read_recorder', 'apply_recorder_patch']);
});

test('recorder patches require a fresh recorder snapshot and the exact path', async () => {
  const delivered: unknown[] = [];
  const context = {
    settings: DEFAULT_COMPANION_SETTINGS,
    snapshots: new Map(),
    callBrowser: async (name: string, args: unknown) => {
      if (name.startsWith('read_')) return {
        targetId: 'recorder:1', path: 'recorder.txt', revision: '1', mode: 'edit', content: 'original',
      };
      delivered.push(args);
      return { ok: true, revision: '2' };
    },
  };
  const runtime = Object.create(CompanionRuntime.prototype);
  const tools = await runtime.customTools(context, []);
  const read = tools.find((tool: any) => tool.name === 'read_recorder');
  const composerRead = tools.find((tool: any) => tool.name === 'read_active_composer');
  const patch = tools.find((tool: any) => tool.name === 'apply_recorder_patch');
  const args = {
    targetId: 'recorder:1', baseRevision: '1',
    patch: '*** Begin Patch\n*** Update File: recorder.txt\n@@\n-original\n+updated\n*** End Patch',
  };
  await expect(patch.execute('unread', args)).rejects.toThrow('was not read');
  await composerRead.execute('composer', {});
  await expect(patch.execute('wrong-kind', args)).rejects.toThrow('was not read');
  await read.execute('read', {});
  await expect(patch.execute('wrong-path', { ...args, patch: args.patch.replace('recorder.txt', 'other.txt') }))
    .rejects.toThrow('path does not match');
  await expect(patch.execute('wrong-revision', { ...args, baseRevision: '0' })).rejects.toThrow('stale');
  expect(delivered).toHaveLength(0);
  await patch.execute('valid', args);
  expect(delivered).toEqual([{ targetId: 'recorder:1', baseRevision: '1', content: 'updated' }]);
  await expect(patch.execute('replay', args)).rejects.toThrow('stale');
});


test('upgrades existing default tools while preserving explicit tool choices', () => {
  const oldTools = DEFAULT_COMPANION_SETTINGS.enabledTools.filter(
    (name) => name !== 'read_recorder' && name !== 'apply_recorder_patch',
  );
  expect(normalizeCompanionSettings({ ...DEFAULT_COMPANION_SETTINGS, schemaVersion: 4, enabledTools: oldTools }).enabledTools)
    .toEqual(DEFAULT_COMPANION_SETTINGS.enabledTools);
  expect(normalizeCompanionSettings({ ...DEFAULT_COMPANION_SETTINGS, enabledTools: oldTools }).enabledTools)
    .toEqual(oldTools);
});
