import { describe, expect, test } from 'bun:test';
import { WorkspaceTargetCatalog, type WorkspaceTarget } from '../src';

function target(id: string): WorkspaceTarget {
  return {
    descriptor: {
      id,
      kind: 'remote-device',
      label: id,
      rootLabel: id,
      capabilities: ['files.read'],
    },
    execute: async () => ({ content: [{ type: 'text', text: id }], details: {} }),
  };
}

describe('portable workspace target catalog', () => {
  test('persists active target selection without platform services', async () => {
    const catalog = new WorkspaceTargetCatalog([target('one'), target('two')]);
    expect(catalog.active()?.id).toBe('one');
    await catalog.setActiveForTool('two');
    expect(catalog.resolve().descriptor.id).toBe('two');
  });
});
