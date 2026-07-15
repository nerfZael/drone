import { afterEach, describe, expect, test } from 'bun:test';
import type { TranscriptEntry } from '@blip/core';
import type {
  LocalAssistantThread,
  LocalBlipSessionSnapshot,
} from '../src/local-assistant/local-assistant-types';
import { runMobileBlip } from '../src/local-assistant/run-mobile-blip';
import { createWorkspaceToolRuntime } from '../src/local-assistant/workspace-tools';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('phone Blip session', () => {
  test('uses the shared Blip tool loop with the React Native model transport', async () => {
    const thread: LocalAssistantThread = {
      id: 'mobile_blip_1',
      title: 'Portable session',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: 'gpt-test',
      thinkingLevel: 'low',
      status: 'running',
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
      ],
      messages: [],
    };
    let modelCall = 0;
    globalThis.fetch = (async () => {
      modelCall += 1;
      return {
        ok: true,
        json: async () =>
          modelCall === 1
            ? {
                choices: [
                  {
                    finish_reason: 'tool_calls',
                    message: {
                      content: null,
                      tool_calls: [
                        {
                          id: 'call_read',
                          type: 'function',
                          function: {
                            name: 'read_file',
                            arguments: JSON.stringify({ path: 'README.md' }),
                          },
                        },
                      ],
                    },
                  },
                ],
              }
            : {
                choices: [
                  {
                    finish_reason: 'stop',
                    message: { content: 'The README says hello.' },
                  },
                ],
              },
      } as Response;
    }) as typeof fetch;
    const meshCalls: unknown[][] = [];
    const workspaceRuntime = createWorkspaceToolRuntime(thread, async (...args) => {
      meshCalls.push(args);
      return { text: 'hello', details: { path: 'README.md' } };
    });
    const persisted: unknown[][] = [];
    const messages = await runMobileBlip({
      provider: 'openai',
      apiKey: 'test-key',
      codexAuth: null,
      prompt: 'Read the README',
      thread,
      history: [],
      workspaceRuntime,
      signal: new AbortController().signal,
      onMessages: async (next) => {
        persisted.push(next);
      },
      onStreamingMessages: () => undefined,
    });

    expect(modelCall).toBe(2);
    expect(meshCalls[0]?.slice(0, 4)).toEqual([
      'desktop_1',
      'workspace',
      'files.read',
      { path: 'README.md', workspaceId: 'project-a' },
    ]);
    expect(messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'toolResult',
      'assistant',
    ]);
    expect(JSON.stringify(messages.at(-1)?.content)).toContain('The README says hello.');
    expect(persisted.length).toBeGreaterThanOrEqual(4);
  });

  test('keeps partial transfer details in the transcript but sends compact failure text to the model', async () => {
    const thread: LocalAssistantThread = {
      id: 'mobile_blip_transfer_failure',
      title: 'Partial transfer',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: 'gpt-test',
      thinkingLevel: 'low',
      status: 'running',
      error: null,
      workspaceTargets: [
        {
          targetDeviceId: 'desktop_1',
          deviceName: 'Desktop',
          workspaceId: 'source',
          workspaceName: 'Source',
          read: true,
          write: false,
          execute: false,
        },
        {
          targetDeviceId: 'server_1',
          deviceName: 'Server',
          workspaceId: 'destination',
          workspaceName: 'Destination',
          read: false,
          write: true,
          execute: false,
        },
      ],
      messages: [],
    };
    const requestBodies: any[] = [];
    globalThis.fetch = (async (_url, init) => {
      requestBodies.push(JSON.parse(String(init?.body ?? '{}')));
      return {
        ok: true,
        json: async () =>
          requestBodies.length === 1
            ? {
                choices: [
                  {
                    finish_reason: 'tool_calls',
                    message: {
                      content: null,
                      tool_calls: [
                        {
                          id: 'call_transfer',
                          type: 'function',
                          function: {
                            name: 'transfer_files',
                            arguments: JSON.stringify({
                              sourceTarget: 'Desktop / Source',
                              sourcePath: 'bundle',
                              destinationTarget: 'Server / Destination',
                              destinationPath: 'copied-bundle',
                            }),
                          },
                        },
                      ],
                    },
                  },
                ],
              }
            : {
                choices: [
                  {
                    finish_reason: 'stop',
                    message: { content: 'I can resume the remaining file.' },
                  },
                ],
              },
      } as Response;
    }) as typeof fetch;
    const workspaceRuntime = createWorkspaceToolRuntime(
      thread,
      async (deviceId, _capability, operation, rawPayload) => {
        const payload = rawPayload as Record<string, any>;
        if (deviceId === 'desktop_1' && operation === 'files.transfer.stat') {
          if (payload.path === 'bundle') return { type: 'directory', size: 0, mtimeMs: 1 };
          return { type: 'file', size: 3, mtimeMs: 1 };
        }
        if (deviceId === 'desktop_1' && operation === 'files.transfer.list') {
          return {
            entries: [
              { name: 'a.txt', type: 'file', size: 3, mtimeMs: 1 },
              { name: 'b.txt', type: 'file', size: 3, mtimeMs: 1 },
            ],
          };
        }
        if (deviceId === 'desktop_1' && operation === 'files.transfer.read') {
          return {
            dataBase64: payload.path.endsWith('/a.txt') ? 'b25l' : 'dHdv',
            bytes: 3,
          };
        }
        if (operation === 'files.transfer.prepare') return { offset: 0 };
        if (operation === 'files.transfer.write') {
          if (payload.path.endsWith('/b.txt')) {
            throw Object.assign(new Error('destination disconnected'), {
              code: 'INVALID_REQUEST',
            });
          }
          return { offset: 3 };
        }
        return {};
      },
    );

    const transferPreviews: any[] = [];
    const messages = await runMobileBlip({
      provider: 'openai',
      apiKey: 'test-key',
      codexAuth: null,
      prompt: 'Transfer the bundle',
      thread,
      history: [],
      workspaceRuntime,
      signal: new AbortController().signal,
      onMessages: async () => undefined,
      onStreamingMessages: (streamingMessages) => {
        const preview = streamingMessages.find(
          (message) => message.role === 'toolResult' && message.toolName === 'transfer_files',
        );
        if (preview) transferPreviews.push(preview.details);
      },
    });

    const toolResult = messages.find((message) => message.role === 'toolResult');
    expect(toolResult).toMatchObject({
      toolName: 'transfer_files',
      isError: true,
      details: {
        type: 'workspace_transfer',
        phase: 'failed',
        fileCount: 2,
        completedFiles: 1,
        failure: {
          sourcePath: 'bundle/b.txt',
          destinationPath: 'copied-bundle/b.txt',
          resumable: true,
        },
      },
    });
    const providerToolResult = requestBodies[1]?.messages?.find(
      (message: any) => message.role === 'tool',
    );
    expect(providerToolResult?.content).toContain('Failed at bundle/b.txt');
    expect(providerToolResult?.content).toMatch(/resumeToken "tr1_1_[0-9a-f]{16}"/);
    expect(providerToolResult?.content).not.toContain('bundle/a.txt');
    expect(
      transferPreviews.some(
        (details) =>
          details?.files?.length === 2 &&
          details.files.some(
            (file: any) => file.sourcePath === 'bundle/b.txt' && file.status === 'failed',
          ),
      ),
    ).toBe(true);
  });

  test('forwards asynchronous command output through Blip tool progress events', async () => {
    const thread: LocalAssistantThread = {
      id: 'mobile_blip_command',
      title: 'Command streaming',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: 'gpt-test',
      thinkingLevel: 'low',
      status: 'running',
      error: null,
      workspaceTargets: [
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
    let modelCall = 0;
    globalThis.fetch = (async () => {
      modelCall += 1;
      return {
        ok: true,
        json: async () =>
          modelCall === 1
            ? {
                choices: [
                  {
                    finish_reason: 'tool_calls',
                    message: {
                      content: null,
                      tool_calls: [
                        {
                          id: 'call_bash',
                          type: 'function',
                          function: {
                            name: 'bash',
                            arguments: JSON.stringify({ command: 'yarn build' }),
                          },
                        },
                      ],
                    },
                  },
                ],
              }
            : {
                choices: [{ finish_reason: 'stop', message: { content: 'Build completed.' } }],
              },
      } as Response;
    }) as typeof fetch;
    const workspaceRuntime = createWorkspaceToolRuntime(
      thread,
      async (_device, _capability, operation) => {
        if (operation === 'commands.start')
          return { jobId: 'command_1', workspaceId: 'project-b', status: 'running' };
        return {
          jobId: 'command_1',
          workspaceId: 'project-b',
          status: 'completed',
          cursor: 1,
          chunks: [{ cursor: 0, stream: 'stdout', text: 'building…\ndone\n' }],
        };
      },
    );
    const previews: string[] = [];
    const approvals: any[] = [];
    await runMobileBlip({
      provider: 'openai',
      apiKey: 'test-key',
      codexAuth: null,
      prompt: 'Run the build',
      thread,
      history: [],
      workspaceRuntime,
      signal: new AbortController().signal,
      requestExecuteApproval: async (approval) => {
        approvals.push(approval);
        return true;
      },
      onMessages: async () => undefined,
      onStreamingMessages: (messages) => previews.push(JSON.stringify(messages)),
    });
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      toolName: 'bash',
      args: {
        resolved: { targetLabel: 'Server / Project B', command: 'yarn build' },
      },
    });
    expect(previews.some((preview) => preview.includes('building…'))).toBe(true);
  });

  test('rejects a silent completion after a tool call while retaining the tool transcript', async () => {
    const thread: LocalAssistantThread = {
      id: 'mobile_blip_silent_tool',
      title: 'Silent tool completion',
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
      model: 'gpt-test',
      thinkingLevel: 'low',
      status: 'running',
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
      ],
      messages: [],
    };
    let modelCall = 0;
    globalThis.fetch = (async () => {
      modelCall += 1;
      return {
        ok: true,
        json: async () =>
          modelCall === 1
            ? {
                choices: [
                  {
                    finish_reason: 'tool_calls',
                    message: {
                      content: null,
                      tool_calls: [
                        {
                          id: 'call_read',
                          type: 'function',
                          function: {
                            name: 'read_file',
                            arguments: JSON.stringify({ path: 'README.md' }),
                          },
                        },
                      ],
                    },
                  },
                ],
              }
            : { choices: [{ finish_reason: 'stop', message: { content: null } }] },
      } as Response;
    }) as typeof fetch;
    let latestMessages: any[] = [];

    await expect(
      runMobileBlip({
        provider: 'openai',
        apiKey: 'test-key',
        codexAuth: null,
        prompt: 'Read the README',
        thread,
        history: [],
        workspaceRuntime: createWorkspaceToolRuntime(thread, async () => ({ text: 'hello' })),
        signal: new AbortController().signal,
        onMessages: async (messages) => {
          latestMessages = messages;
        },
        onStreamingMessages: () => undefined,
      }),
    ).rejects.toThrow('without a final response');
    expect(latestMessages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'toolResult',
      'assistant',
    ]);
    expect(latestMessages.find((message) => message.role === 'toolResult')).toMatchObject({
      toolName: 'read_file',
    });
  });

  test('automatically compacts a restored mobile transcript through the injected transport', async () => {
    const thread: LocalAssistantThread = {
      id: 'mobile_blip_compaction',
      title: 'Automatic compaction',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      model: 'gpt-test',
      thinkingLevel: 'low',
      status: 'running',
      error: null,
      workspaceTargets: [],
      messages: [],
    };
    const transcript: TranscriptEntry[] = Array.from({ length: 5 }, (_, index) => ({
      type: 'message',
      id: `history_${index}`,
      timestamp: '2026-01-01T00:00:00.000Z',
      message: {
        role: 'user',
        content: index === 0 ? 'old context '.repeat(42_000) : `recent prompt ${index}`,
        timestamp: index + 1,
      },
    }));
    const sessionSnapshot: LocalBlipSessionSnapshot = {
      version: 1,
      state: {
        id: `mobile_${thread.id}`,
        workspaceRoot: 'mobile-mesh',
        modelProvider: 'openai',
        modelId: thread.model,
        permissionMode: 'workspace-write',
        toolProfile: 'no-shell-workspace-write',
        loadedSkills: [],
        transcriptPath: `mobile:${thread.id}`,
        changedFiles: [],
        readFiles: [],
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
      },
      transcript,
    };
    let modelCall = 0;
    globalThis.fetch = (async () => {
      modelCall += 1;
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content:
                  modelCall === 1 ? 'Mobile compacted summary.' : 'Continued after compaction.',
              },
            },
          ],
        }),
      } as Response;
    }) as typeof fetch;
    let persisted: LocalBlipSessionSnapshot | null = null;
    await runMobileBlip({
      provider: 'openai',
      apiKey: 'test-key',
      codexAuth: null,
      prompt: 'Continue',
      thread,
      history: [],
      workspaceRuntime: createWorkspaceToolRuntime(thread, async () => ({})),
      signal: new AbortController().signal,
      onMessages: async () => undefined,
      onStreamingMessages: () => undefined,
      sessionSnapshot,
      onSessionSnapshot: async (snapshot) => {
        persisted = snapshot;
      },
    });

    expect(modelCall).toBe(2);
    const compaction = persisted!.transcript.find((entry) => entry.type === 'compaction');
    expect(compaction?.trigger).toBe('auto');
    expect(compaction?.summary).toContain('Mobile compacted summary.');
    expect(persisted!.state.compactedSummary).toBe(compaction?.summary);
  });
});
