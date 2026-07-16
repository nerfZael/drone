import type http from 'node:http';

import { loadRegistry } from '../host/registry';
import { normalizeDroneRuntime } from '../host/runtime';
import { HubAssistantService, type AssistantDroneSummary } from './assistant';
import { BlipAssistantHost } from './assistant/blip-assistant-host';
import { loadBlipMcp, loadBlipTools } from './assistant/blip-runtime-loader';
import { createInProcessDroneHubMcpClient } from './assistant/in-process-drone-hub-mcp';
import { AssistantArtifactsTarget } from './assistant/targets/assistant-artifacts-target';
import { DroneWorkspaceTarget } from './assistant/targets/workspace-targets';
import {
  hubLog,
  resolveEffectiveProviderApiKeySettings,
  resolveExaApiKeySettings,
} from './hub-settings';
import { fetchContent, searchWeb } from './web-search';

export interface AssistantRuntimeDependencies {
  assistantFilesystemService: any;
  busyChatNamesForDrone: (drone: any, droneId: string) => string[];
  deviceMesh: any;
  normalizeDroneIdentity: (value: unknown) => string;
  nowIso: () => string;
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
    summarizeDroneActivity,
  } = deps;
  const {
    assistantAbortDroneTransferFile,
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
      const regAny: any = await loadRegistry();
      return buildAssistantDroneSummariesFromRegistry(regAny);
    },
    listDroneFiles: async ({ droneId, path }) => await assistantListDroneFiles({ droneId, path }),
    readDroneFile: async ({ droneId, path, startLine, endLine }) =>
      await assistantReadDroneFile({ droneId, path, startLine, endLine }),
    writeDroneFile: async ({ droneId, path, content }) =>
      await assistantWriteDroneFile({ droneId, path, content }),
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
      const mcpClient = await createInProcessDroneHubMcpClient({
        correlationId: threadId,
        allowedDroneRefs: refsFor(readableDrones),
        allowedWriteDroneRefs: refsFor(writableDrones),
        allowedDroneIds: readableDrones.map((drone: any) => String(drone.id ?? '')).filter(Boolean),
      });
      const droneTargets = workspaceDrones.map((drone) => {
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
          execute: async (call) =>
            assistantService.executeDroneWorkspaceTool(threadId, drone.id, call, {
              parse: blipTools.parsePatch,
              applyHunks: blipTools.applyPatchHunks,
            }),
        });
      });
      const artifactTarget = new AssistantArtifactsTarget(threadId);
      const remoteWorkspaceTargets = await deviceMesh.remoteWorkspaceTargets(threadId);
      const targets = [...droneTargets, artifactTarget, ...remoteWorkspaceTargets];
      const preferredDroneId = Array.isArray(thread.accessScope?.droneIds)
        ? thread.accessScope.droneIds[0]
        : '';
      const activeTargetId =
        droneTargets.find((target: DroneWorkspaceTarget) => target.droneId === preferredDroneId)
          ?.descriptor.id ?? targets[0]?.descriptor.id;
      const targetCatalog = new blipTools.WorkspaceTargetCatalog(targets, activeTargetId);
      const enabledTools = new Set(Array.isArray(thread.enabledTools) ? thread.enabledTools : []);
      const workspaceTools = blipTools
        .createWorkspaceTargetTools({
          profile: 'no-shell-workspace-write',
          includeShell: true,
          catalog: targetCatalog,
        })
        .filter((tool) => enabledTools.has(tool.name));
      const targetTools = blipTools
        .createWorkspaceTargetSelectionTools(targetCatalog)
        .filter((tool) => enabledTools.has(tool.name));
      const transferTools = blipTools
        .createWorkspaceTransferTools(targetCatalog)
        .filter((tool) => enabledTools.has(tool.name));
      const tools = [
        {
          name: 'get_current_context',
          label: 'Get current context',
          description: 'Read the current Drone Hub UI context and this thread access scope.',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
          execute: async () => {
            const context = assistantService.currentContext(threadId);
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(context, null, 2) }],
              details: context,
            };
          },
        },
        {
          name: 'get_system_prompt',
          label: 'Get system prompt',
          description:
            'Read the current thread system prompt, global prompt, and runtime appendix.',
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
          description: 'Replace or patch only this assistant thread system prompt.',
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
              content: [
                { type: 'text' as const, text: 'Updated this assistant thread system prompt.' },
              ],
              details: result,
            };
          },
        },
        {
          name: 'set_thinking_level',
          label: 'Set thinking level',
          description:
            'Change the thinking level for this assistant thread while keeping its current model.',
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
          name: 'create_new_thread',
          label: 'Create new thread',
          description:
            'Create a fresh assistant thread only when the user explicitly asks for one.',
          parameters: {
            type: 'object',
            properties: { title: { type: 'string' } },
            additionalProperties: false,
          },
          execute: async (_callId: string, args: any) => {
            const result = await assistantService.createNewThreadFromThread(threadId, {
              title: args?.title,
            });
            return {
              content: [
                { type: 'text' as const, text: `Created assistant thread ${result.thread.title}.` },
              ],
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
      ].filter((tool) => enabledTools.has(tool.name));
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
        promptSections: mcpProvider.promptSections?.bind(mcpProvider),
        async load(context: any) {
          return (await mcpProvider.load(context)).filter((tool) => {
            const unqualified = tool.name.replace(/^drone_hub__/, '');
            return enabledTools.has(unqualified);
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
        permissionPreflight: async (request) => {
          let toolName = request.tool;
          let args: any = request.args && typeof request.args === 'object' ? request.args : {};
          if (toolName === 'drone_hub__send_message') {
            toolName = 'message_drone';
            args = { ...args, droneId: args.drone, chatName: args.chat };
          } else if (toolName === 'drone_hub__set_drone_group') {
            toolName = 'set_drone_group';
          } else if (toolName === 'drone_hub__rename_drones') {
            toolName = 'rename_drones';
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
          );
          return decision?.block
            ? { status: 'deny' as const, reason: decision.reason ?? `Denied ${toolName}` }
            : { status: 'allow' as const };
        },
        getApiKey: async (provider: string) => {
          const normalized =
            provider === 'openai-codex' ? 'codex' : provider === 'google' ? 'gemini' : provider;
          if (normalized !== 'openai' && normalized !== 'codex' && normalized !== 'gemini')
            return undefined;
          return (await resolveEffectiveProviderApiKeySettings(normalized)).apiKey ?? undefined;
        },
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
      void deviceMesh.broadcastAssistantThreadChange({
        reason: 'workspace_policy_changed',
        threadId,
      });
    }
  });
  const unsubscribeDeviceMeshAssistantChanges = assistantService.subscribeChanges((event) => {
    void deviceMesh.broadcastAssistantThreadChange({
      sequence: event.sequence,
      reason: event.reason,
      ...(event.threadId ? { threadId: event.threadId } : {}),
      at: event.at,
    });
  });
  assistantService.setTextPromptDelegate(async (threadId, prompt) => {
    await blipAssistantHost.promptThread(threadId, prompt);
  });
  type AssistantPromptInput =
    | string
    | { text: string; images: Array<{ type: 'image'; data: string; mimeType: string }> };
  const assistantPromptDrains = new Map<string, Promise<void>>();
  const queuedPromptInput = (queued: any): AssistantPromptInput => {
    const images = Array.isArray(queued?.promptImages) ? queued.promptImages : [];
    return images.length > 0
      ? { text: String(queued?.prompt ?? ''), images }
      : String(queued?.prompt ?? '');
  };
  const startAssistantPromptDrain = (
    threadId: string,
    initial?: { input: AssistantPromptInput; onEvent?: (event: any) => Promise<void> | void },
  ): { started: boolean; promise: Promise<void>; initialPromise: Promise<void> } => {
    const existing = assistantPromptDrains.get(threadId);
    if (existing) return { started: false, promise: existing, initialPromise: existing };
    let resolveInitial!: () => void;
    let rejectInitial!: (error: unknown) => void;
    const initialPromise = new Promise<void>((resolve, reject) => {
      resolveInitial = resolve;
      rejectInitial = reject;
    });
    if (!initial) void initialPromise.catch(() => {});
    const promise = Promise.resolve()
      .then(async () => {
        try {
          if (initial) {
            await blipAssistantHost.waitForThreadIdle(threadId);
            await blipAssistantHost.promptThread(threadId, initial.input, initial.onEvent);
          } else {
            await blipAssistantHost.waitForThreadIdle(threadId);
          }
          resolveInitial();
        } catch (error) {
          rejectInitial(error);
          throw error;
        }
        while (true) {
          const queued = await assistantService.claimNextQueuedPrompt(threadId);
          if (!queued) break;
          try {
            await blipAssistantHost.waitForThreadIdle(threadId);
            await blipAssistantHost.promptThread(threadId, queuedPromptInput(queued));
            await assistantService.completeQueuedPrompt(threadId, queued.id);
          } catch (error) {
            await assistantService.failQueuedPrompt(threadId, queued.id, error);
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
    return { started: true, promise, initialPromise };
  };
  void assistantService
    .snapshot('compact')
    .then((snapshot) => {
      for (const thread of snapshot.threads) {
        if (!thread.queuedPrompts?.some((prompt: any) => prompt.status === 'queued')) continue;
        const drain = startAssistantPromptDrain(thread.id);
        void drain.promise.catch((error: any) => {
          hubLog('warn', 'assistant queued prompt recovery drain failed', {
            threadId: thread.id,
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
    subscribeWhiteboardChanges,
    unsubscribeDeviceMeshAssistantChanges,
    writeAssistantSseEvent,
  };
}
