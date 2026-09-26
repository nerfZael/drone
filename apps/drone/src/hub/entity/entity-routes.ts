import fs from 'node:fs';
import path from 'node:path';
import type { HubRouter } from '../hub-router';
import { registerFolderWorkspace } from '../folder-workspaces';
import { defaultEntityWorkspace, EntitySession, type EntitySessionConfig } from './entity-session';
import { workspaceToolDefinitions, type CreateWorkspaceService } from './entity-workspaces';
import { createEvaluator } from './entity-evaluator';
import { isSessionId } from './entity-recorder';
import { isRunnableModel } from './entity-mind';
import { EntityProfiles, parseModels, type EntityModels } from './entity-profiles';
import { EntityPrompts } from './entity-prompts';
import { droneRootPath } from '../../host/paths';
import { HUB_AGENT_MODEL_OPTIONS } from '../llm-model-catalog';
import { toBlipModelProvider } from '../hub-settings';

const PROVIDER_LABELS: Record<string, string> = { 'openai-codex': 'Codex', openai: 'OpenAI API', google: 'Gemini', cerebras: 'Cerebras', openrouter: 'OpenRouter' };

/**
 * The models the chat composer offers, as the entity names them ("openai-codex/gpt-6-sol"): one choice per model and
 * reasoning level, only those the entity's minds can run.
 */
async function entityModelChoices(isModel: (id: string) => Promise<boolean>) {
  const runnable = new Map<string, boolean>();
  const choices: { provider: string; id: string; name: string; thinkingLevel: string }[] = [];
  for (const option of HUB_AGENT_MODEL_OPTIONS) {
    const provider = toBlipModelProvider(option.provider);
    const full = `${provider}/${option.id}`;
    if (!runnable.has(full)) runnable.set(full, await isModel(full));
    if (!runnable.get(full)) continue;
    choices.push({ provider, id: option.id, name: `${option.name} · ${PROVIDER_LABELS[provider] ?? provider}`, thinkingLevel: option.thinkingLevel || 'off' });
  }
  return choices;
}

export const ENTITY_WORKSPACE_ID = 'entity-workspace';

const CONTROL_ACTIONS = new Set(['start', 'pause', 'resume', 'reset']);
const INPUT_TYPES = new Set(['chat_message', 'draft_changed', 'key_down', 'key_up']);

/**
 * The entity test bench: one live session, controlled and streamed over HTTP. With `createWorkspaceService` (the
 * Companion's, per session) the entity works across the workspaces the session selects; without it, in its home folder.
 */
