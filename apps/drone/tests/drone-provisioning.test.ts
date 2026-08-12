import { describe, expect, test } from 'bun:test';

import { loadRegistry, updateRegistry } from '../src/host/registry';
import { upsertCanonicalDroneLifecycle } from '../src/hub/drone-lifecycle-service';
import { createPendingDroneStateHelpers } from '../src/hub/drone-pending-state';
import { createDroneProvisioningController } from '../src/hub/drone-provisioning';
import { DroneRuntimeContainerExistsError } from '../src/hub/drone-runtime-creation-service';
import { withTempDroneDataDir } from './test-helpers';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await sleep(10);
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}

function createControllerHarness(opts?: {
  duringCreateRuntime?: (context: { droneId: string; displayName: string }) => Promise<void>;
  duringPostCreateSync?: (context: { droneId: string; stage: string }) => Promise<void>;
  failAttachedPromptStaging?: boolean;
  reservedPromptIds?: string[];
  createRuntimeError?: string;
  importRuntimeError?: string;
}) {
  const pendingStateHelpers = createPendingDroneStateHelpers({
    normalizeChatImageAttachments: (raw: unknown) => (Array.isArray(raw) ? (raw as any[]) : []),
    normalizeChatName: (raw: any) => String(raw ?? 'default').trim() || 'default',
    nowIso: () => '2026-03-26T12:00:00.000Z',
  });

  const ensureChatEntryCalls: any[] = [];
  const enqueuePromptCalls: any[] = [];
  const setChatAgentConfigCalls: any[] = [];
  const syncRepoAgentsCalls: any[] = [];
  const syncSkillLibraryCalls: any[] = [];
  const syncMcpServersCalls: any[] = [];
  const syncSharedPathsCalls: any[] = [];
  const createRuntimeCalls: any[] = [];
  const importRuntimeCalls: any[] = [];
  const pendingPromptPumpCalls: any[] = [];
  const cancelPendingPromptsCalls: any[] = [];
  const hubLogCalls: any[] = [];
  const events: string[] = [];
  const provisionedPromptHandoffs: any[] = [];

  const controller = createDroneProvisioningController({
    NON_REPO_HOME_CWD: '/dvm-data/home',
    applyPendingDisplayNameToProvisionedDrone:
      pendingStateHelpers.applyPendingDisplayNameToProvisionedDrone,
    cancelPendingPromptsForFailedDrone: async (cancelOpts) => {
      cancelPendingPromptsCalls.push(cancelOpts);
      return 1;
    },
    cloneChatEntryForDroneClone: (entryRaw: any) => JSON.parse(JSON.stringify(entryRaw ?? {})),
    defaultDaemonReadyTimeoutMs: () => 30_000,
    defaultRepoSeedTimeoutMs: () => 30_000,
    ensureChatEntry: async (opts) => {
      ensureChatEntryCalls.push(opts);
    },
    enqueuePrompt: async (enqueueOpts) => {
      enqueuePromptCalls.push(enqueueOpts);
      if (enqueueOpts.attachments?.length && opts?.failAttachedPromptStaging) {
        throw new Error('attachment staging failed');
      }
      return { id: String(enqueueOpts.id ?? 'generated'), pendingState: 'queued' };
    },
    findReservedStartupPrompt: ({ promptId }) =>
      opts?.reservedPromptIds?.includes(promptId)
        ? { prompt: 'reserved prompt', state: 'queued' }
        : null,
    enqueuePendingPromptPump: (droneId, chatName) => {
      pendingPromptPumpCalls.push({ droneId, chatName });
      events.push(`pump:${droneId}:${chatName}`);
    },
    hubLog: (...args) => {
      hubLogCalls.push(args);
    },
    inferChatAgent: (entry: any) => entry?.agent ?? { kind: 'builtin', id: 'cursor' },
    isSafePromptId: (raw: string) => /^[A-Za-z0-9._-]+$/.test(String(raw ?? '').trim()),
    normalizeChatModel: (raw: any) => {
      const value = String(raw ?? '').trim();
      return value || null;
    },
    normalizeChatName: (raw: any) => String(raw ?? 'default').trim() || 'default',
    normalizePendingStartupPrompts: pendingStateHelpers.normalizePendingStartupPrompts,
    nowIso: () => '2026-03-26T12:00:00.000Z',
    parseSeedAgent: (raw: any) => (raw && typeof raw === 'object' ? raw : null),
    registerProvisionedPromptHandoff: (handoff) => provisionedPromptHandoffs.push(handoff),
    resolvePendingDroneDisplayName: pendingStateHelpers.resolvePendingDroneDisplayName,
    createDroneRuntime: async (input) => {
      createRuntimeCalls.push({ ...input });
      const displayName = String(input.name ?? '').trim();
      const droneId = String(input.droneId ?? '').trim();
      await opts?.duringCreateRuntime?.({ droneId, displayName });
      if (opts?.createRuntimeError === 'container already exists') {
        throw new DroneRuntimeContainerExistsError('drone-existing', opts.createRuntimeError);
      }
      if (opts?.createRuntimeError) throw new Error(opts.createRuntimeError);
      await upsertCanonicalDroneLifecycle('real', droneId, {
        id: droneId,
        name: 'Untitled 25',
        runtime: 'host',
        containerName: displayName,
        createdAt: '2026-03-26T11:00:00.000Z',
        chats: {},
      });
      return { ok: true };
    },
    importContainerDroneRuntime: async (input) => {
      importRuntimeCalls.push({ ...input });
      if (opts?.importRuntimeError) throw new Error(opts.importRuntimeError);
      input.onPhaseTiming?.('resolveHostPort', 12.3);
      const droneId = String(input.droneId ?? '').trim();
      await upsertCanonicalDroneLifecycle('real', droneId, {
        id: droneId,
        name: String(input.name ?? '').trim(),
        runtime: 'container',
        containerName: `drone-${droneId}`,
        createdAt: '2026-03-26T11:00:00.000Z',
        chats: {},
      });
      return { ok: true };
    },
    setChatAgentConfig: async (opts) => {
      setChatAgentConfigCalls.push(opts);
    },
    syncManagedFilesForDrone: async (syncOpts) => {
      syncSkillLibraryCalls.push(syncOpts);
      await opts?.duringPostCreateSync?.({ droneId: syncOpts.droneId, stage: 'skills' });
      events.push('sync:skills');
      syncMcpServersCalls.push(syncOpts);
      await opts?.duringPostCreateSync?.({ droneId: syncOpts.droneId, stage: 'mcp' });
      events.push('sync:mcp');
      syncRepoAgentsCalls.push(syncOpts);
      await opts?.duringPostCreateSync?.({ droneId: syncOpts.droneId, stage: 'repo-agents' });
      events.push('sync:repo-agents');
    },
    syncSharedPathsToDrone: async (syncOpts) => {
      syncSharedPathsCalls.push(syncOpts);
      await opts?.duringPostCreateSync?.({ droneId: syncOpts.droneId, stage: 'shared-paths' });
      events.push('sync:shared-paths');
    },
  });

  return {
    controller,
    ensureChatEntryCalls,
    enqueuePromptCalls,
    setChatAgentConfigCalls,
    syncRepoAgentsCalls,
    syncSkillLibraryCalls,
    syncMcpServersCalls,
    syncSharedPathsCalls,
    createRuntimeCalls,
    importRuntimeCalls,
    pendingPromptPumpCalls,
    cancelPendingPromptsCalls,
    hubLogCalls,
    events,
    provisionedPromptHandoffs,
  };
}

