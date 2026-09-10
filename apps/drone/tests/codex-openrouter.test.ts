import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { codexModelRoute, codexProviderLaunchScript } from '../src/codex-model-routing';
import { CodexProviderCredentials } from '../src/CodexProviderCredentials';
import { CodexPromptRunManager } from '../src/codex-prompt-run-manager';
import { parseCodexOpenRouterModels, getCodexOpenRouterCatalog } from '../src/hub/codex-openrouter-catalog';
import { withTempDroneDataDir } from './test-helpers';

test('the full OpenRouter catalog includes models without tools, context metadata, or reasoning', () => {
  const models = parseCodexOpenRouterModels({ data: [
    { id: 'vendor/text', name: 'Text' },
    { id: 'vendor/tools', name: 'Tools', supported_parameters: ['tools', 'reasoning'] },
  ] });
  expect(models).toHaveLength(2);
  expect(models[0].label).toContain('tool support not advertised');
  expect(models[0].reasoningLevels).toEqual([]);
  expect(models[1].reasoningLevels).toEqual(['low', 'medium', 'high']);
  expect(codexModelRoute(models[0].id)).toEqual({ provider: 'openrouter', model: 'vendor/text' });
  expect(codexModelRoute('gpt-example')).toEqual({ provider: 'default', model: 'gpt-example' });
  expect(codexProviderLaunchScript('exec codex app-server', models[0].id)).toContain('wire_api="responses"');
  expect(codexProviderLaunchScript('exec codex app-server', 'gpt-example')).toBe('exec codex app-server');
});

test('catalog refresh failures retain the full cached catalog', async () => {
  await withTempDroneDataDir('codex-openrouter-catalog-', async () => {
    const catalog = await getCodexOpenRouterCatalog(true, (async () => Response.json({ data: [{ id: 'vendor/text' }] })) as typeof fetch);
    const failed = await getCodexOpenRouterCatalog(true, (async () => new Response('', { status: 503 })) as typeof fetch);
    expect(failed.models).toEqual(catalog.models);
    expect(failed).toMatchObject({ stale: true, error: 'OpenRouter model refresh failed (503)' });
  });
});

