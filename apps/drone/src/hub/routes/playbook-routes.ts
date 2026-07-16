import crypto from 'node:crypto';
import path from 'node:path';

import type { HubRouter } from '../hub-router';

type ServiceFunction = (...args: any[]) => any;

export type PlaybookRouteDependencies = {
  listCanonicalPlaybookDefinitions: ServiceFunction;
  normalizePlaybookLabel: ServiceFunction;
  normalizePlaybookAgent: ServiceFunction;
  parseChatModelForUpdate: ServiceFunction;
  normalizePlaybookMessages: ServiceFunction;
  normalizePlaybookArtifacts: ServiceFunction;
  normalizePlaybookActions: ServiceFunction;
  nowIso: () => string;
  getCatalogStore: ServiceFunction;
  catalogPlaybookRecord: ServiceFunction;
  updateRegistry: ServiceFunction;
  normalizePlaybookDefinitions: ServiceFunction;
  parsePullHostBranchBeforeCreate: ServiceFunction;
  PLAYBOOK_RUN_QUEUE_BATCH_MIN: number;
  PLAYBOOK_RUN_QUEUE_BATCH_MAX: number;
  startPlaybookRunLaunch: ServiceFunction;
  formatPullHostBranchBeforeCreateError: ServiceFunction;
  enqueueCanonicalPlaybookQueueItem: ServiceFunction;
  runPlaybookRunQueueCycle: ServiceFunction;
  loadRegistry: ServiceFunction;
  normalizeDroneIdentity: ServiceFunction;
  playbookMetaFromEntry: ServiceFunction;
  normalizeDroneEntryKind: ServiceFunction;
  summarizePlaybookRunEntry: ServiceFunction;
  normalizeDroneRuntime: ServiceFunction;
  summarizePlaybookRunQueueItems: ServiceFunction;
  workflowStoreOrCompatibility: ServiceFunction;
  readPlaybookRunQueueItems: ServiceFunction;
  writePlaybookRunQueueItems: ServiceFunction;
};

