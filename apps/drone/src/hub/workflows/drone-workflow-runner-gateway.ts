import crypto from 'node:crypto';

import { buildWorkflowChatMetadata } from './workflow-chat-metadata';
import { tagWorkflowChildDrone } from './workflow-child-drone-metadata';
import { mapWorkflowPermissionsToBlip } from './workflow-permissions';
import type {
  WorkflowChatOrigin,
  WorkflowRunnerGateway,
  WorkflowRunnerTarget,
} from './workflow-runner';
import type { WorkflowAgent } from './workflow-types';

export type DroneWorkflowRunnerGatewayDependencies = {
  nowIso: () => string;
  resolveDrone: (droneId: string) => Promise<any>;
  importDroneChats: (input: { droneId: string; chats: unknown }) => Promise<unknown>;
  createChat: (input: any) => Promise<any>;
  updateChat: (input: {
    droneId: string;
    chatName: string;
    update: (chat: any) => unknown;
  }) => Promise<any>;
  readChat: (input: { droneId: string; chatName: string }) => any;
  listChats: (input: { droneId: string }) => { chats: string[] };
  deleteChat: (input: any) => Promise<any>;
  listArchivedChats: (input: { droneId: string }) => {
    archivedChats: Array<{ chatName: string; chat: any }>;
  };
  deleteArchivedChat: (input: { droneId: string; archivedChatName: string }) => Promise<any>;
  projectChats: (droneId: string) => Promise<void>;
  buildChatEntry: (input: any) => any;
  enqueuePrompt: (input: any) => Promise<any>;
  stopChatActivity: (input: any) => Promise<void>;
  localApiRequest: (method: 'POST' | 'DELETE', pathname: string, body?: unknown) => Promise<any>;
  tagChildDrone?: typeof tagWorkflowChildDrone;
  notifyChatWrite?: (droneId: string, chatName: string) => void;
  notifyDroneWrite?: () => void;
};

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(String(signal.reason || 'workflow cancelled'));
}

function hubAgentPermissionMode(
  permissionMode: 'read-only' | 'workspace-write' | 'full-access',
): 'read' | 'write' | 'execute' {
  if (permissionMode === 'read-only') return 'read';
  if (permissionMode === 'workspace-write') return 'write';
  return 'execute';
}

function workflowChatConfiguration(
  origin: WorkflowChatOrigin,
  agent: WorkflowAgent,
): Record<string, unknown> {
  const mapping = mapWorkflowPermissionsToBlip(agent.permissions);
  const agentPermissionMode = hubAgentPermissionMode(mapping.permissionMode);
  return {
    agent: { kind: 'builtin', id: agent.runner.agent.id },
    ...buildWorkflowChatMetadata({
      origin,
      permissions: agent.permissions,
      toolProfile: mapping.toolProfile,
    }),
    ...(agentPermissionMode !== 'execute' ? { agentPermissionMode } : {}),
    ...(agent.model && agent.model !== 'inherit' ? { model: agent.model } : {}),
  };
}

function childDroneCreateBody(input: {
  ownerDroneId: string;
  owner: any;
  origin: WorkflowChatOrigin;
  agent: WorkflowAgent;
}): Record<string, unknown> {
  const suffix = crypto.randomBytes(4).toString('hex');
  const runtime = String(input.owner?.runtime?.kind ?? input.owner?.runtime ?? 'container');
  const repoPath = String(input.owner?.repoPath ?? '').trim();
  const mapping = mapWorkflowPermissionsToBlip(input.agent.permissions);
  const seedAgentPermissionMode = hubAgentPermissionMode(mapping.permissionMode);
  return {
    name: `workflow-${input.origin.runId.slice(-8)}-${suffix}`,
    runtime: 'container',
    draft: true,
    fleetParentId: input.ownerDroneId,
    ...(runtime === 'container'
      ? { cloneFrom: input.ownerDroneId, cloneChats: false }
      : repoPath
        ? { repoPath }
        : {}),
    seedAgent: { kind: 'builtin', id: input.agent.runner.agent.id },
    ...(input.agent.model && input.agent.model !== 'inherit'
      ? { seedModel: input.agent.model }
      : {}),
    ...(seedAgentPermissionMode !== 'execute' ? { seedAgentPermissionMode } : {}),
  };
}

