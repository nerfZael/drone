import fs from 'node:fs';
import path from 'node:path';
import type { HubRouter } from '../hub-router';
import { registerFolderWorkspace } from '../folder-workspaces';
import { defaultEntityWorkspace, EntitySession, type EntitySessionConfig } from './entity-session';
import { createEvaluator } from './entity-evaluator';
import { isSessionId } from './entity-recorder';

export const ENTITY_WORKSPACE_ID = 'entity-workspace';

const CONTROL_ACTIONS = new Set(['start', 'pause', 'resume', 'reset']);
const INPUT_TYPES = new Set(['chat_message', 'draft_changed', 'key_down', 'key_up']);
const MODELS = new Set(['openai-codex/gpt-6-luna', 'openai-codex/gpt-6-sol', 'cerebras/qwen-3.8-27b']);

let session: EntitySession | null = null;
const getSession = () => (session ??= new EntitySession(createEvaluator));

/** The entity test bench: one live session, controlled and streamed over HTTP. */
export function registerEntityRoutes(router: HubRouter, overrides: { session?: EntitySession } = {}): void {
  const current = () => overrides.session ?? getSession();
  // The explorer and editor browse the entity workspace like a host drone's folder (see folder-workspaces.ts).
  registerFolderWorkspace({ id: ENTITY_WORKSPACE_ID, name: 'Entity workspace', root: async () => current().getConfig().workspace || defaultEntityWorkspace() });

  router.get('/api/entity/state', ({ json }) => { json(200, { ok: true, ...current().state() }); });

  // Recorded sessions, for replay in the bench (files live in sessionsDir; see its README.md).
  router.get('/api/entity/sessions', ({ json }) => {
    json(200, { ok: true, sessions: current().sessions(), current: current().state().sessionId, dir: current().sessionsPath });
  });

  router.get('/api/entity/sessions/:id', ({ params, json, fail }) => {
    if (!isSessionId(params.id)) return fail(400, 'invalid session id');
    const recording = current().recording(params.id);
    if (!recording) return fail(404, 'session not found');
    json(200, { ok: true, ...recording });
  });

  router.get('/api/entity/stream', ({ req, res }) => {
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
    write('state', current().state());
    const unsubscribe = current().subscribe(message => {
      if (message.kind === 'event') write('event', message.event);
      else if (message.kind === 'snapshot') write('snapshot', message.snapshot);
      else write('state', current().state());
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
    current().control(body.action as 'start');
    json(200, { ok: true, status: current().status });
  });

  router.post('/api/entity/input', async ({ readJson, json, fail }) => {
    const body = await readJson<{ type?: string; data?: Record<string, unknown> }>();
    if (!body?.type || !INPUT_TYPES.has(body.type)) return fail(400, `type must be one of ${[...INPUT_TYPES].join(', ')}`);
    const data = body.data && typeof body.data === 'object' ? body.data : {};
    if ((body.type === 'key_down' || body.type === 'key_up') && !/^\d$/.test(String(data.key))) return fail(400, 'key must be a single digit');
    if ((body.type === 'chat_message' || body.type === 'draft_changed') && typeof data.text !== 'string') return fail(400, 'text must be a string');
    if (typeof data.text === 'string' && data.text.length > 8000) return fail(400, 'text is too long');
    const event = current().input(body.type, body.type.startsWith('key') ? { key: String(data.key) } : { text: data.text });
    json(200, { ok: true, seq: event.seq });
  });

  router.post('/api/entity/worker', async ({ readJson, json, fail }) => {
    const body = await readJson<{ id?: string; action?: string; text?: string }>();
    if (!body?.id || (body.action !== 'message' && body.action !== 'stop' && body.action !== 'rename')) return fail(400, 'id and action (message, stop or rename) are required');
    if (body.action === 'message' && (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4000)) return fail(400, 'text must be 1-4000 characters');
    if (body.action === 'rename' && (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 60)) return fail(400, 'a name must be 1-60 characters');
    const result = current().worker(String(body.id), body.action, body.text ?? '');
    if (result.startsWith('error')) return fail(400, result.replace(/^error: /, ''));
    json(200, { ok: true, result });
  });

  router.post('/api/entity/reroute', async ({ readJson, json, fail }) => {
    const body = await readJson<{ seq?: number; how?: string }>();
    if (typeof body?.seq !== 'number' || (body.how !== 'separate' && body.how !== 'fork')) return fail(400, 'seq and how (separate or fork) are required');
    const result = current().reroute(body.seq, body.how);
    if (result.startsWith('error')) return fail(400, result.replace(/^error: /, ''));
    json(200, { ok: true, result });
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
    if (body?.allowCommands !== undefined) update.allowCommands = body.allowCommands === true;
    if (body?.summaries !== undefined) update.summaries = body.summaries === true;
    if (body?.review !== undefined) { if (!['off', 'separate', 'head'].includes(body.review)) return fail(400, 'review must be off, separate or head'); update.review = body.review; }
    if (body?.workspace !== undefined) {
      const dir = String(body.workspace).trim();
      if (dir && (!path.isAbsolute(dir) || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory())) return fail(400, 'workspace must be an absolute path to an existing folder (or empty for the scratch folder)');
      update.workspace = dir;
    }
    if (body?.evaluator !== undefined) {
      if (!['off', 'jev', 'qwen'].includes(body.evaluator)) return fail(400, 'evaluator must be off, jev or qwen');
      update.evaluator = body.evaluator;
    }
    try { json(200, { ok: true, config: current().configure(update) }); }
    catch (error) { fail(409, error instanceof Error ? error.message : String(error)); }
  });
}
