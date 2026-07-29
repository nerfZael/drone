import { describe, expect, test } from 'bun:test';
import { applyPatchHunks, parsePatch } from '@blip/tools';

import { HubAssistantService } from '../src/hub/assistant';
import { updateRegistry } from '../src/host/registry';
import { ensureTestNativeChat } from './native-chat-test-helpers';
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
        listDrones: async () => [
          {
            id: 'drone-a',
            name: 'Drone A',
            group: null,
            runtime: 'container',
            repoPath: '/repo',
            status: 'ready',
            chats: ['default'],
          },
        ],
        readDroneFile: async ({ droneId, path }) => ({
          droneId,
          path,
          relativePath: path,
          kind: 'text',
          content: 'hello',
        }),
        writeDroneFile: async (input) => {
          writes.push(input);
          return {
            droneId: input.droneId,
            path: input.path,
            relativePath: input.path,
            size: input.content.length,
          };
        },
      });
      const created = await ensureTestNativeChat(service, { chatName: 'files' });
      const threadId = created.chatId;
      await service.updateAccessScope({
        threadId,
        readMode: 'selected',
        writeMode: 'selected',
        droneIds: ['drone-a'],
      });

      const read = await service.executeDroneWorkspaceTool(threadId, 'drone-a', {
        tool: 'read_file',
        args: { path: 'src/a.ts' },
      });
      const write = await service.executeDroneWorkspaceTool(threadId, 'drone-a', {
        tool: 'write_file',
        args: { path: 'src/a.ts', content: 'updated' },
      });
      expect(read.details.content).toBe('hello');
      expect(write.details.size).toBe(7);
      expect(writes).toEqual([{ droneId: 'drone-a', path: 'src/a.ts', content: 'updated' }]);
    });
  });

  test('sends patch mutations through one batch callback', async () => {
    await withTempDroneDataDir('assistant-drone-patch-batch-', async () => {
      await markDroneReady('drone-a');
      const batches: any[] = [];
      const service = new HubAssistantService({
        listDrones: async () => [],
        readDroneFile: async ({ droneId, path }) => ({
          droneId,
          path,
          relativePath: path,
          kind: 'text',
          content: 'before',
        }),
        statDronePath: async ({ droneId, path }) => ({ droneId, path, exists: false }),
        batchDroneFiles: async (input) => {
          batches.push(input);
        },
      });
      const created = await ensureTestNativeChat(service, { chatName: 'batch patch' });
      await service.updateAccessScope({
        threadId: created.chatId,
        readMode: 'selected',
        writeMode: 'selected',
        droneIds: ['drone-a'],
      });

      await service.executeDroneWorkspaceTool(
        created.chatId,
        'drone-a',
        {
          tool: 'apply_patch',
          args: {
            patch: ['*** Begin Patch', '*** Add File: added.txt', '+added', '*** End Patch'].join(
              '\n',
            ),
          },
        },
        { parse: parsePatch, applyHunks: applyPatchHunks },
      );

      expect(batches).toEqual([
        {
          droneId: 'drone-a',
          operations: [{ type: 'write', path: 'added.txt', content: 'added' }],
        },
      ]);
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
      const created = await ensureTestNativeChat(service, { chatName: 'files' });
      const threadId = created.chatId;
      await service.updateAccessScope({
        threadId,
        readMode: 'all',
        writeMode: 'selected',
        droneIds: ['drone-a'],
      });

      await expect(
        service.executeDroneWorkspaceTool(threadId, 'drone-b', {
          tool: 'write_file',
          args: { path: 'blocked.txt', content: 'no' },
        }),
      ).rejects.toThrow('write scope does not include drone');
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
      const created = await ensureTestNativeChat(service, { chatName: 'write only' });
      const threadId = created.chatId;
      await service.updateAccessScope({
        threadId,
        readMode: 'selected',
        writeMode: 'all',
        droneIds: ['drone-a'],
      });

      expect(await service.visibleDrones(threadId)).toEqual([drones[0]]);
      expect(await service.workspaceDrones(threadId)).toEqual([
        { ...drones[0], canRead: true, canWrite: true, canExecute: true },
        { ...drones[1], canRead: false, canWrite: true, canExecute: true },
      ]);
    });
  });

  test('uses execute scope rather than write scope for bash', async () => {
    await withTempDroneDataDir('assistant-drone-execute-scope-', async () => {
      await markDroneReady('drone-a');
      await markDroneReady('drone-b');
      const executions: any[] = [];
      const service = new HubAssistantService({
        listDrones: async () => [],
        runDroneBash: async (input) => {
          executions.push(input);
          return { droneId: input.droneId, command: input.command, code: 0 } as any;
        },
      });
      const created = await ensureTestNativeChat(service, { chatName: 'execute' });
      const threadId = created.chatId;
      await service.updateAccessScope({
        threadId,
        readMode: 'all',
        writeMode: 'selected',
        executeMode: 'selected',
        droneIds: ['drone-b'],
      });

      await expect(
        service.executeDroneWorkspaceTool(threadId, 'drone-a', {
          tool: 'bash',
          args: { command: 'pwd' },
        }),
      ).rejects.toThrow('execute scope does not include drone');
      await service.executeDroneWorkspaceTool(threadId, 'drone-b', {
        tool: 'bash',
        args: { command: 'pwd' },
      });
      expect(executions).toHaveLength(1);
      expect(executions[0].droneId).toBe('drone-b');
    });
  });

  test('preflights remote workspace bash against the resolved target', async () => {
    await withTempDroneDataDir('assistant-remote-workspace-bash-', async () => {
      const service = new HubAssistantService({ listDrones: async () => [] });
      const created = await ensureTestNativeChat(service, { chatName: 'remote execute' });
      const threadId = created.chatId;
      await service.updateThread(threadId, { autoApprove: true });

      await expect(
        service.preflightBlipTool(threadId, 'bash', 'call-remote', {
          command: 'pwd',
          workspaceTarget: {
            id: 'remote:desktop:project',
            kind: 'remote-device',
            label: 'Desktop · Project',
          },
        }),
      ).resolves.toEqual({ status: 'allow' });
    });
  });

  test('enforces native read, write, and execute access before tool calls', async () => {
    await withTempDroneDataDir('assistant-agent-access-', async () => {
      const service = new HubAssistantService({ listDrones: async () => [] });
      const created = await ensureTestNativeChat(service, { chatName: 'agent access' });
      const threadId = created.chatId;

      await service.updateThread(threadId, { agentPermissionMode: 'read-only' });
      await expect(
        service.preflightBlipTool(
          threadId,
          'drone_hub__create_drone',
          'call-create',
          {},
        ),
      ).resolves.toMatchObject({ status: 'deny' });
      await expect(
        service.preflightBlipTool(threadId, 'transfer_files', 'call-transfer', {}),
      ).resolves.toMatchObject({ status: 'deny' });
      await expect(
        service.preflightBlipTool(threadId, 'bash', 'call-read-bash', {
          command: 'pwd',
          workspaceTarget: { id: 'remote:test', label: 'Test' },
        }),
      ).resolves.toMatchObject({ status: 'deny' });

      await service.updateThread(threadId, { agentPermissionMode: 'workspace-write' });
      await expect(
        service.preflightBlipTool(threadId, 'bash', 'call-write-bash', {
          command: 'pwd',
          workspaceTarget: { id: 'remote:test', label: 'Test' },
        }),
      ).resolves.toMatchObject({ status: 'deny' });
    });
  });

  test('returns a durable suspension even when the original request signal is aborted', async () => {
    await withTempDroneDataDir('assistant-aborted-bash-approval-', async () => {
      const service = new HubAssistantService({ listDrones: async () => [] });
      const created = await ensureTestNativeChat(service, { chatName: 'aborted execute' });
      const threadId = created.chatId;
      const controller = new AbortController();
      controller.abort();

      await expect(
        service.preflightBlipTool(
          threadId,
          'bash',
          'call-aborted',
          {
            command: 'pwd',
            workspaceTarget: {
              id: 'remote:desktop:project',
              kind: 'remote-device',
              label: 'Desktop · Project',
            },
          },
          controller.signal,
        ),
      ).resolves.toMatchObject({
        status: 'suspend',
        reason: 'Approval required for Execute Bash command.',
      });
    });
  });

  test('delegates a durable approval decision after a suspension event restores the cache', async () => {
    await withTempDroneDataDir('assistant-denied-approval-stop-', async () => {
      const service = new HubAssistantService({ listDrones: async () => [] });
      const created = await ensureTestNativeChat(service, { chatName: 'deny and stop' });
      const threadId = created.chatId;
      const preflight = await service.preflightBlipTool(threadId, 'bash', 'call-denied', {
        command: 'pwd',
        workspaceTarget: {
          id: 'remote:desktop:project',
          kind: 'remote-device',
          label: 'Desktop · Project',
        },
      });
      expect(preflight.status).toBe('suspend');
      const suspensionId = 'sus-restored';
      await service.notifyRuntimeEvent(threadId, {
        type: 'tool_call_suspended',
        suspensionId,
        callId: 'call-denied',
        tool: 'bash',
        reason: preflight.status === 'suspend' ? preflight.reason : '',
        details: preflight.status === 'suspend' ? preflight.details : undefined,
        timestamp: '2026-07-27T00:00:00.000Z',
        recoveryRequired: true,
      });
      const approval = (await service.threadSnapshot(threadId)).pendingApprovals[0]!;
      const decisions: Array<{ threadId: string; approvalId: string; approved: boolean }> = [];
      service.setApprovalDecisionDelegate(async (resolvedThreadId, approvalId, approved) => {
        decisions.push({ threadId: resolvedThreadId, approvalId, approved });
        await service.notifyRuntimeEvent(resolvedThreadId, {
          type: 'tool_call_resolved',
          suspensionId: approvalId,
          status: 'denied',
        });
      });
      await service.approve(approval.id, false, threadId);

      expect(approval.id).toBe(suspensionId);
      expect(decisions).toEqual([{ threadId, approvalId: suspensionId, approved: false }]);
      expect((await service.threadSnapshot(threadId)).pendingApprovals).toEqual([]);
    });
  });
});