export function registerEntityRoutes(router: HubRouter, overrides: { session?: EntitySession; createWorkspaceService?: CreateWorkspaceService; profiles?: EntityProfiles; prompts?: EntityPrompts; isModel?: (id: string) => Promise<boolean> } = {}): void {
  const profiles = overrides.profiles ?? new EntityProfiles(droneRootPath('entity-profiles.json'));
  const prompts = overrides.prompts ?? new EntityPrompts(droneRootPath('entity-prompts.json'));
  /** Checks models from a request against what the entity's minds can run. */
  const checkModels = async (value: unknown): Promise<EntityModels | string> => {
    const isModel = overrides.isModel ?? isRunnableModel;
    const v = value as Record<string, { model?: unknown } | null> | null;
    const ids = v && typeof v === 'object' ? ['head', 'task', 'voice'].map(k => v[k]?.model).filter((m): m is string => typeof m === 'string') : [];
    const runnable = new Set<string>();
    for (const id of ids) if (await isModel(id)) runnable.add(id);
    return parseModels(value, id => runnable.has(id));
  };
  // Created on first use: blip's tool definitions load once, before the session that offers them.
  let created: Promise<EntitySession> | null = null;
  const current = (): Promise<EntitySession> => {
    if (overrides.session) return Promise.resolve(overrides.session);
    return (created ??= (async () => {
      const createWorkspaceService = overrides.createWorkspaceService;
      const workspaceDefinitions = createWorkspaceService ? await workspaceToolDefinitions().catch(error => {
        console.warn('[entity] workspace tools unavailable:', error instanceof Error ? error.message : error);
        return undefined;
      }) : undefined;
      return new EntitySession(createEvaluator, {}, undefined, { createWorkspaceService, workspaceDefinitions, prompts });
    })());
  };
  // The explorer and editor browse the entity's home folder like a host drone's folder (see folder-workspaces.ts).
  registerFolderWorkspace({ id: ENTITY_WORKSPACE_ID, name: 'Entity home', root: async () => (await current()).getConfig().workspace || defaultEntityWorkspace() });

  router.get('/api/entity/state', async ({ json }) => { json(200, { ok: true, ...(await current()).state() }); });

  // Recorded sessions, for replay in the bench (files live in sessionsDir; see its README.md).
  router.get('/api/entity/sessions', async ({ json }) => {
    const session = await current();
    json(200, { ok: true, sessions: session.sessions(), current: session.state().sessionId, dir: session.sessionsPath });
  });

  router.get('/api/entity/sessions/:id', async ({ params, json, fail }) => {
    if (!isSessionId(params.id)) return fail(400, 'invalid session id');
    const recording = (await current()).recording(params.id);
    if (!recording) return fail(404, 'session not found');
    json(200, { ok: true, ...recording });
  });

  router.get('/api/entity/stream', async ({ req, res }) => {
    const session = await current();
    res.statusCode = 200;
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('connection', 'keep-alive');
    req.socket.setTimeout(0);
    (res as { flushHeaders?: () => void }).flushHeaders?.();
    const write = (event: string, data: unknown) => {
      if (res.destroyed || res.writableEnded) return;
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      res.write(payload);
      // Bun's HTTP client can hold back a large chunk until more data arrives; a comment right after releases it for
      // Bun clients reading this stream directly (the UI server's proxy avoids the client altogether). EventSource
      // ignores comments.
      if (payload.length > 8192) res.write(': flush\n\n');
    };
    write('state', session.state());
    const unsubscribe = session.subscribe(message => {
      if (message.kind === 'event') write('event', message.event);
      else if (message.kind === 'snapshot') write('snapshot', message.snapshot);
      else write('state', session.state());
    });
    const keepAlive = setInterval(() => { if (!res.destroyed && !res.writableEnded) res.write(': keepalive\n\n'); }, 25_000);
    (keepAlive as { unref?: () => void }).unref?.();
    let cleaned = false;
    const cleanup = () => { if (cleaned) return; cleaned = true; clearInterval(keepAlive); unsubscribe(); };
    req.on('close', cleanup);
    res.on('close', cleanup);
  });

  router.post('/api/entity/control', async ({ readJson, json, fail }) => {
    const body = await readJson<{ action?: string }>();
    if (!body?.action || !CONTROL_ACTIONS.has(body.action)) return fail(400, 'action must be start, pause, resume or reset');
    const session = await current();
    session.control(body.action as 'start');
    json(200, { ok: true, status: session.status });
  });

  router.post('/api/entity/input', async ({ readJson, json, fail }) => {
    const body = await readJson<{ type?: string; data?: Record<string, unknown> }>();
    if (!body?.type || !INPUT_TYPES.has(body.type)) return fail(400, `type must be one of ${[...INPUT_TYPES].join(', ')}`);
    const data = body.data && typeof body.data === 'object' ? body.data : {};
    if ((body.type === 'key_down' || body.type === 'key_up') && !/^\d$/.test(String(data.key))) return fail(400, 'key must be a single digit');
    if ((body.type === 'chat_message' || body.type === 'draft_changed') && typeof data.text !== 'string') return fail(400, 'text must be a string');
    if (typeof data.text === 'string' && data.text.length > 8000) return fail(400, 'text is too long');
    // A chat message may answer a question: reply_to is that question's seq (a clicked option).
    const replyTo = body.type === 'chat_message' && Number.isInteger(data.reply_to) && (data.reply_to as number) > 0 ? { reply_to: data.reply_to as number } : {};
    const event = (await current()).input(body.type, body.type.startsWith('key') ? { key: String(data.key) } : { text: data.text, ...replyTo });
    json(200, { ok: true, seq: event.seq });
  });

  // The Files view browses a granted workspace like a folder: a drone through its own file routes, a folder or
  // repository on this device registered for the time being. Folders other devices share are not browsable here.
  router.get('/api/entity/files-target', async ({ url, json, fail }) => {
    const id = url.searchParams.get('target') ?? '';
    const session = await current();
    if (!session.getConfig().workspaceAccess.targets.some(t => t.id === id)) return fail(404, 'that workspace is not granted to this session');
    let option;
    try { option = (await session.workspaceCatalog()).workspaces.find(w => w.id === id); }
    catch (error) { return fail(409, error instanceof Error ? error.message : String(error)); }
    if (!option) return fail(404, 'that workspace is not available right now');
    if (option.kind === 'drone' && option.droneId) return json(200, { ok: true, workspaceId: option.droneId, name: option.name });
    if (option.kind === 'host' && option.path) {
      const root = option.path;
      const workspaceId = `entity-files-${option.workspaceId ?? id.replace(/[^a-z0-9]/gi, '')}`;
      registerFolderWorkspace({ id: workspaceId, name: option.name, root: async () => root });
      return json(200, { ok: true, workspaceId, name: option.name });
    }
    fail(400, 'folders shared by other devices cannot be browsed here yet');
  });

  router.get('/api/entity/models', async ({ json }) => { json(200, { ok: true, models: await entityModelChoices(overrides.isModel ?? isRunnableModel) }); });

  // Prompts: every section with its default and the user's edit; edits apply from each limb's next wake.
  router.get('/api/entity/prompts', ({ json }) => { json(200, { ok: true, sections: prompts.list() }); });
  router.post('/api/entity/prompts', async ({ readJson, json, fail }) => {
    const body = await readJson<{ id?: string; text?: string }>();
    if (typeof body?.id !== 'string' || typeof body.text !== 'string') return fail(400, 'id and text are required');
    if (body.text.length > 40_000) return fail(400, 'a prompt section must be at most 40000 characters');
    try { prompts.save(body.id, body.text); } catch (error) { return fail(404, error instanceof Error ? error.message : String(error)); }
    json(200, { ok: true, sections: prompts.list() });
  });
  router.post('/api/entity/prompts/reset', async ({ readJson, json }) => {
    const body = await readJson<{ id?: string }>();
    prompts.reset(typeof body?.id === 'string' ? body.id : undefined);
    json(200, { ok: true, sections: prompts.list() });
  });

  // Profiles: named sets of models and reasoning levels to switch between.
  router.get('/api/entity/profiles', ({ json }) => { json(200, { ok: true, profiles: profiles.list() }); });
  router.post('/api/entity/profiles', async ({ readJson, json, fail }) => {
    const body = await readJson<{ id?: string; name?: string; models?: unknown }>();
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 60) return fail(400, 'a profile name must be 1-60 characters');
    if (body?.id !== undefined && typeof body.id !== 'string') return fail(400, 'id must be a string');
    const models = await checkModels(body?.models);
    if (typeof models === 'string') return fail(400, models);
    try { json(200, { ok: true, profile: profiles.save({ id: body?.id, name, models }), profiles: profiles.list() }); }
    catch (error) { fail(409, error instanceof Error ? error.message : String(error)); }
  });
  router.post('/api/entity/profiles/delete', async ({ readJson, json, fail }) => {
    const body = await readJson<{ id?: string }>();
    if (typeof body?.id !== 'string' || !profiles.remove(body.id)) return fail(404, 'no such profile');
    json(200, { ok: true, profiles: profiles.list() });
  });

  router.post('/api/entity/worker', async ({ readJson, json, fail }) => {
    const body = await readJson<{ id?: string; action?: string; text?: string; answers?: number }>();
    if (!body?.id || (body.action !== 'message' && body.action !== 'stop' && body.action !== 'rename')) return fail(400, 'id and action (message, stop or rename) are required');
    if (body.action === 'message' && (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4000)) return fail(400, 'text must be 1-4000 characters');
    if (body.action === 'rename' && (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 60)) return fail(400, 'a name must be 1-60 characters');
    const answers = Number.isInteger(body.answers) && (body.answers as number) > 0 ? body.answers : undefined;
    const result = (await current()).worker(String(body.id), body.action, body.text ?? '', answers);
    if (result.startsWith('error')) return fail(400, result.replace(/^error: /, ''));
    json(200, { ok: true, result });
  });

  router.post('/api/entity/reroute', async ({ readJson, json, fail }) => {
    const body = await readJson<{ seq?: number; how?: string }>();
    if (typeof body?.seq !== 'number' || (body.how !== 'separate' && body.how !== 'fork')) return fail(400, 'seq and how (separate or fork) are required');
    const result = (await current()).reroute(body.seq, body.how);
    if (result.startsWith('error')) return fail(400, result.replace(/^error: /, ''));
    json(200, { ok: true, result });
  });

  // The session's workspaces: the same catalog and saves as the Companion's picker (see entity-workspaces.ts).
  router.get('/api/entity/workspaces', async ({ url, json, fail }) => {
    try { json(200, await (await current()).workspaceCatalog(url.searchParams.get('deviceId') || undefined)); }
    catch (error) { fail(400, error instanceof Error ? error.message : String(error)); }
  });

  router.post('/api/entity/workspaces', async ({ readJson, json, fail }) => {
    const body = await readJson<{ access?: unknown; revision?: string }>();
    if (!body || typeof body.revision !== 'string') return fail(400, 'access and revision are required');
    try { json(200, await (await current()).saveWorkspaces(body.access, body.revision)); }
    catch (error) { fail(409, error instanceof Error ? error.message : String(error)); }
  });

  router.post('/api/entity/config', async ({ readJson, json, fail }) => {
    const body = await readJson<Partial<EntitySessionConfig>>();
    const update: Partial<EntitySessionConfig> = {};
    if (body?.models !== undefined) {
      const models = await checkModels(body.models);
      if (typeof models === 'string') return fail(400, models);
      update.models = models;
    }
    if (body?.summaries !== undefined) update.summaries = body.summaries === true;
    if (body?.review !== undefined) { if (!['off', 'separate', 'head'].includes(body.review)) return fail(400, 'review must be off, separate or head'); update.review = body.review; }
    if (body?.workspace !== undefined) {
      const dir = String(body.workspace).trim();
      if (dir && (!path.isAbsolute(dir) || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory())) return fail(400, 'the home folder must be an absolute path to an existing folder (or empty for the scratch folder)');
      update.workspace = dir;
    }
    if (body?.evaluator !== undefined) {
      if (!['off', 'jev', 'qwen'].includes(body.evaluator)) return fail(400, 'evaluator must be off, jev or qwen');
      update.evaluator = body.evaluator;
    }
    try { json(200, { ok: true, config: (await current()).configure(update) }); }
    catch (error) { fail(409, error instanceof Error ? error.message : String(error)); }
  });
}
