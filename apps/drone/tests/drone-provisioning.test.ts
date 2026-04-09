import { describe, expect, test } from 'bun:test';

import { loadRegistry, updateRegistry } from '../src/host/registry';
import { createPendingDroneStateHelpers } from '../src/hub/drone-pending-state';
import { createDroneProvisioningController } from '../src/hub/drone-provisioning';
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

function createControllerHarness() {
  const pendingStateHelpers = createPendingDroneStateHelpers({
    normalizeChatName: (raw: any) => String(raw ?? 'default').trim() || 'default',
    nowIso: () => '2026-03-26T12:00:00.000Z',
  });

  const ensureChatEntryCalls: any[] = [];
  const enqueuePromptCalls: any[] = [];
  const setChatAgentConfigCalls: any[] = [];
  const syncRepoAgentsCalls: any[] = [];
  const syncSkillLibraryCalls: any[] = [];
  const syncTaskStateCalls: any[] = [];

  const controller = createDroneProvisioningController({
    NON_REPO_HOME_CWD: '/dvm-data/home',
    applyPendingDisplayNameToProvisionedDrone: pendingStateHelpers.applyPendingDisplayNameToProvisionedDrone,
    cloneChatEntryForDroneClone: (entryRaw: any) => JSON.parse(JSON.stringify(entryRaw ?? {})),
    defaultDaemonReadyTimeoutMs: () => 30_000,
    defaultRepoSeedTimeoutMs: () => 30_000,
    ensureChatEntry: async (opts) => {
      ensureChatEntryCalls.push(opts);
    },
    enqueuePrompt: async (opts) => {
      enqueuePromptCalls.push(opts);
      return { id: String(opts.id ?? 'generated'), pendingState: 'queued', blockedByAutomation: false };
    },
    enqueuePendingPromptPump: () => {},
    hubLog: () => {},
    inferChatAgent: (entry: any) => entry?.agent ?? { kind: 'builtin', id: 'cursor' },
    isSafePromptId: (raw: string) => /^[A-Za-z0-9._-]+$/.test(String(raw ?? '').trim()),
    normalizeChatModel: (raw: any) => {
      const value = String(raw ?? '').trim();
      return value || null;
    },
    normalizeChatName: (raw: any) => String(raw ?? 'default').trim() || 'default',
    normalizeDroneEntryKind: () => 'standard',
    normalizeDroneEntryVisibility: () => 'visible',
    normalizePendingStartupPrompts: pendingStateHelpers.normalizePendingStartupPrompts,
    nowIso: () => '2026-03-26T12:00:00.000Z',
    parseSeedAgent: (raw: any) => (raw && typeof raw === 'object' ? raw : null),
    playbookMetaFromEntry: () => null,
    resolveDroneCliPath: () => '/mock/drone-cli.js',
    resolvePendingDroneDisplayName: pendingStateHelpers.resolvePendingDroneDisplayName,
    runNodeCli: async (args) => {
      const displayName = String(args[2] ?? '').trim();
      const droneIdIndex = args.indexOf('--drone-id');
      const droneId = droneIdIndex >= 0 ? String(args[droneIdIndex + 1] ?? '').trim() : '';
      await updateRegistry((reg: any) => {
        reg.drones = reg.drones ?? {};
        reg.drones[droneId] = {
          id: droneId,
          name: 'Untitled 25',
          runtime: 'host',
          containerName: displayName,
          createdAt: '2026-03-26T11:00:00.000Z',
          chats: {},
        };
      });
      return { code: 0, stdout: '', stderr: '' };
    },
    setChatAgentConfig: async (opts) => {
      setChatAgentConfigCalls.push(opts);
    },
    startupPromptToPendingPrompt: pendingStateHelpers.startupPromptToPendingPrompt,
    syncRepoAgentsInstructionsForDrone: async (opts) => {
      syncRepoAgentsCalls.push(opts);
    },
    syncSkillLibraryForDrone: async (opts) => {
      syncSkillLibraryCalls.push(opts);
    },
    syncTaskStateSnapshotToDrone: async (droneId, droneEntry) => {
      syncTaskStateCalls.push({ droneId, droneEntry });
    },
  });

  return {
    controller,
    ensureChatEntryCalls,
    enqueuePromptCalls,
    setChatAgentConfigCalls,
    syncRepoAgentsCalls,
    syncSkillLibraryCalls,
    syncTaskStateCalls,
  };
}

describe('drone provisioning controller', () => {
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
        return !reg?.pending?.['drone-1'] && String(reg?.drones?.['drone-1']?.name ?? '') === 'auth-bugfix';
      });

      const reg: any = await loadRegistry();
      expect(reg?.pending?.['drone-1']).toBeUndefined();
      expect(reg?.drones?.['drone-1']).toMatchObject({
        id: 'drone-1',
        name: 'auth-bugfix',
      });
      expect(harness.syncTaskStateCalls).toHaveLength(1);
      expect(harness.syncSkillLibraryCalls).toHaveLength(1);
      expect(harness.syncRepoAgentsCalls).toHaveLength(1);
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
        return !reg?.pending?.['drone-2'] && Boolean(reg?.drones?.['drone-2']?.chats?.ops);
      });

      const reg: any = await loadRegistry();
      expect(reg?.pending?.['drone-err']).toBeDefined();
      expect(reg?.drones?.['drone-err']).toBeUndefined();
      expect(reg?.drones?.['drone-2']?.chats?.ops).toMatchObject({
        agent: { kind: 'builtin', id: 'codex' },
        model: 'gpt-5.4',
      });
      expect(reg?.drones?.['drone-2']?.chats?.ops?.pendingPrompts).toEqual([
        {
          id: 'startup-1',
          at: '2026-03-26T11:01:00.000Z',
          prompt: 'boot sequence',
          state: 'queued',
          updatedAt: '2026-03-26T12:00:00.000Z',
        },
      ]);
      expect(harness.ensureChatEntryCalls).toEqual([{ droneId: 'drone-2', chatName: 'ops' }]);
      expect(harness.setChatAgentConfigCalls).toEqual([
        {
          droneId: 'drone-2',
          chatName: 'ops',
          agent: { kind: 'builtin', id: 'codex' },
          setModel: true,
          model: 'gpt-5.4',
        },
      ]);
      expect(harness.enqueuePromptCalls).toHaveLength(0);
    });
  });
});
