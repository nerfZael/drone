import { createNativePromptSubmitter } from './native-prompt-submission';
import type http from 'node:http';
import type { BlipSessionState } from '@blip/core';

import { resolveCanonicalDroneOrPendingForReadRef } from './drone-lifecycle-service';
import { normalizeDroneRuntime } from '../host/runtime';
import { HubAssistantService, type AssistantDroneSummary } from './assistant';
import { resolveStableDroneOrPendingIdFromRef } from './drone-lifecycle-registry';
import { loadDroneSummaryRegistry } from './drone-summary-registry';
import { fleetActorConfig } from './fleet-helpers';
import { BlipAssistantHost } from './assistant/blip-assistant-host';
import { loadBlipMcp, loadBlipTools } from './assistant/blip-runtime-loader';
import {
  ASSISTANT_DRONE_HUB_MCP_TOOL_NAMES,
  ASSISTANT_READ_ONLY_DENIED_TOOL_NAMES,
} from './assistant/assistant-config';
import { createInProcessDroneHubMcpClient } from './assistant/in-process-drone-hub-mcp';
import type { McpTokenIdentity } from './mcp-tokens';
import type { HubServices } from './application/hub-services';
import { AssistantArtifactsTarget } from './assistant/targets/assistant-artifacts-target';
import { DroneWorkspaceTarget } from './assistant/targets/workspace-targets';
import {
  hubLog,
  resolveBlipProviderApiKey,
  resolveEffectiveProviderApiKeySettings,
  resolveExaApiKeySettings,
} from './hub-settings';
import { fetchContent, searchWeb } from './web-search';
import {
  captureAssistantArtifactRunFileChangesBaseline,
  captureDroneRunFileChangesBaseline,
  combineAgentRunFileChanges,
  discardAssistantArtifactRunFileChangesBaseline,
  finalizeAssistantArtifactRunFileChanges,
  finalizeDroneRunFileChangesWorkspace,
  isMutatingWorkspaceTool,
  type AgentRunFileChangesBaseline,
  type AssistantArtifactRunFileChangesBaseline,
} from './run-file-changes';

export interface AssistantRuntimeDependencies {
  assistantFilesystemService: any;
  busyChatNamesForDrone: (drone: any, droneId: string) => string[];
  deviceMesh: any;
  normalizeDroneIdentity: (value: unknown) => string;
  nowIso: () => string;
  onNativePromptQueueChanged?: (owner: { droneId: string; chatName: string }) => void;
  onNativeThreadStateChanged?: (owner: { droneId: string; chatName: string }) => void;
  hubServices: HubServices;
  summarizeDroneActivity: (entry: any) => {
    lastActivityAt: string | null;
    lastMessageAt: string | null;
    lastActivityChat: string | null;
  };
}

