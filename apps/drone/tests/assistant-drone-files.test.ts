import { describe, expect, test } from 'bun:test';

import { HubAssistantService } from '../src/hub/assistant';
import { updateRegistry } from '../src/host/registry';
import { withTempDroneDataDir } from './test-helpers';

async function markDroneReady(id: string): Promise<void> {
  const now = new Date().toISOString();
  await updateRegistry((registry: any) => {
    registry.pending = registry.pending ?? {};
    registry.drones = registry.drones ?? {};
    registry.drones[id] = {
      id,
      name: id,
      runtime: 'container',
      repoPath: '/repo',
      createdAt: now,
      chats: { default: { createdAt: now, turns: [] } },
    };
  });
}

describe('assistant drone workspace target execution', () => {
  test('routes canonical read and write tools through the scoped drone executor', async () => {
    await withTempDroneDataDir('assistant-drone-workspace-', async () => {
      await markDroneReady('drone-a');
      const writes: any[] = [];
      const service = new HubAssistantService({
        listDrones: async () => [{ id: 'drone-a', name: 'Drone A', group: null, runtime: 'container', repoPath: '/repo', status: 'ready', chats: ['default'] }],
        readDroneFile: async ({ droneId, path }) => ({ droneId, path, relativePath: path, kind: 'text', content: 'hello' }),
        writeDroneFile: async (input) => {
          writes.push(input);
          return { droneId: input.droneId, path: input.path, relativePath: input.path, size: input.content.length };
        },
      });
      const created = await service.createThread({ title: 'files' });
      const threadId = created.activeThreadId;
      await service.updateAccessScope({ threadId, readMode: 'selected', writeMode: 'selected', droneIds: ['drone-a'] });

      const read = await service.executeDroneWorkspaceTool(threadId, 'drone-a', { tool: 'read_file', args: { path: 'src/a.ts' } });
      const write = await service.executeDroneWorkspaceTool(threadId, 'drone-a', { tool: 'write_file', args: { path: 'src/a.ts', content: 'updated' } });
      expect(read.details.content).toBe('hello');
      expect(write.details.size).toBe(7);
      expect(writes).toEqual([{ droneId: 'drone-a', path: 'src/a.ts', content: 'updated' }]);
    });
  });

  test('rejects writes outside the selected write scope before invoking the executor', async () => {
    await withTempDroneDataDir('assistant-drone-workspace-scope-', async () => {
      await markDroneReady('drone-a');
      await markDroneReady('drone-b');
      let writeCalls = 0;
      const service = new HubAssistantService({
        listDrones: async () => [],
        writeDroneFile: async ({ droneId, path, content }) => {
          writeCalls += 1;
          return { droneId, path, size: content.length };
        },
      });
      const created = await service.createThread({ title: 'files' });
      const threadId = created.activeThreadId;
      await service.updateAccessScope({ threadId, readMode: 'all', writeMode: 'selected', droneIds: ['drone-a'] });

      await expect(service.executeDroneWorkspaceTool(threadId, 'drone-b', {
        tool: 'write_file',
        args: { path: 'blocked.txt', content: 'no' },
      })).rejects.toThrow('write scope does not include drone');
      expect(writeCalls).toBe(0);
    });
  });

  test('keeps write-only drones available as workspace destinations', async () => {
    await withTempDroneDataDir('assistant-drone-write-only-', async () => {
      await markDroneReady('drone-a');
      await markDroneReady('drone-b');
      const drones = [
        {
          id: 'drone-a',
          name: 'Drone A',
          group: null,
          runtime: 'container',
          repoPath: '/repo-a',
          status: 'ready',
          chats: ['default'],
        },
        {
          id: 'drone-b',
          name: 'Drone B',
          group: null,
          runtime: 'container',
          repoPath: '/repo-b',
          status: 'ready',
          chats: ['default'],
        },
      ];
      const service = new HubAssistantService({
        listDrones: async () => drones,
      });
      const created = await service.createThread({ title: 'write only' });
      const threadId = created.activeThreadId;
      await service.updateAccessScope({
        threadId,
        readMode: 'selected',
        writeMode: 'all',
        droneIds: ['drone-a'],
      });

      expect(await service.visibleDrones(threadId)).toEqual([drones[0]]);
      expect(await service.workspaceDrones(threadId)).toEqual([
        { ...drones[0], canRead: true, canWrite: true },
        { ...drones[1], canRead: false, canWrite: true },
      ]);
    });
  });
});
