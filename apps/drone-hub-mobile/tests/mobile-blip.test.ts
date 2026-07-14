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
    await runMobileBlip({
      provider: 'openai',
      apiKey: 'test-key',
      codexAuth: null,
      prompt: 'Run the build',
      thread,
      history: [],
      workspaceRuntime,
      signal: new AbortController().signal,
      onMessages: async () => undefined,
      onStreamingMessages: (messages) => previews.push(JSON.stringify(messages)),
    });
    expect(previews.some((preview) => preview.includes('building…'))).toBe(true);
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