export function createAssistantRuntime(deps: AssistantRuntimeDependencies) {
  const {
    assistantFilesystemService,
    busyChatNamesForDrone,
    deviceMesh,
    normalizeDroneIdentity,
    nowIso,
    onNativePromptQueueChanged,
    onNativeThreadStateChanged,
    hubServices,
    summarizeDroneActivity,
  } = deps;
  const {
    assistantAbortDroneTransferFile,
    assistantBatchDroneFiles,
    assistantCommitDroneTransferFile,
    assistantCreateDroneDirectory,
    assistantCreateDroneTransferDirectory,
    assistantDeleteDroneDirectory,
    assistantDeleteDroneFile,
    assistantListDroneChangedFiles,
    assistantListDroneFiles,
    assistantMoveDroneFile,
    assistantMoveDronePath,
    assistantPrepareDroneTransferFile,
    assistantReadDroneFile,
    assistantReadDroneFileChunk,
    assistantRunDroneBash,
    assistantSearchDroneFiles,
    assistantStatDronePath,
    assistantWriteDroneFile,
    assistantWriteDroneTransferChunk,
  } = assistantFilesystemService;

  function buildAssistantDroneSummariesFromRegistry(regAny: any): AssistantDroneSummary[] {
    const out: AssistantDroneSummary[] = [];
    const drones = regAny?.drones && typeof regAny.drones === 'object' ? regAny.drones : {};
    for (const [idRaw, d] of Object.entries(drones) as any[]) {
      const id = normalizeDroneIdentity((d as any)?.id) || normalizeDroneIdentity(idRaw);
      if (!id) continue;
      const chatObj =
        (d as any)?.chats && typeof (d as any).chats === 'object' ? (d as any).chats : {};
      const chats = Object.keys(chatObj);
      if (chats.length === 0) chats.push('default');
      const activity = summarizeDroneActivity(d);
      const busyChats = busyChatNamesForDrone(d, id);
      const hubPhase = String((d as any)?.hub?.phase ?? '').trim();
      out.push({
        id,
        name: String((d as any)?.name ?? id).trim() || id,
        group: String((d as any)?.group ?? '').trim() || null,
        groupId: String((d as any)?.groupId ?? '').trim() || null,
        fleetParentId: resolveStableDroneOrPendingIdFromRef(regAny, fleetActorConfig(d).createdBy),
        createdAt: String((d as any)?.createdAt ?? '').trim() || null,
        runtime: normalizeDroneRuntime((d as any)?.runtime),
        repoPath: String((d as any)?.repoPath ?? '').trim(),
        status: hubPhase || (busyChats.length > 0 ? 'busy' : 'ready'),
        chats,
        ...(busyChats.length > 0 ? { busyChats, busy: true } : {}),
        ...(activity.lastActivityAt ? { lastActivityAt: activity.lastActivityAt } : {}),
        ...(activity.lastMessageAt ? { lastMessageAt: activity.lastMessageAt } : {}),
        ...(activity.lastActivityChat ? { lastActivityChat: activity.lastActivityChat } : {}),
      } as AssistantDroneSummary);
    }
    const pending = regAny?.pending && typeof regAny.pending === 'object' ? regAny.pending : {};
    for (const [idRaw, d] of Object.entries(pending) as any[]) {
      const id = normalizeDroneIdentity((d as any)?.id) || normalizeDroneIdentity(idRaw);
      if (!id || out.some((item) => item.id === id)) continue;
      const activity = summarizeDroneActivity(d);
      out.push({
        id,
        name: String((d as any)?.name ?? id).trim() || id,
        group: String((d as any)?.group ?? '').trim() || null,
        groupId: String((d as any)?.groupId ?? '').trim() || null,
        fleetParentId: resolveStableDroneOrPendingIdFromRef(regAny, fleetActorConfig(d).createdBy),
        createdAt: String((d as any)?.createdAt ?? '').trim() || null,
        runtime: normalizeDroneRuntime((d as any)?.runtime),
        repoPath: String((d as any)?.repoPath ?? '').trim(),
        status: String((d as any)?.phase ?? 'starting').trim() || 'starting',
        chats: ['default'],
        ...(activity.lastActivityAt ? { lastActivityAt: activity.lastActivityAt } : {}),
        ...(activity.lastMessageAt ? { lastMessageAt: activity.lastMessageAt } : {}),
        ...(activity.lastActivityChat ? { lastActivityChat: activity.lastActivityChat } : {}),
      } as AssistantDroneSummary);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  type WhiteboardChangeReason = 'created' | 'updated' | 'deleted';
  type WhiteboardChangeEvent = {
    type: 'whiteboard_changed';
    sequence: number;
    whiteboardId: string;
    version: number | null;
    reason: WhiteboardChangeReason;
    source: string;
    at: string;
  };

  const whiteboardChangeListeners = new Set<(event: WhiteboardChangeEvent) => void>();
  let whiteboardChangeSequence = 0;

  function emitWhiteboardChange(input: {
    whiteboardId: string;
    version?: number | null;
    reason: WhiteboardChangeReason;
    source?: unknown;
  }): WhiteboardChangeEvent {
    const event: WhiteboardChangeEvent = {
      type: 'whiteboard_changed',
      sequence: ++whiteboardChangeSequence,
      whiteboardId: input.whiteboardId,
      version: input.version ?? null,
      reason: input.reason,
      source: String(input.source ?? '').trim() || 'unknown',
      at: nowIso(),
    };
    for (const listener of whiteboardChangeListeners) {
      try {
        listener(event);
      } catch (error: any) {
        hubLog('warn', 'whiteboard change listener failed', {
          error: String(error?.message ?? error ?? ''),
        });
      }
    }
    return event;
  }

  function subscribeWhiteboardChanges(
    listener: (event: WhiteboardChangeEvent) => void,
  ): () => void {
    whiteboardChangeListeners.add(listener);
    return () => {
      whiteboardChangeListeners.delete(listener);
    };
  }

  const assistantService = new HubAssistantService({
    listDrones: async (): Promise<AssistantDroneSummary[]> => {
      const regAny: any = await loadDroneSummaryRegistry();
      return buildAssistantDroneSummariesFromRegistry(regAny);
    },
    listDroneFiles: async ({ droneId, path }) => await assistantListDroneFiles({ droneId, path }),
    readDroneFile: async ({ droneId, path, startLine, endLine }) =>
      await assistantReadDroneFile({ droneId, path, startLine, endLine }),
    writeDroneFile: async ({ droneId, path, content }) =>
      await assistantWriteDroneFile({ droneId, path, content }),
    batchDroneFiles: async ({ droneId, operations }) =>
      await assistantBatchDroneFiles({ droneId, operations }),
    deleteDroneFile: async ({ droneId, path }) => await assistantDeleteDroneFile({ droneId, path }),
    moveDroneFile: async ({ droneId, fromPath, toPath }) =>
      await assistantMoveDroneFile({ droneId, fromPath, toPath }),
    moveDronePath: async ({ droneId, fromPath, toPath, overwrite }) =>
      await assistantMoveDronePath({ droneId, fromPath, toPath, overwrite }),
    createDroneDirectory: async ({ droneId, path, recursive }) =>
      await assistantCreateDroneDirectory({ droneId, path, recursive }),
    deleteDroneDirectory: async ({ droneId, path, recursive }) =>
      await assistantDeleteDroneDirectory({ droneId, path, recursive }),
    searchDroneFiles: async ({ droneId, path, query, limit, contextBefore, contextAfter }) =>
      await assistantSearchDroneFiles({ droneId, path, query, limit, contextBefore, contextAfter }),
    statDronePath: async ({ droneId, path }) => await assistantStatDronePath({ droneId, path }),
    readDroneFileChunk: async (input) => await assistantReadDroneFileChunk(input),
    createDroneTransferDirectory: async (input) =>
      await assistantCreateDroneTransferDirectory(input),
    prepareDroneTransferFile: async (input) => await assistantPrepareDroneTransferFile(input),
    writeDroneTransferChunk: async (input) => await assistantWriteDroneTransferChunk(input),
    commitDroneTransferFile: async (input) => await assistantCommitDroneTransferFile(input),
    abortDroneTransferFile: async (input) => await assistantAbortDroneTransferFile(input),
    runDroneBash: async ({ droneId, command, cwd, timeoutMs }) =>
      await assistantRunDroneBash({ droneId, command, cwd, timeoutMs }),
    listDroneChangedFiles: async ({ droneId }) => await assistantListDroneChangedFiles({ droneId }),
  });
  const blipAssistantHost = new BlipAssistantHost(
    async (threadId) => {
      const snapshot = await assistantService.threadSnapshot(threadId);
      const thread = snapshot.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error(`unknown assistant thread: ${threadId}`);
      const [{ createMcpToolProvider }, blipTools] = await Promise.all([
        loadBlipMcp(),
        loadBlipTools(),
      ]);
      const workspaceDrones = await assistantService.workspaceDrones(threadId);
      const runFileChangesExtensionKey = 'droneHub.nativeRunFileChanges';
      let activeRunTurnId = '';
      let activeRunSession: BlipSessionState | null = null;
      const baselineByDroneId = new Map<
        string,
        Promise<{ baseline: AgentRunFileChangesBaseline; drone: any } | null>
      >();
      const capturedBaselineByDroneId = new Map<string, AgentRunFileChangesBaseline>();
      let artifactBaseline: Promise<AssistantArtifactRunFileChangesBaseline | null> | null = null;
      let capturedArtifactBaseline: AssistantArtifactRunFileChangesBaseline | null = null;

      type DurableRunFileChangesState = {
        version: 1;
        turnId: string;
        droneBaselines: AgentRunFileChangesBaseline[];
        artifactBaseline?: AssistantArtifactRunFileChangesBaseline;
      };

      const durableRunFileChangesState = (
        session: BlipSessionState,
      ): DurableRunFileChangesState | null => {
        const value = session.extensions?.[runFileChangesExtensionKey];
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const candidate = value as Partial<DurableRunFileChangesState>;
        if (candidate.version !== 1 || !String(candidate.turnId ?? '').trim()) return null;
        return {
          version: 1,
          turnId: String(candidate.turnId),
          droneBaselines: Array.isArray(candidate.droneBaselines)
            ? candidate.droneBaselines.filter((baseline) => baseline?.version === 1)
            : [],
          ...(candidate.artifactBaseline?.version === 1
            ? { artifactBaseline: candidate.artifactBaseline }
            : {}),
        };
      };

      const persistRunFileChangesState = () => {
        if (!activeRunSession || !activeRunTurnId) return;
        activeRunSession.extensions = {
          ...(activeRunSession.extensions ?? {}),
          [runFileChangesExtensionKey]: {
            version: 1,
            turnId: activeRunTurnId,
            droneBaselines: Array.from(capturedBaselineByDroneId.values()),
            ...(capturedArtifactBaseline ? { artifactBaseline: capturedArtifactBaseline } : {}),
          } satisfies DurableRunFileChangesState,
        };
      };

      const clearDurableRunFileChangesState = (session: BlipSessionState | null) => {
        if (!session?.extensions || !(runFileChangesExtensionKey in session.extensions)) return;
        const extensions = { ...session.extensions };
        delete extensions[runFileChangesExtensionKey];
        session.extensions = extensions;
      };

      const beginRunFileChanges = async (session: BlipSessionState, turnId: string) => {
        const staleState = durableRunFileChangesState(session);
        const staleArtifactBaseline =
          staleState?.artifactBaseline ??
          (artifactBaseline ? await artifactBaseline.catch(() => null) : null);
        artifactBaseline = null;
        if (staleArtifactBaseline) {
          await discardAssistantArtifactRunFileChangesBaseline(staleArtifactBaseline).catch(
            () => undefined,
          );
        }
        clearDurableRunFileChangesState(session);
        activeRunSession = session;
        activeRunTurnId = turnId;
        baselineByDroneId.clear();
        capturedBaselineByDroneId.clear();
        capturedArtifactBaseline = null;
        persistRunFileChangesState();
      };

      const continueRunFileChanges = async (session: BlipSessionState, turnId: string) => {
        activeRunSession = session;
        const durable = durableRunFileChangesState(session);
        if (!durable) {
          await beginRunFileChanges(session, turnId);
          return;
        }
        activeRunTurnId = durable.turnId;
        baselineByDroneId.clear();
        capturedBaselineByDroneId.clear();
        for (const baseline of durable.droneBaselines) {
          const settled = { baseline, drone: null };
          const capture = Promise.resolve(settled);
          if (baseline.droneId) {
            baselineByDroneId.set(baseline.droneId, capture);
            capturedBaselineByDroneId.set(baseline.droneId, baseline);
          }
        }
        capturedArtifactBaseline = durable.artifactBaseline ?? null;
        artifactBaseline = durable.artifactBaseline
          ? Promise.resolve(durable.artifactBaseline)
          : null;
      };
      const captureRunFileChangesBaseline = async (droneId: string) => {
        if (!activeRunTurnId || baselineByDroneId.has(droneId)) {
          await baselineByDroneId.get(droneId);
          return;
        }
        const turnId = activeRunTurnId;
        const capture = resolveCanonicalDroneOrPendingForReadRef(droneId)
          .then(async (resolved) => {
            const drone = resolved?.kind === 'real' ? resolved.drone : null;
            if (!drone) return null;
            const baseline = await captureDroneRunFileChangesBaseline({
              droneId,
              drone,
              owner: { threadId, turnId },
            });
            return baseline ? { baseline, drone } : null;
          })
          .catch((error: any) => {
            hubLog('warn', 'failed capturing native agent run file changes baseline', {
              threadId,
              droneId,
              error: String(error?.message ?? error ?? 'unknown error'),
            });
            return null;
          });
        void capture.then((settled) => {
          if (settled?.baseline) capturedBaselineByDroneId.set(droneId, settled.baseline);
          persistRunFileChangesState();
        });
        baselineByDroneId.set(droneId, capture);
        await capture;
      };
      const captureRunArtifactChangesBaseline = async () => {
        if (!activeRunTurnId || artifactBaseline) {
          await artifactBaseline;
          return;
        }
        artifactBaseline = captureAssistantArtifactRunFileChangesBaseline({
          threadId,
          turnId: activeRunTurnId,
        }).catch((error: any) => {
          hubLog('warn', 'failed capturing native agent artifact changes baseline', {
            threadId,
            error: String(error?.message ?? error ?? 'unknown error'),
          });
          return null;
        });
        const capture = artifactBaseline;
        void capture.then((settled) => {
          capturedArtifactBaseline = settled;
          persistRunFileChangesState();
        });
        await artifactBaseline;
      };
      const finishRunFileChanges = async () => {
        if (!activeRunTurnId) return null;
        const pendingArtifactBaseline = artifactBaseline;
        let artifactCleanupHandled = false;
        try {
          const [captures, capturedArtifactBaseline] = await Promise.all([
            Promise.all(baselineByDroneId.values()),
            pendingArtifactBaseline,
          ]);
          const workspaceCaptures = captures.flatMap((capture) => {
            if (!capture) return [];
            const droneId = String(capture.baseline.droneId ?? '').trim();
            if (!droneId) return [];
            return [
              resolveCanonicalDroneOrPendingForReadRef(droneId)
                .then((resolved) =>
                  finalizeDroneRunFileChangesWorkspace({
                    baseline: capture.baseline,
                    drone: resolved?.kind === 'real' ? resolved.drone : capture.drone,
                  }),
                )
                .catch((error: any) => {
                  hubLog('warn', 'failed finalizing native agent run file changes', {
                    threadId,
                    droneId,
                    error: String(error?.message ?? error ?? 'unknown error'),
                  });
                  return null;
                }),
            ];
          });
          if (capturedArtifactBaseline) {
            artifactCleanupHandled = true;
            workspaceCaptures.push(
              finalizeAssistantArtifactRunFileChanges({ baseline: capturedArtifactBaseline }).catch(
                (error: any) => {
                  hubLog('warn', 'failed finalizing native agent artifact changes', {
                    threadId,
                    error: String(error?.message ?? error ?? 'unknown error'),
                  });
                  return null;
                },
              ),
            );
          }
          const workspaces = await Promise.all(workspaceCaptures);
          return combineAgentRunFileChanges(workspaces.filter((workspace) => workspace !== null));
        } finally {
          clearDurableRunFileChangesState(activeRunSession);
          activeRunTurnId = '';
          activeRunSession = null;
          baselineByDroneId.clear();
          capturedBaselineByDroneId.clear();
          artifactBaseline = null;
          capturedArtifactBaseline = null;
          if (pendingArtifactBaseline && !artifactCleanupHandled) {
            const capturedArtifactBaseline = await pendingArtifactBaseline;
            if (capturedArtifactBaseline) {
              await discardAssistantArtifactRunFileChangesBaseline(capturedArtifactBaseline).catch(
                () => undefined,
              );
            }
          }
        }
      };
      const readableWorkspaceCapabilities = [
        'files.list',
        'files.read',
        'files.search',
        'git.status',
      ] as const;
      const readableDrones = workspaceDrones.filter((drone) => drone.canRead);
      const writableDrones = workspaceDrones.filter((drone) => drone.canWrite);
      const refsFor = (drones: any[]) =>
        Array.from(
          new Set(
            drones
              .flatMap((drone: any) => [String(drone.id ?? ''), String(drone.name ?? '')])
              .filter(Boolean),
          ),
        );
      const ownerDroneId = String(thread.ownerDroneId ?? '').trim();
      const ownerChatName = String(thread.ownerChatName ?? '').trim() || 'default';
      const workspaceDroneNameById = new Map(
        workspaceDrones.map((drone) => [
          String(drone.id ?? '').trim(),
          String(drone.name ?? '').trim(),
        ]),
      );
      const nativePrincipal: McpTokenIdentity | undefined = ownerDroneId
        ? {
            kind: 'chat',
            tokenId: `assistant:${threadId}`,
            name: `Built-in chat ${thread.title || ownerChatName}`,
            droneId: ownerDroneId,
            chatName: ownerChatName,
            chatId: threadId,
            accessScope: thread.accessScope,
            selectedDroneRefs: Array.from(
              new Set(
                thread.accessScope.droneIds.flatMap((droneId) => [
                  droneId,
                  workspaceDroneNameById.get(droneId) || '',
                ]),
              ),
            ).filter(Boolean),
          }
        : undefined;
      const mcpClient = await createInProcessDroneHubMcpClient({
        correlationId: threadId,
        allowedDroneRefs: refsFor(readableDrones),
        allowedWriteDroneRefs: refsFor(writableDrones),
        allowedDroneIds: readableDrones.map((drone: any) => String(drone.id ?? '')).filter(Boolean),
        principal: nativePrincipal,
        hubServices,
        ...(nativePrincipal ? { nativeThreadId: threadId } : {}),
      });
      const droneTargets = workspaceDrones
        .map((drone) => {
          return new DroneWorkspaceTarget({
            id: `drone:${drone.id}`,
            droneId: drone.id,
            label: drone.name || drone.id,
            rootLabel: `${drone.name || drone.id} workspace`,
            capabilities: [
              ...(drone.canRead ? readableWorkspaceCapabilities : []),
              ...(drone.canWrite
                ? ([
                    'files.write',
                    'files.delete',
                    'files.move',
                    'directories.create',
                    'directories.delete',
                    'patch.apply',
                  ] as const)
                : []),
              ...(drone.canExecute ? (['shell.execute'] as const) : []),
            ],
            execute: async (call) => {
              if (isMutatingWorkspaceTool(call.tool)) {
                await captureRunFileChangesBaseline(drone.id);
              }
              return await assistantService.executeDroneWorkspaceTool(threadId, drone.id, call, {
                parse: blipTools.parsePatch,
                applyHunks: blipTools.applyPatchHunks,
              });
            },
          });
        })
        .filter((target) => assistantService.workspaceIsEnabled(threadId, target.descriptor.id));
      const artifactTarget = assistantService.workspaceIsEnabled(threadId, `artifacts:${threadId}`)
        ? new AssistantArtifactsTarget(
            threadId,
            {
              parse: blipTools.parsePatch,
              applyHunks: blipTools.applyPatchHunks,
            },
            captureRunArtifactChangesBaseline,
          )
        : null;
      const remoteWorkspaceTargets = await deviceMesh.remoteWorkspaceTargets(threadId);
      const targets = [
        ...droneTargets,
        ...(artifactTarget ? [artifactTarget] : []),
        ...remoteWorkspaceTargets,
      ];
      const preferredDroneId = Array.isArray(thread.accessScope?.droneIds)
        ? thread.accessScope.droneIds[0]
        : '';
      const activeTargetId =
        droneTargets.find((target: DroneWorkspaceTarget) => target.droneId === preferredDroneId)
          ?.descriptor.id ?? targets[0]?.descriptor.id;
      const targetCatalog = new blipTools.WorkspaceTargetCatalog(targets, activeTargetId);
      const enabledTools = new Set(Array.isArray(thread.enabledTools) ? thread.enabledTools : []);
      const supportedWorkspaceCapabilities = new Set(
        targets.flatMap((target) => target.descriptor.capabilities),
      );
      const workspaceTools = blipTools
        .createWorkspaceTargetTools({
          profile: 'no-shell-workspace-write',
          includeShell: true,
          catalog: targetCatalog,
        })
        .filter((tool: any) => {
          if (!enabledTools.has(tool.name)) return false;
          const capability = blipTools.capabilityForWorkspaceTool(tool.name);
          if (
            thread.agentPermissionMode === 'read' &&
            capability &&
            !readableWorkspaceCapabilities.includes(capability as any)
          )
            return false;
          if (thread.agentPermissionMode !== 'execute' && capability === 'shell.execute')
            return false;
          return !capability || supportedWorkspaceCapabilities.has(capability);
        });
      const targetTools = blipTools
        .createWorkspaceTargetSelectionTools(targetCatalog)
        .filter((tool: any) => enabledTools.has(tool.name));
      const transferTools = blipTools
        .createWorkspaceTransferTools(targetCatalog)
        .filter(
          (tool: any) => thread.agentPermissionMode !== 'read' && enabledTools.has(tool.name),
        );
      const tools = [
        {
          name: 'get_system_prompt',
          label: 'Get system prompt',
          description: 'Read the current chat system prompt, global prompt, and runtime appendix.',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
          execute: async () => {
            const result = await assistantService.threadSystemPromptSettings(threadId);
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
              details: result,
            };
          },
        },
        {
          name: 'update_system_prompt',
          label: 'Update system prompt',
          description: 'Replace or patch only this chat system prompt.',
          parameters: {
            type: 'object',
            properties: {
              prompt: { type: 'string' },
              patches: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { oldText: { type: 'string' }, newText: { type: 'string' } },
                  required: ['oldText', 'newText'],
                  additionalProperties: false,
                },
              },
            },
            additionalProperties: false,
          },
          execute: async (_callId: string, args: any) => {
            const result = await assistantService.updateThreadSystemPrompt(threadId, args ?? {});
            return {
              content: [{ type: 'text' as const, text: 'Updated this chat system prompt.' }],
              details: result,
            };
          },
        },
        {
          name: 'set_thinking_level',
          label: 'Set thinking level',
          description: 'Change the thinking level for this chat while keeping its current model.',
          parameters: {
            type: 'object',
            properties: {
              level: { type: 'string', enum: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
            },
            required: ['level'],
            additionalProperties: false,
          },
          execute: async (_callId: string, args: any) => {
            const before = thread.thinkingLevel;
            const updated = await assistantService.updateThread(threadId, {
              thinkingLevel: args?.level,
            });
            const next =
              updated.threads.find((candidate) => candidate.id === threadId)?.thinkingLevel ??
              before;
            setTimeout(() => blipAssistantHost.invalidateThread(threadId), 0);
            const result = {
              previousThinkingLevel: before,
              thinkingLevel: next,
              provider: thread.provider,
              model: thread.model,
            };
            return {
              content: [{ type: 'text' as const, text: `Thinking level is now ${next}.` }],
              details: result,
            };
          },
        },
        {
          name: 'web_search',
          label: 'Web search',
          description: 'Search the web for current information and source URLs.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              numResults: { type: 'number' },
              recencyFilter: { type: 'string', enum: ['day', 'week', 'month', 'year'] },
              domainFilter: { type: 'array', items: { type: 'string' } },
            },
            required: ['query'],
          },
          execute: async (_callId: string, args: any) => {
            const settings = await resolveExaApiKeySettings();
            const result = await searchWeb(args, settings.apiKey ?? '');
            return { content: [{ type: 'text' as const, text: result.answer }], details: result };
          },
        },
        {
          name: 'fetch_content',
          label: 'Fetch content',
          description: 'Fetch readable content from an HTTP or HTTPS URL.',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              maxCharacters: { type: 'number' },
              livecrawl: { type: 'string', enum: ['never', 'fallback', 'preferred', 'always'] },
            },
            required: ['url'],
          },
          execute: async (_callId: string, args: any) => {
            const settings = await resolveExaApiKeySettings();
            const result = await fetchContent(args, settings.apiKey ?? '');
            return { content: [{ type: 'text' as const, text: result.answer }], details: result };
          },
        },
        ...targetTools,
        ...transferTools,
        ...workspaceTools,
      ].filter((tool: any) => enabledTools.has(tool.name));
      const mcpProvider = createMcpToolProvider({
        id: 'drone-hub',
        namePrefix: 'drone_hub',
        client: mcpClient,
        promptGuidance:
          'Use drone_hub__ tools for Drone Hub drones, chats, groups, repositories, and whiteboards.',
        correlation: () => ({ threadId }),
      });
      const enabledMcpProvider = {
        id: mcpProvider.id,
        promptSections: ASSISTANT_DRONE_HUB_MCP_TOOL_NAMES.some((name) => enabledTools.has(name))
          ? mcpProvider.promptSections?.bind(mcpProvider)
          : () => [],
        async load(context: any) {
          return (await mcpProvider.load(context)).filter((tool) => {
            const unqualified = tool.name.replace(/^drone_hub__/, '');
            return (
              enabledTools.has(unqualified) &&
              !(
                thread.agentPermissionMode === 'read' &&
                ASSISTANT_READ_ONLY_DENIED_TOOL_NAMES.has(unqualified)
              )
            );
          });
        },
      };
      const transportProvider =
        thread.provider === 'codex'
          ? 'openai-codex'
          : thread.provider === 'gemini'
            ? 'google'
            : thread.provider;
      hubLog('info', 'assistant model session configuring', {
        threadId,
        provider: thread.provider,
        transportProvider,
        model: thread.model,
        thinkingLevel: thread.thinkingLevel,
      });
      return {
        provider: thread.provider,
        model: thread.model,
        thinkingLevel: thread.thinkingLevel,
        promptDeliveryMode: thread.promptDeliveryMode,
        systemPrompt: assistantService.resolvedSystemPrompt(threadId, {
          multipleWorkspaceTargets: targetCatalog.size() > 1,
          workspaceTargetCount: targetCatalog.size(),
        }),
        tools,
        toolProviders: [enabledMcpProvider],
        onResponse: async (response: any, model: any) => {
          const headers =
            response?.headers && typeof response.headers === 'object' ? response.headers : {};
          const header = (name: string) => {
            const value = String(headers[name] ?? headers[name.toLowerCase()] ?? '').trim();
            return value || undefined;
          };
          const status = Number(response?.status ?? 0) || undefined;
          hubLog(
            status != null && status >= 400 ? 'warn' : 'info',
            'assistant model provider response',
            {
              threadId,
              provider: thread.provider,
              transportProvider: String(model?.provider ?? transportProvider),
              model: String(model?.id ?? thread.model),
              api: String(model?.api ?? ''),
              status,
              requestId:
                header('x-request-id') ?? header('request-id') ?? header('openai-request-id'),
              clientRequestId: header('x-client-request-id'),
              processingMs: header('openai-processing-ms'),
              cfRay: header('cf-ray'),
              remainingRequests: header('x-ratelimit-remaining-requests'),
            },
          );
        },
        beforePrompt: ({ session, turnId, kind }) =>
          kind === 'prompt'
            ? beginRunFileChanges(session, turnId)
            : continueRunFileChanges(session, turnId),
        afterPrompt: async ({ status }) => {
          if (status === 'suspended') return undefined;
          try {
            const fileChanges = await finishRunFileChanges();
            return fileChanges ? { fileChanges } : undefined;
          } catch (error: any) {
            hubLog('warn', 'failed collecting native agent run file changes', {
              threadId,
              error: String(error?.message ?? error ?? 'unknown error'),
            });
            return undefined;
          }
        },
        permissionPreflight: async (request) => {
          let toolName = request.tool.replace(/^drone_hub__/, '');
          let args: any = request.args && typeof request.args === 'object' ? request.args : {};
          if (toolName === 'ask_questions' && request.phase === 'initial') {
            const questionRequest = await hubServices.questions.create({
              droneId: ownerDroneId,
              chatName: ownerChatName,
              chatId: threadId,
              nativeThreadId: threadId,
              toolCallId: request.callId,
              toolName: request.tool,
              questions: args.questions,
            });
            if (questionRequest.result) return { status: 'allow' as const };
            return {
              status: 'suspend' as const,
              id: questionRequest.id,
              reason: 'Waiting for answers from the user.',
              details: { questionRequest },
            };
          }
          if (toolName === 'send_message') {
            toolName = 'message_drone';
            args = { ...args, droneId: args.drone, chatName: args.chat };
          } else if (blipTools.capabilityForWorkspaceTool(toolName)) {
            const target = targetCatalog.resolve(args.target);
            if (targetCatalog.size() > 1) args.target = target.descriptor.id;
            if (target instanceof DroneWorkspaceTarget) args = { ...args, droneId: target.droneId };
            else if (toolName === 'bash') args = { ...args, workspaceTarget: target.descriptor };
          }
          const decision = await assistantService.preflightBlipTool(
            threadId,
            toolName,
            request.callId,
            args,
            request.signal,
            request.phase,
          );
          return decision;
        },
        getApiKey: resolveBlipProviderApiKey,
        dispose: () => mcpClient.close(),
      };
    },
    async (threadId, event) => {
      await assistantService.notifyRuntimeEvent(threadId, event);
      if (event.type === 'session_error') {
        let thread: any;
        try {
          thread = (await assistantService.threadSnapshot(threadId)).threads.find(
            (candidate) => candidate.id === threadId,
          );
        } catch {}
        hubLog('warn', 'assistant model session failed', {
          threadId,
          sessionId: event.sessionId,
          turnId: event.turnId,
          eventId: event.eventId,
          provider: thread?.provider,
          model: thread?.model,
          thinkingLevel: thread?.thinkingLevel,
          error: String(event.error ?? '').slice(0, 2_000),
          recoverable: event.recoverable,
        });
      }
    },
  );
  deviceMesh.onAssistantPolicyChange((threadIds: string[]) => {
    for (const threadId of threadIds) {
      blipAssistantHost.invalidateThread(threadId);
      void assistantService
        .nativeThreadOwner(threadId)
        .then((owner) => {
          if (!owner) return;
          return deviceMesh.broadcastDroneChatChange({
            reason: 'workspace_policy_changed',
            droneId: owner.droneId,
            chatName: owner.chatName,
          });
        })
        .catch(() => {});
    }
  });
  const unsubscribeAssistantChanges = assistantService.subscribeChanges((event) => {
    if (event.threadId) {
      void assistantService
        .nativeThreadOwner(event.threadId)
        .then((owner) => {
          if (!owner) return;
          if (event.reason === 'canonical_history_changed') onNativePromptQueueChanged?.(owner);
          if (
            event.reason === 'runtime_started' ||
            event.reason === 'approval_pending' ||
            event.reason === 'approval_recovery_required' ||
            event.reason === 'approval_resolved' ||
            event.reason === 'runtime_finished' ||
            event.reason === 'runtime_error'
          ) {
            onNativeThreadStateChanged?.(owner);
          }
          return deviceMesh.broadcastDroneChatChange({
            sequence: event.sequence,
            reason: event.reason,
            droneId: owner.droneId,
            chatName: owner.chatName,
            at: event.at,
          });
        })
        .catch(() => {});
    }
  });
  assistantService.setTextPromptDelegate(async (threadId, prompt) => {
    await blipAssistantHost.promptThread(threadId, prompt);
  });
  assistantService.setRuntimeStopDelegate((threadId) => {
    blipAssistantHost.stopThread(threadId);
  });
  assistantService.setApprovalDecisionDelegate(async (threadId, approvalId, approved) => {
    await blipAssistantHost.beginToolSuspensionResolution(threadId, approvalId, approved);
  });
  hubServices.questions.setNativeResolver(async (request, result) => {
    if (!request.nativeThreadId) return;
    await blipAssistantHost.beginToolSuspensionResult(request.nativeThreadId, request.id, {
      text: JSON.stringify(result, null, 2),
      details: result,
    });
  });
  const unsubscribeQuestionChanges = hubServices.questions.subscribeResolved(({ request }) => {
    if (!request.nativeThreadId) return;
    void assistantService.notifyQuestionRequestResolved(request.nativeThreadId).catch((error) => {
      hubLog('warn', 'failed broadcasting native question resolution', {
        threadId: request.nativeThreadId,
        requestId: request.id,
        error: String(error instanceof Error ? error.message : error),
      });
    });
  });
  const unsubscribeDeviceMeshAssistantChanges = () => {
    unsubscribeQuestionChanges();
    unsubscribeAssistantChanges();
  };
  void blipAssistantHost
    .restorePendingApprovals()
    .then(() => hubServices.questions.reconcileQueuedRequests())
    .catch((error) => {
      hubLog('warn', 'failed restoring durable assistant inputs', {
        error: String(error instanceof Error ? error.message : error),
      });
    });
  type AssistantPromptInput =
    | string
    | { text: string; images: Array<{ type: 'image'; data: string; mimeType: string }> };
  const assistantPromptDrains = new Map<string, Promise<void>>();
  const notifyNativePromptQueueChanged = async (threadId: string): Promise<void> => {
    if (!onNativePromptQueueChanged) return;
    const owner = await assistantService.nativeThreadOwner(threadId);
    if (owner) onNativePromptQueueChanged(owner);
  };
  const queuedPromptInput = (queued: any): AssistantPromptInput => {
    const images = Array.isArray(queued?.promptImages) ? queued.promptImages : [];
    return images.length > 0
      ? { text: String(queued?.prompt ?? ''), images }
      : String(queued?.prompt ?? '');
  };
  const startAssistantPromptDrain = (
    threadId: string,
  ): { started: boolean; promise: Promise<void> } => {
    const existing = assistantPromptDrains.get(threadId);
    if (existing) return { started: false, promise: existing };
    const promise = Promise.resolve()
      .then(async () => {
        await blipAssistantHost.waitForThreadIdle(threadId);
        while (true) {
          const queued = await assistantService.claimNextQueuedPrompt(threadId);
          if (!queued) break;
          await notifyNativePromptQueueChanged(threadId);
          try {
            await blipAssistantHost.waitForThreadIdle(threadId);
            await blipAssistantHost.promptThread(threadId, queuedPromptInput(queued));
            await assistantService.completeQueuedPrompt(threadId, queued.id);
          } catch (error) {
            await assistantService.failQueuedPrompt(threadId, queued.id, error);
          } finally {
            await notifyNativePromptQueueChanged(threadId);
          }
        }
      })
      .finally(() => {
        assistantPromptDrains.delete(threadId);
        void assistantService
          .hasQueuedPrompts(threadId)
          .then((hasQueued) => {
            if (hasQueued) {
              const restarted = startAssistantPromptDrain(threadId);
              void restarted.promise.catch((error: any) => {
                hubLog('warn', 'assistant queued prompt drain failed', {
                  threadId,
                  error: error?.message ?? String(error),
                });
              });
            }
          })
          .catch(() => {});
      });
    assistantPromptDrains.set(threadId, promise);
    return { started: true, promise };
  };

  const submitAssistantPrompt = createNativePromptSubmitter({
    assistantService,
    blipAssistantHost,
    notifyNativePromptQueueChanged,
    startAssistantPromptDrain,
    hubLog,
  });
  void assistantService
    .threadIdsWithQueuedPrompts()
    .then((threadIds) => {
      for (const threadId of threadIds) {
        const drain = startAssistantPromptDrain(threadId);
        void drain.promise.catch((error: any) => {
          hubLog('warn', 'assistant queued prompt recovery drain failed', {
            threadId,
            error: error?.message ?? String(error),
          });
        });
      }
    })
    .catch((error: any) => {
      hubLog('warn', 'assistant queued prompt recovery failed', {
        error: error?.message ?? String(error),
      });
    });
  function writeAssistantSseEvent(res: http.ServerResponse, event: string, data: any): void {
    if (res.destroyed || res.writableEnded) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  return {
    assistantPromptDrains,
    assistantService,
    blipAssistantHost,
    buildAssistantDroneSummariesFromRegistry,
    emitWhiteboardChange,
    startAssistantPromptDrain,
    submitAssistantPrompt,
    subscribeWhiteboardChanges,
    unsubscribeDeviceMeshAssistantChanges,
    writeAssistantSseEvent,
  };
}
