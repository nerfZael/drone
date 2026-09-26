import fs from 'node:fs';
import path from 'node:path';
import type { HubRouter } from '../hub-router';
import { registerFolderWorkspace } from '../folder-workspaces';
import { defaultEntityWorkspace, EntitySession, type EntitySessionConfig } from './entity-session';
import { workspaceToolDefinitions, type CreateWorkspaceService } from './entity-workspaces';
import { createEvaluator } from './entity-evaluator';
import { isSessionId } from './entity-recorder';

export const ENTITY_WORKSPACE_ID = 'entity-workspace';

const CONTROL_ACTIONS = new Set(['start', 'pause', 'resume', 'reset']);
const INPUT_TYPES = new Set(['chat_message', 'draft_changed', 'key_down', 'key_up']);
const MODELS = new Set(['openai-codex/gpt-6-luna', 'openai-codex/gpt-6-sol', 'cerebras/qwen-3.8-27b']);

/**
 * The entity test bench: one live session, controlled and streamed over HTTP. With `createWorkspaceService` (the
 * Companion's, per session) the entity works across the workspaces the session selects; without it, in its home folder.
 */
export function registerEntityRoutes(router: HubRouter, overrides: { session?: EntitySession; createWorkspaceService?: CreateWorkspaceService } = {}): void {
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
      return new EntitySession(createEvaluator, {}, undefined, { createWorkspaceService, workspaceDefinitions });
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
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
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
    const event = (await current()).input(body.type, body.type.startsWith('key') ? { key: String(data.key) } : { text: data.text });
    json(200, { ok: true, seq: event.seq });
  });

  router.post('/api/entity/worker', async ({ readJson, json, fail }) => {
    const body = await readJson<{ id?: string; action?: string; text?: string }>();
    if (!body?.id || (body.action !== 'message' && body.action !== 'stop' && body.action !== 'rename')) return fail(400, 'id and action (message, stop or rename) are required');
    if (body.action === 'message' && (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4000)) return fail(400, 'text must be 1-4000 characters');
    if (body.action === 'rename' && (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 60)) return fail(400, 'a name must be 1-60 characters');
    const result = (await current()).worker(String(body.id), body.action, body.text ?? '');
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
    if (body?.headModel !== undefined) { if (!MODELS.has(body.headModel)) return fail(400, 'unsupported head model'); update.headModel = body.headModel; }
    if (body?.taskModel !== undefined) { if (!MODELS.has(body.taskModel)) return fail(400, 'unsupported task model'); update.taskModel = body.taskModel; }
    if (body?.voiceModel !== undefined) {
      if (body.voiceModel !== '' && !MODELS.has(body.voiceModel)) return fail(400, 'unsupported voice model');
      update.voiceModel = body.voiceModel;
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
