import { describe, expect, test } from 'bun:test';
import { suggestAndRenameRemoteDroneFromPrompt } from '../src/remote/remote-drone-auto-rename';

describe('remote drone auto rename', () => {
  test('suggests a name from the prompt and renames the pending drone', async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const requestJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
      if (url === '/api/drones/name-from-message') return { ok: true, name: 'fix-remote-names' } as T;
      return { ok: true, id: 'drone-1', newName: 'fix-remote-names' } as T;
    };

    const result = await suggestAndRenameRemoteDroneFromPrompt({
      droneId: 'drone-1',
      prompt: 'Fix remote drone names',
      currentName: 'Untitled',
      requestJson,
    });

    expect(result).toEqual({ ok: true, name: 'fix-remote-names' });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      url: '/api/drones/name-from-message',
      body: {
        message: 'Fix remote drone names',
        source: 'remote-create-auto-rename',
        droneId: 'drone-1',
      },
    });
    expect(calls[1]).toEqual({
      url: '/api/drones/drone-1/rename',
      body: {
        newName: 'fix-remote-names',
        source: 'remote-create-auto-rename',
        attempt: 1,
        suggestedBase: 'fix-remote-names',
      },
    });
  });

  test('tries a numbered candidate when the suggested name already exists', async () => {
    const renameBodies: any[] = [];
    const requestJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
      if (url === '/api/drones/name-from-message') return { ok: true, name: 'fix-remote-names' } as T;
      const body = JSON.parse(String(init?.body ?? '{}'));
      renameBodies.push(body);
      if (body.newName === 'fix-remote-names') throw new Error('drone already exists: fix-remote-names');
      return { ok: true, id: 'drone-1', newName: body.newName } as T;
    };

    const result = await suggestAndRenameRemoteDroneFromPrompt({
      droneId: 'drone-1',
      prompt: 'Fix remote drone names',
      requestJson,
    });

    expect(result).toEqual({ ok: true, name: 'fix-remote-names (2)' });
    expect(renameBodies.map((body) => body.newName)).toEqual(['fix-remote-names', 'fix-remote-names (2)']);
  });
});
