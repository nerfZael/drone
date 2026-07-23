import { describe, expect, test } from 'bun:test';

import { createDroneWorkflowRunnerGateway } from '../src/hub/workflows/drone-workflow-runner-gateway';

function origin() {
  return {
    workflowId: 'workflow-1',
    runId: 'run-12345678',
    invocationId: 'invocation-1',
  };
}

function agent(runnerKind: 'drone-chat' | 'drone', agentId: 'blip' | 'codex') {
  return {
    runner: {
      kind: runnerKind,
      agent: { kind: 'builtin' as const, id: agentId },
    },
    permissions: ['workspace:read', 'workspace:write', 'process:execute'] as const,
    instructions: 'Do the work.',
  };
}

function dependencies() {
  const chats = new Map<string, any>();
  const apiCalls: Array<{ method: string; pathname: string; body: any }> = [];
  const tags: any[] = [];
  let childReady = false;
  const owner = {
    id: 'owner-drone',
    runtime: 'container',
    repoPath: '/repo',
    chats: {},
  };
  const child = {
    id: 'child-drone',
    runtime: 'container',
    chats: { default: {} },
  };
  return {
    state: { apiCalls, chats, tags },
    input: {
      nowIso: () => '2026-01-01T00:00:00.000Z',
      resolveDrone: async (droneId: string) => {
        if (droneId === owner.id) return { kind: 'real', drone: owner };
        return childReady
          ? { kind: 'real', drone: child }
          : { kind: 'pending', pending: { phase: 'draft' } };
      },
      importDroneChats: async ({ droneId }: any) => {
        if (droneId === child.id && !chats.has(`${droneId}:default`)) {
          chats.set(`${droneId}:default`, { id: 'child-default-chat' });
        }
      },
      createChat: async ({ droneId, chatName, createEntry }: any) => {
        const chat = { id: `chat-${chatName}`, ...createEntry() };
        chats.set(`${droneId}:${chatName}`, chat);
        return { chat };
      },
      updateChat: async ({ droneId, chatName, update }: any) => {
        const key = `${droneId}:${chatName}`;
        chats.set(key, update(chats.get(key)));
      },
      readChat: ({ droneId, chatName }: any) => ({
        chat: chats.get(`${droneId}:${chatName}`) ?? null,
      }),
      listChats: ({ droneId }: any) => ({
        chats: [...chats.keys()]
          .filter((key) => key.startsWith(`${droneId}:`))
          .map((key) => key.slice(droneId.length + 1)),
      }),
      deleteChat: async () => {},
      listArchivedChats: () => ({ archivedChats: [] }),
      deleteArchivedChat: async () => {},
      projectChats: async () => {},
      buildChatEntry: () => ({ id: 'base-chat' }),
      enqueuePrompt: async () => ({ kind: 'enqueued', id: 'prompt-1' }),
      stopChatActivity: async () => {},
      localApiRequest: async (method: 'POST' | 'DELETE', pathname: string, body?: unknown) => {
        apiCalls.push({ method, pathname, body });
        if (method === 'POST' && pathname === '/api/drones') {
          return { ok: true, id: child.id };
        }
        if (method === 'POST' && pathname.endsWith('/publish')) {
          childReady = true;
          return { ok: true };
        }
        return { ok: true };
      },
      tagChildDrone: async (input: any) => {
        tags.push(input);
      },
    },
  };
}

describe('workflow runner gateway', () => {
  test('configures a Codex workflow chat', async () => {
    const fixture = dependencies();
    const gateway = createDroneWorkflowRunnerGateway(fixture.input);
    const target = await gateway.createTarget({
      ownerDroneId: 'owner-drone',
      origin: origin(),
      agent: agent('drone-chat', 'codex') as any,
      signal: new AbortController().signal,
    });

    expect(target.runnerKind).toBe('drone-chat');
    expect(target.executionDroneId).toBe('owner-drone');
    const chat = fixture.state.chats.get(`owner-drone:${target.chatName}`);
    expect(chat.agent).toEqual({ kind: 'builtin', id: 'codex' });
    expect(chat.visibility).toBe('workflow');
  });

  test('creates, tags, opens, and deletes a hidden child drone target', async () => {
    const fixture = dependencies();
    const gateway = createDroneWorkflowRunnerGateway(fixture.input);
    const target = await gateway.createTarget({
      ownerDroneId: 'owner-drone',
      origin: origin(),
      agent: agent('drone', 'codex') as any,
      signal: new AbortController().signal,
    });

    expect(target).toEqual({
      runnerKind: 'drone',
      executionDroneId: 'child-drone',
      childDroneId: 'child-drone',
      chatId: 'child-default-chat',
      chatName: 'default',
    });
    expect(fixture.state.apiCalls[0]).toMatchObject({
      method: 'POST',
      pathname: '/api/drones',
      body: {
        runtime: 'container',
        draft: true,
        fleetParentId: 'owner-drone',
        cloneFrom: 'owner-drone',
        cloneChats: false,
        seedAgent: { kind: 'builtin', id: 'codex' },
      },
    });
    expect(fixture.state.tags.map((entry) => entry.state)).toEqual(['pending', 'real']);
    expect(fixture.state.chats.get('child-drone:default').agent).toEqual({
      kind: 'builtin',
      id: 'codex',
    });

    await gateway.deleteTarget({ target });
    expect(fixture.state.apiCalls.at(-1)).toMatchObject({
      method: 'DELETE',
      pathname: '/api/drones/child-drone?keepVolume=0&forget=1',
    });
  });
});