export function registerPlaybookRoutes(router: HubRouter, deps: PlaybookRouteDependencies): void {
  const {
    listCanonicalPlaybookDefinitions,
    normalizePlaybookLabel,
    normalizePlaybookAgent,
    parseChatModelForUpdate,
    normalizePlaybookMessages,
    normalizePlaybookArtifacts,
    normalizePlaybookActions,
    nowIso,
    getCatalogStore,
    catalogPlaybookRecord,
    updateRegistry,
    normalizePlaybookDefinitions,
    parsePullHostBranchBeforeCreate,
    PLAYBOOK_RUN_QUEUE_BATCH_MIN,
    PLAYBOOK_RUN_QUEUE_BATCH_MAX,
    startPlaybookRunLaunch,
    formatPullHostBranchBeforeCreateError,
    enqueueCanonicalPlaybookQueueItem,
    runPlaybookRunQueueCycle,
    loadRegistry,
    normalizeDroneIdentity,
    playbookMetaFromEntry,
    normalizeDroneEntryKind,
    summarizePlaybookRunEntry,
    normalizeDroneRuntime,
    summarizePlaybookRunQueueItems,
    workflowStoreOrCompatibility,
    readPlaybookRunQueueItems,
    writePlaybookRunQueueItems,
  } = deps;

  const parsePlaybookBody = (body: any) => {
    const label = normalizePlaybookLabel(body?.label ?? '');
    const agent = normalizePlaybookAgent(body?.agent);
    const model = agent.kind === 'builtin' ? parseChatModelForUpdate(body?.model) : null;
    return {
      label,
      agent,
      model,
      messages: normalizePlaybookMessages(body?.messages),
      artifacts: normalizePlaybookArtifacts(body?.artifacts),
      actions: normalizePlaybookActions(body?.actions),
    };
  };

  const normalizedPlaybook = (playbook: any) =>
    normalizePlaybookDefinitions({ playbooks: { [playbook.id]: playbook } })[0] ?? null;

  const persistPlaybook = async (playbook: any) => {
    try {
      await (await getCatalogStore()).putPlaybook(catalogPlaybookRecord(playbook));
    } catch (error) {
      if (!(globalThis as any).Bun) throw error;
      await updateRegistry((registry: any) => {
        registry.playbooks = registry.playbooks ?? {};
        registry.playbooks[playbook.id] = playbook;
      });
    }
  };

  router.get('/api/playbooks', async ({ json }) => {
    json(200, { ok: true, playbooks: await listCanonicalPlaybookDefinitions() });
  });

  router.post('/api/playbooks', async ({ readJson, fail, json }) => {
    let input: any;
    try {
      input = parsePlaybookBody(await readJson());
    } catch (error: any) {
      return fail(400, error?.message ?? String(error));
    }
    if (!input.label) return fail(400, 'missing label');
    if (input.messages.length === 0) return fail(400, 'add at least one message');

    const id = crypto.randomUUID();
    const at = nowIso();
    await listCanonicalPlaybookDefinitions();
    const playbook = { id, ...input, createdAt: at, updatedAt: at };
    if (!playbook.model) delete playbook.model;
    await persistPlaybook(playbook);
    json(201, { ok: true, playbook: normalizedPlaybook(playbook) });
  });

  router.delete('/api/playbooks', async ({ json }) => {
    try {
      await listCanonicalPlaybookDefinitions();
      await (await getCatalogStore()).clearPlaybooks();
    } catch (error) {
      if (!(globalThis as any).Bun) throw error;
      await updateRegistry((registry: any) => {
        registry.playbooks = {};
      });
    }
    json(200, { ok: true });
  });

  router.post('/api/playbooks/:playbookId', async ({ params, readJson, fail, json }) => {
    const playbookId = params.playbookId.trim();
    if (!playbookId) return fail(400, 'missing playbook id');
    let input: any;
    try {
      input = parsePlaybookBody(await readJson());
    } catch (error: any) {
      return fail(400, error?.message ?? String(error));
    }
    if (!input.label) return fail(400, 'missing label');
    if (input.messages.length === 0) return fail(400, 'add at least one message');
    const current = (await listCanonicalPlaybookDefinitions()).find(
      (item: any) => item.id === playbookId,
    );
    if (!current) return fail(404, `unknown playbook: ${playbookId}`);

    const playbook = {
      id: playbookId,
      ...input,
      createdAt: current.createdAt,
      updatedAt: nowIso(),
    };
    if (!playbook.model) delete playbook.model;
    await persistPlaybook(playbook);
    json(200, { ok: true, playbook: normalizedPlaybook(playbook) });
  });

  router.delete('/api/playbooks/:playbookId', async ({ params, fail, json }) => {
    const playbookId = params.playbookId.trim();
    if (!playbookId) return fail(400, 'missing playbook id');
    let removed = false;
    try {
      await listCanonicalPlaybookDefinitions();
      removed = await (await getCatalogStore()).deletePlaybook(playbookId);
    } catch (error) {
      if (!(globalThis as any).Bun) throw error;
      removed = await updateRegistry((registry: any) => {
        if (!registry?.playbooks?.[playbookId]) return false;
        delete registry.playbooks[playbookId];
        return true;
      });
    }
    if (!removed) return fail(404, `unknown playbook: ${playbookId}`);
    json(200, { ok: true, id: playbookId });
  });

  router.post('/api/playbooks/:playbookId/run', async ({ params, readJson, fail, json }) => {
    const playbookId = params.playbookId.trim();
    if (!playbookId) return fail(400, 'missing playbook id');
    const body = await readJson<any>();
    const repoPath = typeof body?.repoPath === 'string' ? body.repoPath.trim() : '';
    if (!repoPath) return fail(400, 'missing repoPath');
    if (!path.isAbsolute(repoPath)) {
      return fail(400, 'invalid repoPath (expected absolute path)');
    }
    const pullHostBranchBeforeCreate = parsePullHostBranchBeforeCreate(
      body?.pullHostBranchBeforeCreate,
    );
    const requestedCount = Math.max(
      PLAYBOOK_RUN_QUEUE_BATCH_MIN,
      Math.min(PLAYBOOK_RUN_QUEUE_BATCH_MAX, Math.floor(Number(body?.count ?? 1) || 1)),
    );
    const serializeFirstMessageGroup = body?.serializeFirstMessageGroup === true;
    const playbook = (await listCanonicalPlaybookDefinitions()).find(
      (item: any) => item.id === playbookId,
    );
    if (!playbook) return fail(404, `unknown playbook: ${playbookId}`);
    if (playbook.messages.length === 0) return fail(409, 'playbook has no messages');

    if (!serializeFirstMessageGroup && requestedCount === 1) {
      try {
        json(
          202,
          await startPlaybookRunLaunch({
            playbookId: playbook.id,
            repoPath,
            pullHostBranchBeforeCreate,
          }),
        );
      } catch (error: any) {
        if (pullHostBranchBeforeCreate) {
          const pullError = formatPullHostBranchBeforeCreateError(error);
          json(pullError.status, {
            ok: false,
            error: `Failed to pull host branch before launching playbook: ${pullError.message}`,
            code: 'host_branch_pull_before_playbook_run_failed',
            reason: pullError.reason,
          });
          return;
        }
        const message = error?.message ?? String(error);
        json(
          /unknown playbook/i.test(message)
            ? 404
            : /playbook has no messages/i.test(message)
              ? 409
              : 500,
          { ok: false, error: message },
        );
      }
      return;
    }

    const queueItem = {
      id: crypto.randomUUID(),
      playbookId: playbook.id,
      playbookLabel: playbook.label,
      repoPath,
      requestedCount,
      launchedCount: 0,
      inFlightCount: 0,
      serializeFirstMessageGroup,
      pullHostBranchBeforeCreate,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await enqueueCanonicalPlaybookQueueItem(queueItem);
    void runPlaybookRunQueueCycle();
    json(202, {
      ok: true,
      queued: true,
      queueItem: {
        ...queueItem,
        remainingCount: queueItem.requestedCount,
        state: serializeFirstMessageGroup ? 'waiting' : 'queued',
      },
      playbookId: playbook.id,
      playbookLabel: playbook.label,
      repoPath,
    });
  });

  router.get('/api/playbook-runs', async ({ url, json }) => {
    const repoPath = url.searchParams.has('repoPath')
      ? String(url.searchParams.get('repoPath') ?? '').trim()
      : '';
    const registry = await loadRegistry();
    const byId = new Map<string, any>();
    const collect = (entries: any, state: 'pendingEntry' | 'droneEntry') => {
      for (const [rawId, entry] of Object.entries(entries ?? {})) {
        const droneId = normalizeDroneIdentity((entry as any)?.id ?? rawId);
        const playbook = playbookMetaFromEntry((entry as any)?.playbook);
        if (
          !droneId ||
          !playbook ||
          normalizeDroneEntryKind((entry as any)?.kind) !== 'playbook-run'
        ) {
          continue;
        }
        const entryRepoPath = String((entry as any)?.repoPath ?? '').trim();
        if (repoPath && repoPath !== entryRepoPath) continue;
        byId.set(
          droneId,
          summarizePlaybookRunEntry({
            droneId,
            name: String((entry as any)?.name ?? droneId).trim() || droneId,
            createdAt: String((entry as any)?.createdAt ?? nowIso()),
            repoPath: entryRepoPath,
            runtime: normalizeDroneRuntime((entry as any)?.runtime),
            playbook,
            [state]: entry,
          }),
        );
      }
    };
    collect(registry.pending, 'pendingEntry');
    collect(registry.drones, 'droneEntry');
    const runs = Array.from(byId.values()).sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
        Date.parse(right.createdAt) - Date.parse(left.createdAt),
    );
    const queue = (await summarizePlaybookRunQueueItems(registry)).filter(
      (item: any) => !repoPath || item.repoPath === repoPath,
    );
    json(200, { ok: true, runs, queue });
  });

  router.delete('/api/playbook-runs/queue/:queueItemId', async ({ params, fail, json }) => {
    const queueItemId = params.queueItemId.trim();
    if (!queueItemId) return fail(400, 'missing queue item id');
    const store = await workflowStoreOrCompatibility();
    const removed = store
      ? await store.cancelQueue(queueItemId)
      : await updateRegistry((registry: any) => {
          const items = readPlaybookRunQueueItems(registry);
          const found = items.some((item: any) => item.id === queueItemId);
          writePlaybookRunQueueItems(
            registry,
            items.filter((item: any) => item.id !== queueItemId),
          );
          return found;
        });
    if (removed) void runPlaybookRunQueueCycle();
    json(
      removed ? 200 : 404,
      removed
        ? { ok: true, removed: true, id: queueItemId }
        : { ok: false, error: `unknown queue item: ${queueItemId}` },
    );
  });

  router.post('/api/playbook-runs/queue/clear', async ({ readJson, json }) => {
    const body = await readJson<any>();
    const playbookId = typeof body?.playbookId === 'string' ? body.playbookId.trim() : '';
    const repoPath = typeof body?.repoPath === 'string' ? body.repoPath.trim() : '';
    const store = await workflowStoreOrCompatibility();
    const removed = store
      ? await store.clearQueue({ playbookId, repoPath })
      : await updateRegistry((registry: any) => {
          const items = readPlaybookRunQueueItems(registry);
          const matching = items.filter(
            (item: any) =>
              (!playbookId || item.playbookId === playbookId) &&
              (!repoPath || item.repoPath === repoPath),
          );
          writePlaybookRunQueueItems(
            registry,
            items.filter((item: any) => !matching.includes(item)),
          );
          return matching.length;
        });
    if (removed > 0) void runPlaybookRunQueueCycle();
    json(200, {
      ok: true,
      removed,
      ...(playbookId ? { playbookId } : {}),
      ...(repoPath ? { repoPath } : {}),
    });
  });
}
