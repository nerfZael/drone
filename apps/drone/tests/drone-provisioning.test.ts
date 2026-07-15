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

function createControllerHarness(opts?: { agentSuggestionEnabledByDefault?: boolean }) {
  const pendingStateHelpers = createPendingDroneStateHelpers({
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
  const syncTaskStateCalls: any[] = [];
  const runNodeCliCalls: string[][] = [];
  const pendingPromptPumpCalls: any[] = [];
  const events: string[] = [];

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
    enqueuePendingPromptPump: (droneId, chatName) => {
      pendingPromptPumpCalls.push({ droneId, chatName });
      events.push(`pump:${droneId}:${chatName}`);
    },
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
    resolveAgentSuggestionEnabledByDefault: async () => opts?.agentSuggestionEnabledByDefault === true,
    resolveDroneCliPath: () => '/mock/drone-cli.js',
    resolvePendingDroneDisplayName: pendingStateHelpers.resolvePendingDroneDisplayName,
    runNodeCli: async (args) => {
      runNodeCliCalls.push([...args]);
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
      events.push('sync:repo-agents');
    },
    syncSkillLibraryForDrone: async (opts) => {
      syncSkillLibraryCalls.push(opts);
      events.push('sync:skills');
    },
    syncMcpServersForDrone: async (opts) => {
      syncMcpServersCalls.push(opts);
      events.push('sync:mcp');
    },
    syncSharedPathsToDrone: async (opts) => {
      syncSharedPathsCalls.push(opts);
      events.push('sync:shared-paths');
    },
    syncTaskStateSnapshotToDrone: async (droneId, droneEntry) => {
      syncTaskStateCalls.push({ droneId, droneEntry });
      events.push('sync:task-state');
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
    syncTaskStateCalls,
    runNodeCliCalls,
    pendingPromptPumpCalls,
    events,
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
      expect(harness.syncMcpServersCalls).toHaveLength(1);
      expect(harness.syncSharedPathsCalls).toHaveLength(1);
      expect(harness.syncRepoAgentsCalls).toHaveLength(1);
      expect(harness.syncSharedPathsCalls).toHaveLength(1);
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
          Boolean(reg?.drones?.['drone-2']?.chats?.ops) &&
          harness.pendingPromptPumpCalls.length > 0
        );
      });

      const reg: any = await loadRegistry();
      expect(reg?.pending?.['drone-err']).toBeDefined();
      expect(reg?.drones?.['drone-err']).toBeUndefined();
      expect(reg?.drones?.['drone-2']?.chats?.ops).toMatchObject({
        agent: { kind: 'builtin', id: 'codex' },
        model: 'gpt-5.4',
        reasoning: 'high',
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
          setReasoning: true,
          reasoning: 'high',
          setAgentSuggestionEnabled: true,
          agentSuggestionEnabled: false,
        },
      ]);
      expect(harness.enqueuePromptCalls).toHaveLength(0);
      expect(harness.pendingPromptPumpCalls).toEqual([{ droneId: 'drone-2', chatName: 'ops' }]);
      expect(harness.events.indexOf('sync:repo-agents')).toBeGreaterThan(-1);
      expect(harness.events.indexOf('pump:drone-2:ops')).toBeGreaterThan(harness.events.indexOf('sync:repo-agents'));
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
          Array.isArray(reg?.drones?.['drone-seed-order']?.chats?.default?.pendingPrompts) &&
          reg.drones['drone-seed-order'].chats.default.pendingPrompts.length === 3 &&
          harness.pendingPromptPumpCalls.length > 0
        );
      });

      const reg: any = await loadRegistry();
      expect(reg?.drones?.['drone-seed-order']?.chats?.default?.pendingPrompts).toEqual([
        {
          id: 'startup-earlier',
          at: '2026-03-26T11:02:00.000Z',
          prompt: 'queued while starting',
          state: 'queued',
          updatedAt: '2026-03-26T12:00:00.000Z',
        },
        {
          id: expect.any(String),
          at: '2026-03-26T11:03:00.000Z',
          prompt: 'seed prompt',
          state: 'queued',
          updatedAt: '2026-03-26T11:03:00.000Z',
        },
        {
          id: 'startup-later',
          at: '2026-03-26T11:04:00.000Z',
          prompt: 'queued after seed',
          state: 'queued',
          updatedAt: '2026-03-26T12:00:00.000Z',
        },
      ]);
      expect(harness.enqueuePromptCalls).toHaveLength(0);
      expect(harness.pendingPromptPumpCalls).toEqual([{ droneId: 'drone-seed-order', chatName: 'default' }]);
      expect(harness.events.indexOf('pump:drone-seed-order:default')).toBeGreaterThan(harness.events.indexOf('sync:repo-agents'));
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
        return !reg?.pending?.['drone-image-first'] && Boolean(reg?.drones?.['drone-image-first']) && harness.syncTaskStateCalls.length > 0;
      });

      const reg: any = await loadRegistry();
      expect(reg?.drones?.['drone-image-first']?.chats?.default).toMatchObject({
        agent: { kind: 'builtin', id: 'codex' },
        model: 'gpt-5.4',
      });
      expect(harness.syncTaskStateCalls).toHaveLength(1);
      expect(harness.syncTaskStateCalls[0]?.droneEntry?.chats?.default).toMatchObject({
        agent: { kind: 'builtin', id: 'codex' },
        model: 'gpt-5.4',
      });
      expect(harness.ensureChatEntryCalls).toEqual([{ droneId: 'drone-image-first', chatName: 'default' }]);
      expect(harness.setChatAgentConfigCalls).toEqual([
        {
          droneId: 'drone-image-first',
          chatName: 'default',
          agent: { kind: 'builtin', id: 'codex' },
          setModel: true,
          model: 'gpt-5.4',
          setAgentSuggestionEnabled: true,
          agentSuggestionEnabled: false,
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

      expect(harness.runNodeCliCalls).toHaveLength(1);
      expect(harness.runNodeCliCalls[0]).toContain('--no-persist-volume');
    });
  });

  test('uses the assistant suggestion default for cloned chat toggles', async () => {
    await withTempDroneDataDir('drone-provisioning-', async () => {
      await updateRegistry((reg: any) => {
        reg.drones = {
          source: {
            id: 'source',
            name: 'source',
            runtime: 'host',
            createdAt: '2026-03-26T10:00:00.000Z',
            chats: {
              default: {
                createdAt: '2026-03-26T10:05:00.000Z',
                agent: { kind: 'builtin', id: 'codex' },
                agentSuggestionEnabled: true,
                agentSuggestionEnabledAt: '2026-03-26T10:05:00.000Z',
              },
            },
          },
        };
        reg.pending = {
          clone: {
            id: 'clone',
            name: 'clone',
            runtime: 'host',
            repoPath: '',
            build: false,
            cloneFrom: 'source',
            cloneChats: true,
            createdAt: '2026-03-26T11:00:00.000Z',
            updatedAt: '2026-03-26T11:00:00.000Z',
            phase: 'starting',
            message: 'Starting...',
          },
        };
      });

      const harness = createControllerHarness({ agentSuggestionEnabledByDefault: false });
      harness.controller.enqueueProvisioning('clone');

      await waitFor(async () => {
        const reg: any = await loadRegistry();
        return !reg?.pending?.clone && Boolean(reg?.drones?.clone?.chats?.default);
      });

      const reg: any = await loadRegistry();
      const clonedDefault = reg?.drones?.clone?.chats?.default;
      expect(clonedDefault?.agent).toEqual({ kind: 'builtin', id: 'codex' });
      expect(clonedDefault?.agentSuggestionEnabled).toBeUndefined();
      expect(clonedDefault?.agentSuggestionEnabledAt).toBeUndefined();
    });
  });
});
