import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Mind } from '@entity/core';
import type { ChatWorkspaceAccess, ChatWorkspaceCatalog } from '@drone/assistant-chat';
import { HubRouter } from '../src/hub/hub-router';
import { registerEntityRoutes } from '../src/hub/entity/entity-routes';
import { EntitySession } from '../src/hub/entity/entity-session';
import { ENTITY_HOME_TARGET_ID, type CreateWorkspaceService } from '../src/hub/entity/entity-workspaces';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const repo = { id: 'host:repo', kind: 'host' as const, name: 'repo', deviceId: 'this', deviceName: 'Desktop', read: true, write: true, execute: true, path: '/tmp', workspaceId: 'repo' };
const DEFINITIONS = [
  { name: 'read_file', description: 'Read a file.', parameters: { type: 'object', properties: { target: { type: 'string' }, path: { type: 'string' } }, required: ['path'] } },
  { name: 'write_file', description: 'Write a file.', parameters: { type: 'object', properties: { target: { type: 'string' }, path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
];

/** A stand-in for the Companion's service: a catalog of one repository, and tools that report what they were called with. */
function fakeService(calls: { tool: string; args: unknown; home?: string; access: ChatWorkspaceAccess }[]): CreateWorkspaceService {
  return storage => {
    let revision = 1;
    const catalog = async (): Promise<ChatWorkspaceCatalog> => ({
      revision: String(revision), access: await storage.read(), defaults: { read: true, write: false, execute: false } as any,
      workspaces: [repo], devices: [{ id: 'this', name: 'Desktop' }],
    });
    return {
      catalog,
      async save(value, sent) {
        if (sent !== String(revision)) throw new Error('Workspace access changed elsewhere');
        await storage.write(value as ChatWorkspaceAccess);
        revision++;
        return catalog();
      },
      async tools(_runId, _assertActive, homeRoot, home) {
        const access = await storage.read();
        return ['read_file', 'write_file'].map(name => ({
          name, label: name, description: name, parameters: {} as any,
          async execute(_id: string, args: unknown) {
            calls.push({ tool: name, args, home: `${home?.id}@${homeRoot}`, access });
            return { content: [{ type: 'text', text: `${name} ok` }], details: {} };
          },
        }));
      },
    };
  };
}

function harness(dir: string) {
  const calls: { tool: string; args: unknown; home?: string; access: ChatWorkspaceAccess }[] = [];
  const prompts: string[] = [];
  const mind: Mind = {
    async run(input) {
      prompts.push(input.prompt);
      if (input.role === 'head' && input.prompt.includes('"text":"write it"')) {
        await input.callTool('write_file', { target: 'host:repo', path: './notes.md', content: 'hi' });
      }
      return {};
    },
  };
  const session = new EntitySession(() => undefined, { workspace: path.join(dir, 'home') }, () => mind, {
    sessionsDir: path.join(dir, 'sessions'), createWorkspaceService: fakeService(calls), workspaceDefinitions: DEFINITIONS,
  });
  let result: { status: number; body: any } = { status: 0, body: null };
  let body: unknown = null;
  const router = new HubRouter((_res, status, value) => { result = { status, body: value }; }, async () => body);
  registerEntityRoutes(router, { session });
  const call = async (method: 'GET' | 'POST', url: string, payload?: unknown) => {
    body = payload ?? null;
    await router.handle({ method } as any, {} as any, new URL(`http://hub.test${url}`)).catch(() => {});
    return result;
  };
  return { session, call, calls, prompts };
}

test('entity workspaces: a saved selection is logged, shown to the limbs, kept for a resume, and used by the tools', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-workspaces-'));
  const { session, call, calls, prompts } = harness(dir);
  try {
    const catalog = (await call('GET', '/api/entity/workspaces')).body;
    expect(catalog.access).toEqual({ targets: [], defaultTargetId: null });
    session.control('start');
    const access = { targets: [{ ...repo, execute: false }], defaultTargetId: 'host:repo' };
    const saved = await call('POST', '/api/entity/workspaces', { access, revision: catalog.revision });
    expect(saved.status).toBe(200);
    expect((await call('POST', '/api/entity/workspaces', { access, revision: catalog.revision })).status).toBe(409);

    const changed = session.state().events.filter(e => e.type === 'workspaces_changed');
    expect(changed).toHaveLength(1);
    expect(changed[0].data.access).toMatchObject({ defaultTargetId: 'host:repo', targets: [{ id: 'host:repo', read: true, write: true, execute: false }] });
    expect(session.getConfig().workspaceAccess.defaultTargetId).toBe('host:repo');
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'sessions', session.state().sessionId!, 'meta.json'), 'utf8'));
    expect(meta.config.workspaceAccess.defaultTargetId).toBe('host:repo');

    session.input('chat_message', { text: 'write it' });
    for (let i = 0; i < 100 && !calls.length; i++) await sleep(10);
    expect(calls[0]).toMatchObject({ tool: 'write_file', args: { target: 'host:repo', path: './notes.md' }, home: `${ENTITY_HOME_TARGET_ID}@${path.join(dir, 'home')}` });
    expect(calls[0].access.defaultTargetId).toBe('host:repo');
    expect(prompts.at(-1)).toContain('host:repo: repo (host; read, write) · default');
    expect(prompts.at(-1)).toContain(`${ENTITY_HOME_TARGET_ID}: your home folder (read, write)`);
    // Writes claim their file per workspace, so the same path in two workspaces never collides.
    expect(session.state().events.find(e => e.type === 'claimed')?.data.path).toBe('host:repo:notes.md');
    expect(session.state().events.find(e => e.type === 'tool_done')?.data).toMatchObject({ name: 'write_file', ok: true });
  } finally {
    session.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('entity workspaces: the Files view opens a granted folder, and nothing that is not granted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-workspaces-'));
  const { session, call } = harness(dir);
  try {
    expect((await call('GET', '/api/entity/files-target?target=host:repo')).status).toBe(404);
    const catalog = (await call('GET', '/api/entity/workspaces')).body;
    await call('POST', '/api/entity/workspaces', { access: { targets: [repo], defaultTargetId: 'host:repo' }, revision: catalog.revision });
    expect((await call('GET', '/api/entity/files-target?target=host:repo')).body).toMatchObject({ workspaceId: 'entity-files-repo', name: 'repo' });
  } finally {
    session.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('entity chat: a worker\'s message that stays too long is saved to its artifacts folder and linked; links must exist', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-artifacts-'));
  const long = 'The plan is ready. ' + 'detail '.repeat(200);
  const results: string[] = [];
  const mind: Mind = {
    async run(input) {
      if (input.role === 'head' && input.prompt.includes('"text":"plan it"')) await input.callTool('dispatch', { task: 'plan', name: 'Game plan' });
      if (input.role === 'task') {
        for (let i = 0; i < 3; i++) results.push(await input.callTool('say', { text: long }));
        results.push(await input.callTool('say', { text: 'nope', files: ['../outside.md'] }));
        await input.callTool('finish_task', { result: 'planned' });
      }
      return {};
    },
  };
  const session = new EntitySession(() => undefined, { workspace: path.join(dir, 'home') }, () => mind, { sessionsDir: path.join(dir, 'sessions') });
  try {
    fs.mkdirSync(path.join(dir, 'home'), { recursive: true });
    session.control('start');
    session.input('chat_message', { text: 'plan it' });
    for (let i = 0; i < 200 && results.length < 4; i++) await sleep(10);
    const message = session.state().events.find(e => e.type === 'chat_message' && Array.isArray(e.data.files))!;
    const file = (message.data.files as string[])[0];
    expect(file).toBe(`.entity/artifacts/${session.state().sessionId}/game-plan.md`);
    expect(fs.readFileSync(path.join(dir, 'home', file), 'utf8').trim()).toBe(long.trim());
    expect(message.data.text).toBe(`The plan is ready. (full text in ${file})`);
    // The file-check refused the second message's link (it is outside the home folder); the overflow's link was sent.
    expect(results[1]).toContain('too long');
    expect(results[3]).toContain('outside your home folder');
  } finally {
    session.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