export function createDroneWorkflowRunnerGateway(
  dependencies: DroneWorkflowRunnerGatewayDependencies,
): WorkflowRunnerGateway {
  const chatNameById = async (droneId: string, chatId: string): Promise<string | null> => {
    for (const chatName of dependencies.listChats({ droneId }).chats) {
      const read = dependencies.readChat({ droneId, chatName });
      if (String(read?.chat?.id ?? '') === chatId) return chatName;
    }
    return null;
  };

  const waitForRealDrone = async (droneId: string, signal: AbortSignal): Promise<any> => {
    while (true) {
      if (signal.aborted) throw abortError(signal);
      const resolved = await dependencies.resolveDrone(droneId);
      if (!resolved) throw new Error('workflow child drone no longer exists');
      if (resolved?.kind === 'real') return resolved.drone;
      if (resolved?.kind === 'pending' && String(resolved.pending?.phase) === 'error') {
        throw new Error(String(resolved.pending?.error || 'workflow child drone failed to start'));
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
  };

  const createChatTarget = async (input: {
    ownerDroneId: string;
    origin: WorkflowChatOrigin;
    agent: WorkflowAgent;
    signal: AbortSignal;
  }): Promise<WorkflowRunnerTarget> => {
    const resolved = await dependencies.resolveDrone(input.ownerDroneId);
    if (!resolved || resolved.kind !== 'real') {
      throw new Error(`unknown drone: ${input.ownerDroneId}`);
    }
    await dependencies.importDroneChats({
      droneId: input.ownerDroneId,
      chats: resolved.drone?.chats ?? {},
    });
    const suffix = crypto.randomBytes(4).toString('hex');
    const chatName = `workflow-${input.origin.runId.slice(-8)}-${suffix}`;
    const created = await dependencies.createChat({
      droneId: input.ownerDroneId,
      chatName,
      createEntry: () => ({
        ...dependencies.buildChatEntry({
          droneEntry: resolved.drone,
          createdAt: dependencies.nowIso(),
        }),
        ...workflowChatConfiguration(input.origin, input.agent),
      }),
    });
    await dependencies.projectChats(input.ownerDroneId);
    dependencies.notifyChatWrite?.(input.ownerDroneId, chatName);
    const chatId = String(created?.chat?.id ?? '').trim();
    if (!chatId) throw new Error('workflow chat was created without a stable id');
    return {
      runnerKind: 'drone-chat',
      executionDroneId: input.ownerDroneId,
      childDroneId: null,
      chatId,
      chatName,
    };
  };

  const createDroneTarget = async (input: {
    ownerDroneId: string;
    origin: WorkflowChatOrigin;
    agent: WorkflowAgent;
    signal: AbortSignal;
  }): Promise<WorkflowRunnerTarget> => {
    const resolved = await dependencies.resolveDrone(input.ownerDroneId);
    if (!resolved || resolved.kind !== 'real') {
      throw new Error(`unknown drone: ${input.ownerDroneId}`);
    }
    const created = await dependencies.localApiRequest(
      'POST',
      '/api/drones',
      childDroneCreateBody({
        ownerDroneId: input.ownerDroneId,
        owner: resolved.drone,
        origin: input.origin,
        agent: input.agent,
      }),
    );
    const childDroneId = String(created?.id ?? '').trim();
    if (!childDroneId) throw new Error('workflow child drone was created without a stable id');
    try {
      const metadata = { ownerDroneId: input.ownerDroneId, ...input.origin };
      await (dependencies.tagChildDrone ?? tagWorkflowChildDrone)({
        droneId: childDroneId,
        state: 'pending',
        metadata,
      });
      dependencies.notifyDroneWrite?.();
      await dependencies.localApiRequest(
        'POST',
        `/api/drones/${encodeURIComponent(childDroneId)}/publish`,
        {},
      );
      const childDrone = await waitForRealDrone(childDroneId, input.signal);
      await (dependencies.tagChildDrone ?? tagWorkflowChildDrone)({
        droneId: childDroneId,
        state: 'real',
        metadata,
      });
      await dependencies.importDroneChats({
        droneId: childDroneId,
        chats: childDrone?.chats ?? {},
      });
      await dependencies.updateChat({
        droneId: childDroneId,
        chatName: 'default',
        update: (chat) => ({
          ...chat,
          ...workflowChatConfiguration(input.origin, input.agent),
        }),
      });
      await dependencies.projectChats(childDroneId);
      dependencies.notifyDroneWrite?.();
      dependencies.notifyChatWrite?.(childDroneId, 'default');
      const read = dependencies.readChat({
        droneId: childDroneId,
        chatName: 'default',
      });
      const chatId = String(read?.chat?.id ?? '').trim();
      if (!chatId) throw new Error('workflow child drone default chat has no stable id');
      return {
        runnerKind: 'drone',
        executionDroneId: childDroneId,
        childDroneId,
        chatId,
        chatName: 'default',
      };
    } catch (error) {
      await dependencies
        .localApiRequest(
          'DELETE',
          `/api/drones/${encodeURIComponent(childDroneId)}?keepVolume=0&forget=1`,
        )
        .catch(() => {});
      throw error;
    }
  };

  const deleteChatTarget = async (target: WorkflowRunnerTarget): Promise<void> => {
    const chatName = await chatNameById(target.executionDroneId, target.chatId);
    if (chatName) {
      await dependencies.deleteChat({
        droneId: target.executionDroneId,
        chatName,
      });
      await dependencies.projectChats(target.executionDroneId);
      dependencies.notifyChatWrite?.(target.executionDroneId, chatName);
      return;
    }
    const archived = dependencies
      .listArchivedChats({ droneId: target.executionDroneId })
      .archivedChats.find((entry) => String(entry.chat?.id ?? '') === target.chatId);
    if (archived) {
      await dependencies.deleteArchivedChat({
        droneId: target.executionDroneId,
        archivedChatName: archived.chatName,
      });
    }
  };

  return {
    createTarget(input) {
      return input.agent.runner.kind === 'drone'
        ? createDroneTarget(input)
        : createChatTarget(input);
    },

    async runPrompt({ target, prompt, signal }) {
      const initialChatName = await chatNameById(target.executionDroneId, target.chatId);
      if (!initialChatName) throw new Error('workflow runner chat no longer exists');
      const enqueued = await dependencies.enqueuePrompt({
        droneId: target.executionDroneId,
        chatName: initialChatName,
        prompt,
        submissionSource: 'workflow',
      });
      if (enqueued?.kind !== 'enqueued') {
        throw new Error(enqueued?.error || 'workflow prompt could not be queued');
      }
      const promptRunId = String(enqueued.id);
      while (true) {
        if (signal.aborted) {
          const resolved = await dependencies.resolveDrone(target.executionDroneId);
          const currentChatName = await chatNameById(target.executionDroneId, target.chatId);
          if (resolved?.kind === 'real') {
            await dependencies.stopChatActivity({
              droneId: target.executionDroneId,
              chatName: currentChatName ?? initialChatName,
              droneEntry: resolved.drone,
            });
          }
          throw abortError(signal);
        }
        const currentChatName = await chatNameById(target.executionDroneId, target.chatId);
        if (!currentChatName) {
          throw new Error('workflow runner chat was deleted before its prompt finished');
        }
        const read = dependencies.readChat({
          droneId: target.executionDroneId,
          chatName: currentChatName,
        });
        const turns = Array.isArray(read?.chat?.turns) ? read.chat.turns : [];
        const turn = turns.find((candidate: any) => String(candidate?.id ?? '') === promptRunId);
        if (turn) {
          if (turn.ok === false) {
            throw new Error(String(turn.error || 'workflow prompt failed'));
          }
          return {
            promptRunId,
            text: String(turn.output ?? ''),
            changedFiles: Array.isArray(turn.changedFiles) ? turn.changedFiles : [],
            usage: turn.usage ?? null,
          };
        }
        const pending = Array.isArray(read?.chat?.pendingPrompts)
          ? read.chat.pendingPrompts.find(
              (candidate: any) => String(candidate?.id ?? '') === promptRunId,
            )
          : null;
        if (pending && ['failed', 'cancelled'].includes(String(pending.state))) {
          throw new Error(String(pending.error || `workflow prompt ${pending.state}`));
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
      }
    },

    async stopTarget({ target }) {
      const chatName = await chatNameById(target.executionDroneId, target.chatId);
      if (!chatName) return;
      const resolved = await dependencies.resolveDrone(target.executionDroneId);
      if (resolved?.kind !== 'real') return;
      await dependencies.stopChatActivity({
        droneId: target.executionDroneId,
        chatName,
        droneEntry: resolved.drone,
      });
    },

    async deleteTarget({ target }) {
      if (target.childDroneId) {
        try {
          await dependencies.localApiRequest(
            'DELETE',
            `/api/drones/${encodeURIComponent(target.childDroneId)}?keepVolume=0&forget=1`,
          );
        } catch (error: any) {
          if (Number(error?.status) !== 404) throw error;
        }
        return;
      }
      await deleteChatTarget(target);
    },

    async resolveTarget({ target }) {
      const resolved = await dependencies.resolveDrone(target.executionDroneId);
      if (resolved?.kind !== 'real') return null;
      const chatName = await chatNameById(target.executionDroneId, target.chatId);
      return chatName ? { ...target, chatName } : null;
    },
  };
}
