import { describe, expect, test } from 'bun:test';
import { Readable } from 'node:stream';

import { findDroneEntryByIdentity, findDroneIdByRef } from '../src/hub/drone-lifecycle-registry';
import { createDroneProvisioningRouteHandler } from '../src/hub/routes/drone-provisioning-routes';

const storyRepo = '/repos/StorySpark';
const groupName = 'case-studies/camera-formats/tests';

async function createClone(
  batch: boolean,
  overrides: Record<string, unknown> = {},
  sourceRepo = storyRepo,
  groupRepo = storyRepo,
) {
  const registry = {
    drones: {
      'source-id': { id: 'source-id', name: 'empty', runtime: 'container', repoPath: sourceRepo },
    },
    pending: {},
  };
  const persisted: any[] = [];
  const enqueued: string[] = [];
  const environmentRepos: string[] = [];
  const ensuredGroups: any[] = [];
  const group = { id: 'group-id', name: groupName, repoPath: groupRepo };
  const deriveEnvironment = (_registry: any, opts: any) => {
    environmentRepos.push(opts.repoPath);
    return { vars: { REPO: opts.repoPath }, useRepoVars: true };
  };
  const handler = createDroneProvisioningRouteHandler({
    loadCanonicalLifecycleModel: async () => registry,
    loadRegistry: async () => registry,
    canonicalRepositoriesMap: async () => ({}),
    resolveCanonicalGroupReference: async (id: string) => (id === group.id ? group : null),
    ensureCanonicalGroup: async (name: string, repoPath: string) => {
      ensuredGroups.push({ name, repoPath });
      return { id: group.id, name, repoPath };
    },
    findDroneIdByRef,
    findDroneEntryByIdentity,
    createRequestTimer: () => ({ mark() {}, setHeader() {} }),
    logSlowHubRequest() {},
    normalizeDroneDisplayName: (name: string) => name,
    droneDisplayNameExists: () => false,
    normalizeDroneRuntime: (runtime: string) => runtime || 'container',
    parseCreateRuntime: (runtime: string) => runtime || 'container',
    parseDraftFlag: (draft: unknown) => draft === true,
    parseRepoBranchSourceMode: () => 'host',
    parseRemoteBranchName: () => '',
    parsePersistVolume: () => undefined,
    normalizeChatImageAttachments: () => [],
    normalizeChatName: (name: string) => name,
    parseSeedAgent: () => null,
    parseChatModelForUpdate: () => null,
    normalizeChatReasoning: () => null,
    normalizeSubmittedAtIso: () => '2026-09-14T00:00:00.000Z',
    resolveEffectiveLlmProvider: async () => ({ provider: 'openai' }),
    deriveCanonicalCreatedDroneEnvironmentConfig: deriveEnvironment,
    deriveCreatedDroneEnvironmentConfig: deriveEnvironment,
    makeDroneIdentity: () => 'clone-id',
    nowIso: () => '2026-09-14T00:00:00.000Z',
    upsertCanonicalDroneLifecycle: async (_state: string, _id: string, entry: any) =>
      persisted.push(entry),
    upsertCanonicalDroneLifecycleBatch: async (entries: any[]) =>
      persisted.push(...entries.map((item) => item.entry)),
    notifyCanonicalDroneRegistryWrite() {},
    enqueueProvisioning: (id: string) => enqueued.push(id),
  } as any);
  const body = { name: 'draft-1', cloneFrom: 'empty', groupId: group.id, ...overrides };
  const req = Readable.from([JSON.stringify(batch ? { drones: [body] } : body)]);
  let responseBody: any;
  const res = {
    writableEnded: false,
    statusCode: 0,
    setHeader() {},
    end(data: string) {
      responseBody = JSON.parse(data);
      this.writableEnded = true;
    },
  };
  const parts = batch ? ['api', 'drones', 'batch'] : ['api', 'drones'];
  await handler({
    req: req as any,
    res: res as any,
    method: 'POST',
    parts,
    url: new URL(`http://hub.test/${parts.join('/')}`),
  });
  return {
    status: res.statusCode,
    body: responseBody,
    persisted,
    enqueued,
    environmentRepos,
    ensuredGroups,
  };
}

for (const batch of [false, true]) {
  describe(batch ? 'batch clone creation' : 'clone creation', () => {
    for (const draft of [false, true]) {
      test(`inherits the source repository before group validation (${draft ? 'draft' : 'starting'})`, async () => {
        const result = await createClone(batch, { draft });
        expect(result.status).toBe(batch || !draft ? 202 : 201);
        if (batch) expect(result.body.rejected).toEqual([]);
        expect(result.persisted).toHaveLength(1);
        expect(result.persisted[0]).toMatchObject({
          repoPath: storyRepo,
          groupId: 'group-id',
          group: groupName,
          cloneFrom: 'source-id',
          phase: draft ? 'draft' : 'starting',
        });
        expect(result.environmentRepos).toEqual([storyRepo]);
        expect(result.enqueued).toEqual(draft ? [] : ['clone-id']);
      });
    }

    test('rejects a destination group belonging to another repository', async () => {
      const result = await createClone(batch, {}, storyRepo, '/repos/Other');
      const error = batch ? result.body.rejected[0] : result.body;
      expect(error.error).toBe('group belongs to a different repository');
      expect(batch ? error.status : result.status).toBe(409);
      expect(result.persisted).toEqual([]);
      expect(result.enqueued).toEqual([]);
    });

    test('resolves sources by stable ID and scopes named groups to the inherited repository', async () => {
      const result = await createClone(batch, {
        cloneFrom: 'source-id',
        groupId: undefined,
        group: groupName,
      });
      expect(result.persisted[0]).toMatchObject({ repoPath: storyRepo, groupId: 'group-id' });
      expect(result.ensuredGroups).toEqual([{ name: groupName, repoPath: storyRepo }]);
    });

    test('preserves an explicitly supplied repository', async () => {
      const result = await createClone(
        batch,
        { repoPath: '/repos/Explicit' },
        storyRepo,
        '/repos/Explicit',
      );
      expect(result.persisted[0]?.repoPath).toBe('/repos/Explicit');
      expect(result.environmentRepos).toEqual(['/repos/Explicit']);
    });

    test('supports sources without a repository', async () => {
      const result = await createClone(batch, {}, '', '');
      expect(result.persisted[0]?.repoPath).toBe('');
    });

    test('rejects unknown sources before repository validation', async () => {
      const result = await createClone(batch, { cloneFrom: 'missing' });
      const error = batch ? result.body.rejected[0] : result.body;
      expect(error.error).toBe('unknown cloneFrom drone: missing');
      expect(batch ? error.status : result.status).toBe(404);
      expect(result.persisted).toEqual([]);
    });
  });
}
