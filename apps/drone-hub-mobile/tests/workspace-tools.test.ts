import { describe, expect, test } from 'bun:test';
import {
  createWorkspaceToolRuntime,
  executeWorkspaceTool,
  workspaceToolsForThread,
} from '../src/local-assistant/workspace-tools';
import type { LocalAssistantThread } from '../src/local-assistant/local-assistant-types';

describe('phone assistant workspace tools', () => {
  test('transfers between a readable source and a write-only destination with retry progress', async () => {
    const thread = {
      id: 'mobile_transfer',
      title: 'Transfer',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: 'gpt-test',
      thinkingLevel: 'low' as const,
      status: 'idle' as const,
      error: null,
      messages: [],
      workspaceTargets: [
        {
          targetDeviceId: 'source_device',
          deviceName: 'Laptop',
          workspaceId: 'source',
          workspaceName: 'Source',
          read: true,
          write: false,
          execute: false,
        },
        {
          targetDeviceId: 'destination_device',
          deviceName: 'Server',
          workspaceId: 'destination',
          workspaceName: 'Drop box',
          read: false,
          write: true,
          execute: false,
        },
      ],
    };
    const runtime = createWorkspaceToolRuntime(
      thread,
      async (deviceId, _capability, operation, payload: any) => {
        if (operation === 'files.transfer.stat') return { type: 'file', size: 3, mtimeMs: 10 };
        if (operation === 'files.transfer.read') {
          if (!(runtime as any).__retried) {
            (runtime as any).__retried = true;
            throw new Error('connection closed');
          }
          return { download: { url: 'https://source/file', token: 'secret', size: 3 } };
        }
        if (operation === 'files.transfer.prepare') {
          expect(deviceId).toBe('destination_device');
          expect(payload.workspaceId).toBe('destination');
          return {
            offset: 0,
            upload: { url: 'https://destination/file', token: 'secret', size: 3 },
          };
        }
        if (operation === 'files.transfer.commit') return { ok: true };
        throw new Error(`unexpected operation: ${operation}`);
      },
      {
        fetchImpl: (async () => new Response('abc')) as typeof fetch,
        createSink: async () => ({
          write: async (bytes) => {
            expect(new TextDecoder().decode(bytes)).toBe('abc');
          },
          finish: async () => 3,
          close: async () => undefined,
        }),
      },
    );
    expect(runtime.tools.map((tool) => tool.function.name)).toContain('transfer_files');
    const updates: any[] = [];
    const result = await runtime.execute({
      name: 'transfer_files',
      args: {
        sourceTarget: 'Laptop / Source',
        sourcePath: 'a.bin',
        destinationTarget: 'Server / Drop box',
        destinationPath: 'incoming/a.bin',
      },
      onOutput: (update) => {
        updates.push(update.details);
      },
    });
    expect(result.details).toMatchObject({ phase: 'completed', retries: 1, transferredBytes: 3 });
    expect(updates.some((update) => update.files?.[0]?.status === 'retrying')).toBe(true);
  });

  test('binds every request to the selected destination workspace', async () => {
    const thread: LocalAssistantThread = {
      id: 'mobile_thread_1',
      title: 'Phone thread',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: 'gpt-test',
      thinkingLevel: 'low',
      status: 'idle',
      error: null,
      workspaceTargets: [
        {
          targetDeviceId: 'desktop_1',
          deviceName: 'Desktop',
          workspaceId: 'main-project',
          workspaceName: 'Main project',
          read: true,
          write: true,
          execute: true,
        },
      ],
      messages: [],
    };
    let call: any;
    const result = await executeWorkspaceTool({
      thread,
      name: 'write_file',
      args: { path: 'a.txt', content: 'hello', mode: 'overwrite' },
      request: async (...args) => {
        call = args;
        return { text: 'wrote a.txt', details: { path: 'a.txt' } };
      },
    });

    expect(call).toEqual([
      'desktop_1',
      'workspace',
      'files.write',
      {
        path: 'a.txt',
        content: 'hello',
        mode: 'overwrite',
        workspaceId: 'main-project',
      },
    ]);
    expect(result.text).toBe('wrote a.txt');
  });

  test('routes commands and file tools across multiple named workspaces', async () => {
    const thread = {
      id: 'mobile_thread_2',
      title: 'Multi workspace',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: 'gpt-test',
      thinkingLevel: 'low' as const,
      status: 'idle' as const,
      error: null,
      workspaceTargets: [
        {
          targetDeviceId: 'desktop_1',
          deviceName: 'Desktop',
          workspaceId: 'project-a',
          workspaceName: 'Project A',
          read: true,
          write: false,
          execute: false,
        },
        {
          targetDeviceId: 'server_1',
          deviceName: 'Server',
          workspaceId: 'project-b',
          workspaceName: 'Project B',
          read: false,
          write: false,
          execute: true,
        },
      ],
      messages: [],
    };
    const tools = workspaceToolsForThread(thread);
    expect(tools.map((tool) => tool.function.name)).toEqual([
      'list_targets',
      'set_target',
      'list_files',
      'read_file',
      'search_files',
      'bash',
    ]);
    const calls: unknown[][] = [];
    await executeWorkspaceTool({
      thread,
      name: 'bash',
      args: { command: 'pwd', workspace: 'Server / Project B' },
      request: async (...args) => {
        calls.push(args);
        if (args[2] === 'commands.start')
          return {
            jobId: 'command_1',
            workspaceId: 'project-b',
            status: 'running',
          };
        return {
          jobId: 'command_1',
          workspaceId: 'project-b',
          status: 'completed',
          cursor: 1,
          chunks: [{ cursor: 0, stream: 'stdout', text: '/srv/project-b\n' }],
        };
      },
    });
    expect(calls.map((call) => call.slice(0, 4))).toEqual([
      ['server_1', 'workspace', 'commands.start', { command: 'pwd', workspaceId: 'project-b' }],
      [
        'server_1',
        'workspace',
        'commands.output',
        { workspaceId: 'project-b', jobId: 'command_1', cursor: 0, waitMs: 15_000 },
      ],
    ]);
  });

  test('disambiguates colliding display names without exposing device ids', () => {
    const thread = {
      id: 'mobile_thread_3',
      title: 'Ambiguous names',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: 'gpt-test',
      thinkingLevel: 'low' as const,
      status: 'idle' as const,
      error: null,
      workspaceTargets: [
        {
          targetDeviceId: 'hidden_device_1',
          deviceName: 'A / B',
          workspaceId: 'hidden_workspace_1',
          workspaceName: 'C',
          read: true,
          write: false,
          execute: false,
        },
        {
          targetDeviceId: 'hidden_device_2',
          deviceName: 'A',
          workspaceId: 'hidden_workspace_2',
          workspaceName: 'B / C',
          read: true,
          write: false,
          execute: false,
        },
      ],
      messages: [],
    };
    const listFiles = workspaceToolsForThread(thread).find(
      (candidate) => candidate.function.name === 'list_files',
    );
    expect((listFiles?.function.parameters as any).properties.target.enum).toEqual([
      'A / B / C (1)',
      'A / B / C (2)',
    ]);
    expect(JSON.stringify(listFiles)).not.toContain('hidden_device');
    expect(JSON.stringify(listFiles)).not.toContain('hidden_workspace');
  });

  test('shares Blip target selection semantics across consecutive phone tool calls', async () => {
    const thread = {
      id: 'mobile_thread_4',
      title: 'Target selection',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: 'gpt-test',
      thinkingLevel: 'low' as const,
      status: 'idle' as const,
      error: null,
      workspaceTargets: [
        {
          targetDeviceId: 'desktop_1',
          deviceName: 'Desktop',
          workspaceId: 'project-a',
          workspaceName: 'Project A',
          read: true,
          write: false,
          execute: false,
        },
        {
          targetDeviceId: 'server_1',
          deviceName: 'Server',
          workspaceId: 'project-b',
          workspaceName: 'Project B',
          read: true,
          write: false,
          execute: false,
        },
      ],
      messages: [],
    };
    const calls: unknown[][] = [];
    const runtime = createWorkspaceToolRuntime(thread, async (...args) => {
      calls.push(args);
      return { text: 'ok', details: {} };
    });
    await runtime.execute({ name: 'set_target', args: { target: 'Server / Project B' } });
    await runtime.execute({ name: 'read_file', args: { path: 'package.json' } });
    expect(calls[0]?.slice(0, 4)).toEqual([
      'server_1',
      'workspace',
      'files.read',
      { path: 'package.json', workspaceId: 'project-b' },
    ]);
  });
});
