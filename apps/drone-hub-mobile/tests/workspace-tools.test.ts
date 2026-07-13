import { describe, expect, test } from 'bun:test';
import { executeWorkspaceTool } from '../src/local-assistant/workspace-tools';
import type { LocalAssistantThread } from '../src/local-assistant/local-assistant-types';

describe('phone assistant workspace tools', () => {
  test('binds every request to the phone, thread, root, and access level', async () => {
    const thread: LocalAssistantThread = {
      id: 'mobile_thread_1',
      title: 'Phone thread',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: 'gpt-test',
      thinkingLevel: 'low',
      status: 'idle',
      error: null,
      workspaceTarget: {
        targetDeviceId: 'desktop_1',
        rootId: 'main-project',
        read: true,
        write: true,
      },
      messages: [],
    };
    let call: any;
    const result = await executeWorkspaceTool({
      thread,
      phoneDeviceId: 'phone_1',
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
        actor: {
          assistantHomeDeviceId: 'phone_1',
          threadId: 'mobile_thread_1',
          rootId: 'main-project',
          read: true,
          write: true,
        },
      },
    ]);
    expect(result.text).toBe('wrote a.txt');
  });
});