test('credentials survive daemon restart outside prompt records with owner-only permissions', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-provider-'));
  try {
    const originalVersion = await new CodexProviderCredentials(dir).save('../chat', 'test-secret');
    const restored = new CodexProviderCredentials(dir);
    expect(await restored.environment('../chat', originalVersion)).toEqual({ DRONE_CODEX_OPENROUTER_API_KEY: 'test-secret' });
    const folder = path.join(dir, 'credentials', 'codex-openrouter');
    const [file] = await fs.readdir(folder);
    expect((await fs.stat(path.join(folder, file))).mode & 0o777).toBe(0o600);
    const rotatedVersion = await restored.save('../chat', 'rotated-secret');
    expect(await restored.environment('../chat', rotatedVersion)).toEqual({ DRONE_CODEX_OPENROUTER_API_KEY: 'rotated-secret' });
    expect(await restored.environment('../chat', originalVersion)).toEqual({ DRONE_CODEX_OPENROUTER_API_KEY: 'test-secret' });
    await expect(restored.environment('different-chat')).rejects.toThrow('credentials are unavailable');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('switching providers resumes the same thread in both directions and retains queued messages', async () => {
  const calls: any[] = [];
  let closes = 0;
  const connection = () => ({ close: async () => { closes++; }, call: async (method: string, params: any) => {
    calls.push({ method, params });
    if (method === 'config/read') return { config: { model_provider: 'custom-default', model: 'default-model' } };
    return { modelProvider: params.modelProvider, thread: { id: params.threadId } };
  } });
  const manager: any = new CodexPromptRunManager<any>({} as any);
  manager.createConnection = connection;
  const session: any = { provider: 'default', threadId: 'same-thread', threadReady: true,
    queuedMessageIds: ['queued-message'], connection: connection() };
  const router = { model: 'openrouter:vendor/model' };
  await manager.switchProvider(session, router);
  expect(await manager.ensureThread(session, router)).toBe('same-thread');
  expect(calls[0]).toMatchObject({ method: 'thread/resume', params: { threadId: 'same-thread', modelProvider: 'drone_hub_openrouter', model: 'vendor/model' } });
  session.switchingProvider = false;
  await manager.switchProvider(session, {});
  expect(await manager.ensureThread(session, {})).toBe('same-thread');
  expect(calls.at(-1)).toMatchObject({ method: 'thread/resume', params: { threadId: 'same-thread', modelProvider: 'custom-default', model: 'default-model' } });
  expect(session.queuedMessageIds).toEqual(['queued-message']);
  expect(closes).toBe(2);
});

test('a failed provider switch never falls back to a new thread', async () => {
  const calls: string[] = [];
  const manager: any = new CodexPromptRunManager<any>({} as any);
  const session: any = { threadId: 'saved-thread', switchingProvider: true, connection: { call: async (method: string) => {
    calls.push(method); throw new Error('thread not found');
  } } };
  await expect(manager.ensureThread(session, { model: 'openrouter:vendor/model' })).rejects.toThrow();
  expect(calls).toEqual(['thread/resume']);
  expect(session.threadId).toBe('saved-thread');
});

test('ASAP messages selecting a different model queue instead of steering the active model', async () => {
  const manager: any = new CodexPromptRunManager<any>({} as any);
  const session: any = { selection: 'old-model', activeRun: { id: 'active' }, queuedMessageIds: [], operationTail: Promise.resolve() };
  manager.sessions.set('chat', session);
  manager.steerActiveRun = () => { throw new Error('must not steer across model selections'); };
  expect(await manager.enqueue({ id: 'next', deliveryMode: 'asap', codexAppServer: { sessionKey: 'chat', model: 'openrouter:vendor/model' } })).toEqual({ disposition: 'queued' });
  expect(session.queuedMessageIds).toEqual(['next']);
});

test('a server that ignores provider overrides fails without losing the saved thread', async () => {
  const manager: any = new CodexPromptRunManager<any>({} as any);
  const session: any = { threadId: 'saved-thread', switchingProvider: true, connection: { call: async () => ({
    modelProvider: 'openai', thread: { id: 'saved-thread' },
  }) } };
  await expect(manager.ensureThread(session, { model: 'openrouter:vendor/model' })).rejects.toThrow('did not apply');
  expect(session.threadId).toBe('saved-thread');
  expect(session.threadReady).not.toBe(true);
});

test('same-provider turns reuse the process, but rotated credentials restart it between turns', async () => {
  const manager: any = new CodexPromptRunManager<any>({} as any);
  let closed = false;
  const session: any = { provider: 'openrouter', credentialVersion: 'v1', connection: { close: async () => { closed = true; } } };
  await manager.switchProvider(session, { model: 'openrouter:vendor/next', openrouterCredentialVersion: 'v1' });
  expect(closed).toBe(false);
  manager.createConnection = () => ({});
  await manager.switchProvider(session, { model: 'openrouter:vendor/next', openrouterCredentialVersion: 'v2' });
  expect(closed).toBe(true);
  expect(session.credentialVersion).toBe('v2');
});

test('forking with Auto explicitly restores the configured provider and default model', async () => {
  const calls: any[] = [];
  const manager: any = new CodexPromptRunManager<any>({} as any);
  const session: any = { connection: { call: async (method: string, params: any) => {
    calls.push({ method, params });
    if (method === 'config/read') return { config: { model_provider: 'custom-default', model: 'default-model' } };
    return { modelProvider: params.modelProvider, thread: { id: 'forked-thread' } };
  } } };
  expect(await manager.ensureThread(session, { forkThreadId: 'openrouter-source' })).toBe('forked-thread');
  expect(calls.at(-1)).toEqual({ method: 'thread/fork', params: {
    threadId: 'openrouter-source', modelProvider: 'custom-default', model: 'default-model',
  } });
});

test('selecting Auto after an explicit default-provider model reloads the thread defaults', async () => {
  let closed = false;
  const manager: any = new CodexPromptRunManager<any>({} as any);
  manager.createConnection = () => ({});
  const session: any = { provider: 'default', selection: 'explicit-model', threadId: 'saved-thread', threadReady: true,
    connection: { close: async () => { closed = true; } } };
  await manager.switchProvider(session, {});
  expect(closed).toBe(true);
  expect(session.threadId).toBe('saved-thread');
  expect(session.threadReady).toBe(false);
});

test('in-flight catalog requests stay with the settings repository that started them', async () => {
  await withTempDroneDataDir('codex-catalog-first-', async () => {
    let release!: (response: Response) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const first = getCodexOpenRouterCatalog(true, (() => {
      started();
      return new Promise<Response>((resolve) => { release = resolve; });
    }) as typeof fetch);
    await ready;
    await withTempDroneDataDir('codex-catalog-second-', async () => {
      const second = await getCodexOpenRouterCatalog(true, (async () => Response.json({ data: [{ id: 'second/model' }] })) as typeof fetch);
      expect(second.models[0].id).toBe('openrouter:second/model');
      release(Response.json({ data: [{ id: 'first/model' }] }));
      expect((await first).models[0].id).toBe('openrouter:first/model');
      expect((await getCodexOpenRouterCatalog()).models[0].id).toBe('openrouter:second/model');
    });
    expect((await getCodexOpenRouterCatalog()).models[0].id).toBe('openrouter:first/model');
  });
});

test('managed provider configuration does not merge authentication into the user OpenRouter provider', () => {
  const script = codexProviderLaunchScript('exec codex app-server', 'openrouter:vendor/model');
  expect(script).toContain('model_provider="drone_hub_openrouter"');
  expect(script).toContain('model_providers.drone_hub_openrouter=');
  expect(script).not.toContain('model_providers.openrouter=');
});

test('ASAP prompts with rotated credentials or changed reasoning wait for a new turn', async () => {
  for (const change of [{ openrouterCredentialVersion: 'new-key' }, { effort: 'high' }]) {
    const manager: any = new CodexPromptRunManager<any>({} as any);
    const session: any = { selection: 'openrouter:vendor/model', effort: 'low', credentialVersion: 'old-key',
      activeRun: { id: 'active' }, queuedMessageIds: [], operationTail: Promise.resolve() };
    manager.sessions.set('chat', session);
    manager.steerActiveRun = () => { throw new Error('must start a new turn for changed settings'); };
    const result = await manager.enqueue({ id: 'next', deliveryMode: 'asap', codexAppServer: {
      sessionKey: 'chat', model: session.selection, effort: session.effort, openrouterCredentialVersion: 'old-key', ...change,
    } });
    expect(result).toEqual({ disposition: 'queued' });
  }
});