describe('drone provisioning controller', () => {
  test('leaves pre-create work recoverable when shutdown stops intake', async () => {
    await withTempDroneDataDir('drone-provisioning-', async () => {
      await updateRegistry((reg: any) => {
        reg.pending = {
          'drone-pre-create': {
            id: 'drone-pre-create',
            name: 'pre-create',
            runtime: 'host',
            repoPath: '',
            build: false,
            createdAt: '2026-03-26T11:00:00.000Z',
            updatedAt: '2026-03-26T11:00:00.000Z',
            phase: 'starting',
            message: 'Starting...',
          },
        };
      });

      const harness = createControllerHarness();
      harness.controller.enqueueProvisioning('drone-pre-create');
      await harness.controller.stopProvisioning();

      let registry: any = await loadRegistry();
      expect(harness.createRuntimeCalls).toHaveLength(0);
      expect(registry?.pending?.['drone-pre-create']?.phase).toBe('starting');

      harness.controller.startProvisioning();
      harness.controller.enqueueProvisioning('drone-pre-create');
      await waitFor(async () => {
        registry = await loadRegistry();
        return Boolean(registry?.drones?.['drone-pre-create']);
      });
      expect(harness.createRuntimeCalls).toHaveLength(1);
      await harness.controller.stopProvisioning();
    });
  });

  test('drains critical creation instead of interrupting it during shutdown', async () => {
    await withTempDroneDataDir('drone-provisioning-', async () => {
      await updateRegistry((reg: any) => {
        reg.pending = {
          'drone-shutdown': {
            id: 'drone-shutdown',
            name: 'shutdown-safe',
            runtime: 'host',
            repoPath: '',
            build: false,
            createdAt: '2026-03-26T11:00:00.000Z',
            updatedAt: '2026-03-26T11:00:00.000Z',
            phase: 'starting',
            message: 'Starting...',
          },
        };
      });

      let markCreateStarted!: () => void;
      let releaseCreate!: () => void;
      const createStarted = new Promise<void>((resolve) => {
        markCreateStarted = resolve;
      });
      const createRelease = new Promise<void>((resolve) => {
        releaseCreate = resolve;
      });
      const harness = createControllerHarness({
        duringCreateRuntime: async () => {
          markCreateStarted();
          await createRelease;
        },
      });
      harness.controller.enqueueProvisioning('drone-shutdown');
      await createStarted;

      let stopped = false;
      const stopping = harness.controller.stopProvisioning().then(() => {
        stopped = true;
      });
      await sleep(20);
      expect(stopped).toBe(false);

      releaseCreate();
      await stopping;
      const registry: any = await loadRegistry();
      expect(registry?.pending?.['drone-shutdown']).toBeUndefined();
      expect(registry?.drones?.['drone-shutdown']).toBeDefined();
    });
  });

  test('promotes a pending drone and reapplies the latest pending display name', async () => {
    await withTempDroneDataDir('drone-provisioning-', async () => {
      await updateRegistry((reg: any) => {
        reg.pending = {
          'drone-1': {
            id: 'drone-1',
            name: 'auth-bugfix',
            runtime: 'host',
            repoPath: '',
            build: false,
            agentsMdOverride: '# Per-drone instructions\n',
            createdAt: '2026-03-26T11:00:00.000Z',
            updatedAt: '2026-03-26T11:00:00.000Z',
            phase: 'starting',
            message: 'Starting...',
          },
        };
      });

      const harness = createControllerHarness();
      harness.controller.enqueueProvisioning('drone-1');

      await waitFor(async () => {
        const reg: any = await loadRegistry();
        return (
          !reg?.pending?.['drone-1'] &&
          String(reg?.drones?.['drone-1']?.name ?? '') === 'auth-bugfix' &&
          harness.syncSharedPathsCalls.length > 0
        );
      });
      await waitFor(async () =>
        harness.hubLogCalls.some((call) => call[1] === 'drone provisioning timing'),
      );

      const reg: any = await loadRegistry();
      expect(reg?.pending?.['drone-1']).toBeUndefined();
      expect(reg?.drones?.['drone-1']).toMatchObject({
        id: 'drone-1',
        name: 'auth-bugfix',
        agentsMdOverride: '# Per-drone instructions\n',
      });
      expect(harness.syncSkillLibraryCalls).toHaveLength(1);
      expect(harness.syncMcpServersCalls).toHaveLength(1);
      expect(harness.syncSharedPathsCalls).toHaveLength(1);
      expect(harness.syncRepoAgentsCalls).toHaveLength(1);
      expect(harness.syncSharedPathsCalls).toHaveLength(1);
      const timingLog = harness.hubLogCalls.find((call) => call[1] === 'drone provisioning timing');
      expect(timingLog?.[2]).toMatchObject({
        droneId: 'drone-1',
        runtime: 'host',
        outcome: 'completed',
        durationMs: expect.any(Number),
        repoSeeded: false,
        phases: {
          loadPendingState: expect.any(Number),
          markCreating: expect.any(Number),
          createRuntime: expect.any(Number),
          loadPromotionState: expect.any(Number),
          promoteDrone: expect.any(Number),
          seedChatMetadataAfterPromotion: expect.any(Number),
          transitionPendingState: expect.any(Number),
          prepareStartupPrompts: expect.any(Number),
          syncSharedPaths: expect.any(Number),
          syncManagedFiles: expect.any(Number),
          clearProvisioningMetadata: expect.any(Number),
          schedulePromptPumps: expect.any(Number),
        },
      });
    });
  });

  test('keeps the provisioning marker through post-create synchronization', async () => {
    await withTempDroneDataDir('drone-provisioning-', async () => {
      await updateRegistry((reg: any) => {
        reg.pending = {
          'drone-sync-gate': {
            id: 'drone-sync-gate',
            name: 'sync-gate',
            runtime: 'host',
            repoPath: '',
            build: false,
            createdAt: '2026-03-26T11:00:00.000Z',
            updatedAt: '2026-03-26T11:00:00.000Z',
            phase: 'starting',
            message: 'Starting...',
            seed: {
              chatName: 'default',
              promptId: 'sync-gate-initial',
              submittedAt: '2026-03-26T11:01:00.000Z',
              prompt: 'Begin after synchronization',
              agent: { kind: 'builtin', id: 'codex' },
            },
          },
        };
      });

      const observed: Array<{ stage: string; phase: string }> = [];
      const harness = createControllerHarness({
        duringPostCreateSync: async ({ droneId, stage }) => {
          const registry: any = await loadRegistry();
          observed.push({
            stage,
            phase: String(registry?.drones?.[droneId]?.hub?.phase ?? ''),
          });
        },
      });
      harness.controller.enqueueProvisioning('drone-sync-gate');

      await waitFor(async () => harness.pendingPromptPumpCalls.length > 0);

      expect(observed).toEqual([
        { stage: 'shared-paths', phase: 'seeding' },
        { stage: 'skills', phase: 'seeding' },
        { stage: 'mcp', phase: 'seeding' },
        { stage: 'repo-agents', phase: 'seeding' },
      ]);
      const registry: any = await loadRegistry();
      expect(registry?.drones?.['drone-sync-gate']?.hub ?? null).toBeNull();
      expect(harness.events.indexOf('pump:drone-sync-gate:default')).toBeGreaterThan(
        harness.events.indexOf('sync:repo-agents'),
      );
    });
  });

  test('preserves a pending auto-rename that lands while runtime creation is running', async () => {
    await withTempDroneDataDir('drone-provisioning-', async () => {
      await updateRegistry((reg: any) => {
        reg.pending = {
          'drone-race': {
            id: 'drone-race',
            name: 'Untitled 6',
            runtime: 'host',
            repoPath: '',
            build: false,
            createdAt: '2026-03-26T11:00:00.000Z',
            updatedAt: '2026-03-26T11:00:00.000Z',
            phase: 'starting',
            message: 'Starting...',
          },
        };
      });

      const harness = createControllerHarness({
        duringCreateRuntime: async ({ droneId }) => {
          await updateRegistry((reg: any) => {
            reg.pending[droneId].name = 'file-transfer-tool';
          });
        },
      });
      harness.controller.enqueueProvisioning('drone-race');

      await waitFor(async () => {
        const reg: any = await loadRegistry();
        return !reg?.pending?.['drone-race'] && Boolean(reg?.drones?.['drone-race']);
      });
      await waitFor(async () =>
        harness.hubLogCalls.some((call) => call[1] === 'drone provisioning timing'),
      );

      const reg: any = await loadRegistry();
      expect(reg?.drones?.['drone-race']?.name).toBe('file-transfer-tool');
    });
  });

  test('enqueues all non-error pending drones and transfers startup prompts plus seed config', async () => {
    await withTempDroneDataDir('drone-provisioning-', async () => {
      await updateRegistry((reg: any) => {
        reg.pending = {
          'drone-2': {
            id: 'drone-2',
            name: 'seeded-drone',
            runtime: 'host',
            repoPath: '',
            build: false,
            createdAt: '2026-03-26T11:00:00.000Z',
            updatedAt: '2026-03-26T11:00:00.000Z',
            phase: 'starting',
            message: 'Starting...',
            seed: {
              chatName: 'ops',
              agent: { kind: 'builtin', id: 'codex' },
              model: 'gpt-5.4',
              reasoning: 'high',
            },
            startupQueuedPrompts: [
              {
                id: 'startup-1',
                chatName: 'ops',
                at: '2026-03-26T11:01:00.000Z',
                prompt: 'boot sequence',
                state: 'queued',
              },
            ],
          },
          'drone-err': {
            id: 'drone-err',
            name: 'failed-drone',
            runtime: 'host',
            repoPath: '',
            build: false,
            createdAt: '2026-03-26T11:00:00.000Z',
            updatedAt: '2026-03-26T11:00:00.000Z',
            phase: 'error',
            message: 'Failed to start',
          },
        };
      });

      const harness = createControllerHarness();
      const regBefore: any = await loadRegistry();
      harness.controller.enqueueProvisioningForAllPending(regBefore);

      await waitFor(async () => {
        const reg: any = await loadRegistry();
        return (
          !reg?.pending?.['drone-2'] &&
          Boolean(reg?.drones?.['drone-2']) &&
          harness.enqueuePromptCalls.length === 1 &&
          harness.pendingPromptPumpCalls.length > 0
        );
      });

      const reg: any = await loadRegistry();
      expect(reg?.pending?.['drone-err']).toBeDefined();
      expect(reg?.drones?.['drone-err']).toBeUndefined();
      expect(harness.ensureChatEntryCalls).toEqual([{ droneId: 'drone-2', chatName: 'ops' }]);
      expect(harness.setChatAgentConfigCalls).toEqual([
        {
          droneId: 'drone-2',
          chatName: 'ops',
          agent: { kind: 'builtin', id: 'codex' },
          setModel: true,
          model: 'gpt-5.4',
          setReasoning: true,
          reasoning: 'high',
        },
      ]);
      expect(harness.enqueuePromptCalls).toEqual([
        expect.objectContaining({
          id: 'startup-1',
          droneId: 'drone-2',
          chatName: 'ops',
          prompt: 'boot sequence',
          submittedAt: '2026-03-26T11:01:00.000Z',
          deliveryMode: 'background',
          priority: 'queue',
        }),
      ]);
      expect(harness.pendingPromptPumpCalls).toEqual([{ droneId: 'drone-2', chatName: 'ops' }]);
      expect(harness.events.indexOf('sync:repo-agents')).toBeGreaterThan(-1);
      expect(harness.events.indexOf('pump:drone-2:ops')).toBeGreaterThan(
        harness.events.indexOf('sync:repo-agents'),
      );
    });
  });

  test('materializes seed prompts into the startup queue before pumping', async () => {
    await withTempDroneDataDir('drone-provisioning-', async () => {
      await updateRegistry((reg: any) => {
        reg.pending = {
          'drone-seed-order': {
            id: 'drone-seed-order',
            name: 'seed-order',
            runtime: 'host',
            repoPath: '',
            build: false,
            createdAt: '2026-03-26T11:00:00.000Z',
            updatedAt: '2026-03-26T11:00:00.000Z',
            phase: 'starting',
            message: 'Starting...',
            seed: {
              chatName: 'default',
              agent: { kind: 'builtin', id: 'codex' },
              submittedAt: '2026-03-26T11:03:00.000Z',
              prompt: 'seed prompt',
            },
            startupQueuedPrompts: [
              {
                id: 'startup-earlier',
                chatName: 'default',
                at: '2026-03-26T11:02:00.000Z',
                prompt: 'queued while starting',
                state: 'queued',
              },
              {
                id: 'startup-later',
                chatName: 'default',
                at: '2026-03-26T11:04:00.000Z',
                prompt: 'queued after seed',
                state: 'queued',
              },
            ],
          },
        };
      });

      const harness = createControllerHarness();
      harness.controller.enqueueProvisioning('drone-seed-order');

      await waitFor(async () => {
        const reg: any = await loadRegistry();
        return (
          !reg?.pending?.['drone-seed-order'] &&
          Boolean(reg?.drones?.['drone-seed-order']) &&
          harness.enqueuePromptCalls.length === 3 &&
          harness.pendingPromptPumpCalls.length > 0
        );
      });

      expect(harness.enqueuePromptCalls).toEqual([
        expect.objectContaining({
          id: 'startup-earlier',
          prompt: 'queued while starting',
          submittedAt: '2026-03-26T11:02:00.000Z',
        }),
        expect.objectContaining({
          id: expect.any(String),
          prompt: 'seed prompt',
          submittedAt: '2026-03-26T11:03:00.000Z',
        }),
        expect.objectContaining({
          id: 'startup-later',
          prompt: 'queued after seed',
          submittedAt: '2026-03-26T11:04:00.000Z',
        }),
      ]);
      expect(harness.pendingPromptPumpCalls).toEqual([
        { droneId: 'drone-seed-order', chatName: 'default' },
      ]);
      expect(harness.events.indexOf('pump:drone-seed-order:default')).toBeGreaterThan(
        harness.events.indexOf('sync:repo-agents'),
      );
    });
  });

  test('adopts a prompt reserved by the create request without enqueueing it again', async () => {
    await withTempDroneDataDir('drone-provisioning-', async () => {
      await updateRegistry((reg: any) => {
        reg.pending = {
          'drone-reserved': {
            id: 'drone-reserved',
            name: 'reserved-seed',
            runtime: 'host',
            repoPath: '',
            build: false,
            createdAt: '2026-03-26T11:00:00.000Z',
            updatedAt: '2026-03-26T11:00:00.000Z',
            phase: 'starting',
            message: 'Starting...',
            seed: {
              chatName: 'default',
              promptId: 'reserved-1',
              submittedAt: '2026-03-26T11:01:00.000Z',
              prompt: 'reserved prompt',
            },
          },
        };
      });

      const harness = createControllerHarness({ reservedPromptIds: ['reserved-1'] });
      harness.controller.enqueueProvisioning('drone-reserved');

      await waitFor(async () => harness.pendingPromptPumpCalls.length > 0);

      expect(harness.enqueuePromptCalls).toHaveLength(0);
      expect(harness.ensureChatEntryCalls).toEqual([
        { droneId: 'drone-reserved', chatName: 'default' },
      ]);
      expect(harness.pendingPromptPumpCalls).toEqual([
        { droneId: 'drone-reserved', chatName: 'default' },
      ]);
      expect(harness.provisionedPromptHandoffs).toHaveLength(1);
      const timingLog = harness.hubLogCalls.find((call) => call[1] === 'drone provisioning timing');
      expect(timingLog?.[2]?.adoptedReservedPromptCount).toBe(1);
    });
  });

  test('stages attached startup prompts once with their original timestamp', async () => {
    await withTempDroneDataDir('drone-provisioning-', async () => {
      const attachment = {
        name: 'screen.png',
        mime: 'image/png',
        size: 3,
        dataBase64: 'YWJj',
        fileName: 'screen.png',
      };
      await updateRegistry((reg: any) => {
        reg.pending = {
          'drone-attached-seed': {
            id: 'drone-attached-seed',
            name: 'attached-seed',
            runtime: 'host',
            repoPath: '',
            build: false,
            createdAt: '2026-03-26T11:00:00.000Z',
            updatedAt: '2026-03-26T11:00:00.000Z',
            phase: 'starting',
            message: 'Starting...',
            startupQueuedPrompts: [
              {
                id: 'attached-prompt',
                chatName: 'default',
                at: '2026-03-26T11:01:00.000Z',
                prompt: 'Review this image',
                attachments: [attachment],
                deliveryMode: 'asap',
                state: 'queued',
              },
            ],
          },
        };
      });

      const harness = createControllerHarness();
      harness.controller.enqueueProvisioning('drone-attached-seed');

      await waitFor(async () => harness.pendingPromptPumpCalls.length > 0);

      expect(harness.enqueuePromptCalls).toEqual([
        expect.objectContaining({
          id: 'attached-prompt',
          droneId: 'drone-attached-seed',
          chatName: 'default',
          prompt: 'Review this image',
          attachments: [attachment],
          submittedAt: '2026-03-26T11:01:00.000Z',
          deliveryMode: 'background',
          priority: 'asap',
        }),
      ]);
      expect(harness.pendingPromptPumpCalls).toEqual([
        { droneId: 'drone-attached-seed', chatName: 'default' },
      ]);
    });
  });

  test('keeps the drone usable when attached seed staging fails', async () => {
    await withTempDroneDataDir('drone-provisioning-', async () => {
      await updateRegistry((reg: any) => {
        reg.pending = {
          'drone-failed-attachment': {
            id: 'drone-failed-attachment',
            name: 'failed-attachment',
            runtime: 'host',
            repoPath: '',
            build: false,
            createdAt: '2026-03-26T11:00:00.000Z',
            updatedAt: '2026-03-26T11:00:00.000Z',
            phase: 'starting',
            message: 'Starting...',
            startupQueuedPrompts: [
              {
                id: 'failed-attachment-prompt',
                chatName: 'default',
                at: '2026-03-26T11:01:00.000Z',
                prompt: 'Review this image',
                attachments: [
                  {
                    name: 'screen.png',
                    mime: 'image/png',
                    size: 3,
                    dataBase64: 'YWJj',
                    fileName: 'screen.png',
                  },
                ],
                state: 'queued',
              },
            ],
          },
        };
      });

      const harness = createControllerHarness({ failAttachedPromptStaging: true });
      harness.controller.enqueueProvisioning('drone-failed-attachment');

      await waitFor(async () => {
        const registry: any = await loadRegistry();
        return (
          Boolean(registry?.drones?.['drone-failed-attachment']) &&
          harness.pendingPromptPumpCalls.length > 0
        );
      });

      const registry: any = await loadRegistry();
      expect(registry?.drones?.['drone-failed-attachment']).toBeDefined();
      expect(harness.hubLogCalls).toContainEqual([
        'warn',
        'initial prompt attachments could not be staged',
        expect.objectContaining({ promptId: 'failed-attachment-prompt' }),
      ]);
    });
  });

  test('materializes seed chat config before post-create sync without startup prompts', async () => {
    await withTempDroneDataDir('drone-provisioning-', async () => {
      await updateRegistry((reg: any) => {
        reg.pending = {
          'drone-image-first': {
            id: 'drone-image-first',
            name: 'image-first',
            runtime: 'host',
            repoPath: '',
            build: false,
            createdAt: '2026-03-26T11:00:00.000Z',
            updatedAt: '2026-03-26T11:00:00.000Z',
            phase: 'starting',
            message: 'Starting...',
            seed: {
              chatName: 'default',
              agent: { kind: 'builtin', id: 'codex' },
              model: 'gpt-5.4',
            },
          },
        };
      });

      const harness = createControllerHarness();
      harness.controller.enqueueProvisioning('drone-image-first');

      await waitFor(async () => {
        const reg: any = await loadRegistry();
        return (
          !reg?.pending?.['drone-image-first'] &&
          Boolean(reg?.drones?.['drone-image-first']) &&
          harness.setChatAgentConfigCalls.length > 0
        );
      });
      await waitFor(async () =>
        harness.hubLogCalls.some((call) => call[1] === 'drone provisioning timing'),
      );

      const reg: any = await loadRegistry();
      expect(reg?.drones?.['drone-image-first']?.chats?.default).toMatchObject({
        agent: { kind: 'builtin', id: 'codex' },
        model: 'gpt-5.4',
      });
      expect(harness.ensureChatEntryCalls).toEqual([
        { droneId: 'drone-image-first', chatName: 'default' },
      ]);
      expect(harness.setChatAgentConfigCalls).toEqual([
        {
          droneId: 'drone-image-first',
          chatName: 'default',
          agent: { kind: 'builtin', id: 'codex' },
          setModel: true,
          model: 'gpt-5.4',
        },
      ]);
      expect(harness.enqueuePromptCalls).toHaveLength(0);
    });
  });

  test('passes no-persist-volume when provisioning a no-volume container drone', async () => {
    await withTempDroneDataDir('drone-provisioning-', async () => {
      await updateRegistry((reg: any) => {
        reg.pending = {
          'drone-no-volume': {
            id: 'drone-no-volume',
            name: 'no-volume',
            runtime: 'container',
            repoPath: '',
            build: false,
            persistVolume: false,
            containerPort: 7777,
            createdAt: '2026-03-26T11:00:00.000Z',
            updatedAt: '2026-03-26T11:00:00.000Z',
            phase: 'starting',
            message: 'Starting...',
          },
        };
      });

      const harness = createControllerHarness();
      harness.controller.enqueueProvisioning('drone-no-volume');

      await waitFor(async () => {
        const reg: any = await loadRegistry();
        return !reg?.pending?.['drone-no-volume'] && Boolean(reg?.drones?.['drone-no-volume']);
      });
      await waitFor(async () =>
        harness.hubLogCalls.some((call) => call[1] === 'drone provisioning timing'),
      );

      expect(harness.createRuntimeCalls).toHaveLength(1);
      expect(harness.createRuntimeCalls[0]).toMatchObject({ persistVolume: false });
    });
  });

  test('imports an existing container in-process and records its inner timing', async () => {
    await withTempDroneDataDir('drone-provisioning-', async () => {
      await updateRegistry((reg: any) => {
        reg.pending = {
          'drone-existing': {
            id: 'drone-existing',
            name: 'existing-runtime',
            runtime: 'container',
            repoPath: '',
            containerPort: 7777,
            createdAt: '2026-03-26T11:00:00.000Z',
            updatedAt: '2026-03-26T11:00:00.000Z',
            phase: 'starting',
            message: 'Starting...',
          },
        };
      });

      const harness = createControllerHarness({ createRuntimeError: 'container already exists' });
      harness.controller.enqueueProvisioning('drone-existing');

      await waitFor(async () => {
        const reg: any = await loadRegistry();
        return !reg?.pending?.['drone-existing'] && Boolean(reg?.drones?.['drone-existing']);
      });

      expect(harness.importRuntimeCalls).toHaveLength(1);
      expect(harness.importRuntimeCalls[0]).toMatchObject({
        droneId: 'drone-existing',
        cwd: '/dvm-data/home',
        mkdir: true,
      });
      await waitFor(async () =>
        harness.hubLogCalls.some((call) => call[1] === 'drone provisioning timing'),
      );
      const timingLog = harness.hubLogCalls.find((call) => call[1] === 'drone provisioning timing');
      expect(timingLog?.[2]?.phases).toMatchObject({
        importRuntime: expect.any(Number),
        'importRuntime.resolveHostPort': 12.3,
      });
    });
  });

  test('cancels queued prompts when the runtime fails to start', async () => {
    await withTempDroneDataDir('drone-provisioning-', async () => {
      await updateRegistry((reg: any) => {
        reg.pending = {
          'drone-failed': {
            id: 'drone-failed',
            name: 'failed-runtime',
            runtime: 'host',
            repoPath: '',
            build: false,
            createdAt: '2026-03-26T11:00:00.000Z',
            updatedAt: '2026-03-26T11:00:00.000Z',
            phase: 'starting',
            message: 'Starting...',
            startupQueuedPrompts: [
              {
                id: 'queued-review',
                chatName: 'default',
                at: '2026-03-26T11:01:00.000Z',
                prompt: 'Review the changes',
                state: 'queued',
              },
            ],
          },
        };
      });

      const harness = createControllerHarness({
        createRuntimeError: 'runtime import failed',
      });
      harness.controller.enqueueProvisioning('drone-failed');

      await waitFor(async () => {
        const reg: any = await loadRegistry();
        return reg?.pending?.['drone-failed']?.phase === 'error';
      });

      const reg: any = await loadRegistry();
      expect(reg?.pending?.['drone-failed']).toMatchObject({
        phase: 'error',
        message: 'Failed to start',
        error: 'runtime import failed',
        startupQueuedPrompts: [
          { id: 'queued-review', state: 'failed', error: 'runtime import failed' },
        ],
      });
      expect(harness.cancelPendingPromptsCalls).toEqual([
        { droneId: 'drone-failed', error: 'Drone failed to start: runtime import failed' },
      ]);
    });
  });
});
