import React from 'react';
import {
  executeCompanionProposal,
  resolveCompanionChatName,
  type CompanionProposal,
} from '@drone/assistant-chat';
import type { DroneControlRequest } from '@drone/device-protocol';

import {
  mobileDroneCreatePreferencesFromPayload,
  type MobileDroneCreatePreferences,
} from '../drones/create-preferences-model';
import { loadMobileDroneCreatePreferences } from '../drones/create-preferences-storage';
import type {
  MobileDroneAgentId,
  MobileDroneCreatePayload,
} from '../drones/NewDroneScreen';
import type { MobileDroneSummary } from '../drones/drone-sidebar-model';
import { useMobileCompanion, type MobileCompanionWorkspaceTarget } from './MobileCompanionContext';

type CreatedDrone = { droneId: string; droneName: string };

type CreateDrone = (
  payload: MobileDroneCreatePayload,
  preferences: MobileDroneCreatePreferences,
) => Promise<CreatedDrone | null>;
const MOBILE_COMPANION_COMPOSER_MAX_CHARS = 32_000;

export function useMobileCompanionWorkspaceTarget({
  targetDeviceId,
  targetName,
  targetReachable,
  phoneTarget,
  drones,
  selectedDrone,
  composerAvailable,
  workspaceVisible,
  chatName,
  prompt,
  setPrompt,
  openFile,
  createDrone,
  requestDroneControl,
  openChat,
}: {
  targetDeviceId: string;
  targetName: string;
  targetReachable: boolean;
  phoneTarget: boolean;
  drones: MobileDroneSummary[];
  selectedDrone: MobileDroneSummary | null;
  composerAvailable: boolean;
  workspaceVisible: boolean;
  chatName: string;
  prompt: string;
  setPrompt(value: string): void;
  openFile: { visible: boolean; path: string; kind: string };
  createDrone: CreateDrone;
  requestDroneControl: DroneControlRequest;
  openChat(drone: MobileDroneSummary, chatName: string): Promise<void>;
}): string[] {
  const companion = useMobileCompanion();
  const [highlightedDroneIds, setHighlightedDroneIds] = React.useState<string[]>([]);
  const highlightTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerRef = React.useRef({ key: '', content: '', revision: 0 });
  const implementationRef = React.useRef<Omit<
    MobileCompanionWorkspaceTarget,
    'targetDeviceId' | 'targetName' | 'reachable'
  > | null>(null);
  const composerKey = `${targetDeviceId}:${selectedDrone?.id ?? ''}:${chatName}`;

  if (composerRef.current.key !== composerKey || composerRef.current.content !== prompt) {
    composerRef.current = {
      key: composerKey,
      content: prompt,
      revision: composerRef.current.revision + 1,
    };
  }

  React.useEffect(
    () => () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    },
    [],
  );

  React.useEffect(() => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = null;
    setHighlightedDroneIds([]);
  }, [targetDeviceId]);

  implementationRef.current = {
    getAppContext: () => ({
      surface: 'mobile',
      activeRepoPath: selectedDrone?.repoPath || null,
      targetDevice: {
        id: targetDeviceId,
        name: targetName,
        reachable: targetReachable,
      },
      pane: !workspaceVisible
        ? 'other'
        : openFile.visible
          ? 'file'
          : selectedDrone
            ? 'chat'
            : 'new-drone',
      selectedDrone: selectedDrone
        ? {
            id: selectedDrone.id,
            name: selectedDrone.name,
            repoPath: selectedDrone.repoPath,
            group: selectedDrone.group ?? '',
            runtime: selectedDrone.runtime,
            chatName,
            chats: selectedDrone.chats,
          }
        : null,
      openFile:
        workspaceVisible && openFile.visible ? { path: openFile.path, kind: openFile.kind } : null,
      composer: {
        available: composerAvailable,
        editable: composerAvailable && targetReachable,
        hasText: Boolean(composerRef.current.content.trim()),
      },
      overview: {
        repositories: new Set(drones.map((drone) => drone.repoPath).filter(Boolean)).size,
        drones: drones.length,
        chats: drones.reduce((total, drone) => total + drone.chats.length, 0),
        repositorylessDrones: drones.filter((drone) => !drone.repoPath).length,
        dronesWithMultipleChats: drones.filter((drone) => drone.chats.length > 1).length,
      },
    }),
    readComposer: () => {
      if (!selectedDrone || !composerAvailable) throw new Error('NO_ACTIVE_COMPOSER');
      return {
        targetId: `composer:${targetDeviceId}:${selectedDrone.id}:${chatName}`,
        path: 'composer.md',
        content: composerRef.current.content,
        revision: String(composerRef.current.revision),
        mode: targetReachable ? ('edit' as const) : ('read-only' as const),
      };
    },
    applyComposer: (targetId, baseRevision, content) => {
      if (!selectedDrone || !composerAvailable || !targetReachable) {
        throw new Error('COMPOSER_NOT_EDITABLE');
      }
      if (content.length > MOBILE_COMPANION_COMPOSER_MAX_CHARS) {
        throw new Error('COMPOSER_TOO_LARGE');
      }
      const expectedTargetId = `composer:${targetDeviceId}:${selectedDrone.id}:${chatName}`;
      if (targetId !== expectedTargetId) throw new Error('STALE_COMPOSER_TARGET');
      if (baseRevision !== String(composerRef.current.revision)) {
        throw new Error('STALE_COMPOSER_REVISION');
      }
      composerRef.current = {
        ...composerRef.current,
        content,
        revision: composerRef.current.revision + 1,
      };
      setPrompt(content);
      return { ok: true, revision: String(composerRef.current.revision) };
    },
    executeProposal: async (proposal: CompanionProposal, executionContext) => {
      if (!targetReachable) throw new Error('TARGET_DEVICE_OFFLINE');
      const activeRepoPath = executionContext.defaultRepoPath;
      const proposalRepoPath = (repoPath: string | undefined) => {
        const resolved = repoPath ?? activeRepoPath;
        if (phoneTarget && resolved) {
          throw new Error('Phone-native drones do not support repository-scoped operations.');
        }
        return resolved;
      };
      const proposalAgent = (
        agentKeyRaw: string,
      ): { kind: 'native' } | { kind: 'builtin'; id: Exclude<MobileDroneAgentId, 'native'> } => {
        const agentKey = String(agentKeyRaw ?? '').trim();
        if (agentKey === 'native') return { kind: 'native' as const };
        const builtinId = agentKey.startsWith('builtin:')
          ? agentKey.slice('builtin:'.length)
          : '';
        if (
          builtinId === 'cursor' ||
          builtinId === 'codex' ||
          builtinId === 'claude' ||
          builtinId === 'opencode' ||
          builtinId === 'pi' ||
          builtinId === 'blip'
        ) {
          return {
            kind: 'builtin',
            id: builtinId as Exclude<MobileDroneAgentId, 'native'>,
          };
        }
        throw new Error(`unknown or unsupported mobile agent: ${agentKey || '(empty)'}`);
      };
      const configureChat = async (
        operation: Extract<
          CompanionProposal['operations'][number],
          { type: 'create_chat' }
        >,
      ) => {
        const hasOverrides = Boolean(
          operation.agent ||
          operation.provider ||
          operation.model ||
          operation.reasoning ||
          operation.agentPermissionMode ||
          operation.approvalPolicy,
        );
        if (!hasOverrides) return;
        await requestDroneControl('chat.update', {
          droneId: operation.droneId,
          chatName: operation.chatName,
          ...(operation.agent ? { agent: proposalAgent(operation.agent) } : {}),
          ...(operation.provider ? { provider: operation.provider } : {}),
          ...(operation.model ? { model: operation.model } : {}),
          ...(operation.reasoning ? { reasoning: operation.reasoning } : {}),
          ...(operation.agentPermissionMode
            ? { agentPermissionMode: operation.agentPermissionMode }
            : {}),
          ...(operation.approvalPolicy
            ? { approvalPolicy: operation.approvalPolicy }
            : {}),
          syncNativeThread: true,
        });
      };
      return await executeCompanionProposal(proposal, {
        createGroup: async (operation) =>
          await requestDroneControl('group.create', {
            name: operation.name,
            repoPath: proposalRepoPath(operation.repoPath),
          }),
        deleteGroup: async (operation) =>
          await requestDroneControl('group.delete', {
            groupRef: operation.name,
            repoPath: proposalRepoPath(operation.repoPath),
          }),
        renameGroup: async (operation) =>
          await requestDroneControl('group.rename', {
            groupRef: operation.name,
            newName: operation.newName,
            repoPath: proposalRepoPath(operation.repoPath),
          }),
        createDrone: async (operation) => {
          const repoPath = proposalRepoPath(operation.repoPath);
          const remembered = await loadMobileDroneCreatePreferences(targetDeviceId, repoPath);
          const runtime =
            operation.runtime ?? (phoneTarget ? 'host' : (remembered?.runtime ?? 'container'));
          if (phoneTarget && runtime !== 'host') {
            throw new Error('Phone-native drones only support the host runtime.');
          }
          if (
            runtime === 'host' &&
            (operation.persistVolume !== undefined ||
              operation.repoBranchSource === 'remote' ||
              operation.remoteBranch)
          ) {
            throw new Error('Volume and remote branch overrides require a container drone.');
          }
          const defaultAgentKey = phoneTarget
            ? 'native'
            : `builtin:${remembered?.agent ?? 'native'}`.replace('builtin:native', 'native');
          const requestedAgent = proposalAgent(operation.agent ?? defaultAgentKey);
          if (phoneTarget && requestedAgent.kind !== 'native') {
            throw new Error('Phone-native drones only support the native agent.');
          }
          const agent = requestedAgent.kind === 'native' ? 'native' : requestedAgent.id;
          if (operation.provider && agent !== 'native') {
            throw new Error('provider overrides require the native agent');
          }
          const branchSource =
            runtime === 'host'
              ? 'host'
              : (operation.repoBranchSource ??
                (operation.remoteBranch ? 'remote' : undefined) ??
                remembered?.repoBranchSource ??
                'host');
          const remoteBranch = operation.remoteBranch ?? remembered?.repoCreateRemoteBranch ?? '';
          if (repoPath && branchSource === 'remote' && !remoteBranch) {
            throw new Error('A remote branch is required when repoBranchSource is remote.');
          }
          const payload: MobileDroneCreatePayload = {
            runtime,
            ...(operation.draft === true ? { draft: true } : {}),
            ...(operation.name ? { name: operation.name } : {}),
            ...(operation.group ? { group: operation.group } : {}),
            ...(runtime === 'container'
              ? { persistVolume: operation.persistVolume ?? remembered?.persistVolume ?? false }
              : {}),
            ...(repoPath ? { repoPath } : {}),
            repoBranchSource: branchSource,
            ...(branchSource === 'remote' && remoteBranch
              ? { remoteBranch }
              : {}),
            seedAgent: agent === 'native' ? { kind: 'native' } : { kind: 'builtin', id: agent },
            ...(operation.provider ?? remembered?.provider
              ? { seedProvider: operation.provider ?? remembered?.provider }
              : {}),
            ...(operation.model ?? remembered?.model
              ? { seedModel: operation.model ?? remembered?.model }
              : {}),
            ...(operation.reasoning ?? remembered?.reasoning
              ? { seedReasoning: operation.reasoning ?? remembered?.reasoning }
              : {}),
            ...((operation.agentPermissionMode ?? remembered?.agentPermissionMode) &&
            (operation.agentPermissionMode ?? remembered?.agentPermissionMode) !== 'execute'
              ? {
                  seedAgentPermissionMode:
                    operation.agentPermissionMode ?? remembered?.agentPermissionMode,
                }
              : {}),
            ...((operation.approvalPolicy ?? remembered?.approvalPolicy) &&
            (operation.approvalPolicy ?? remembered?.approvalPolicy) !== 'ask'
              ? { seedApprovalPolicy: operation.approvalPolicy ?? remembered?.approvalPolicy }
              : {}),
            seedPrompt: operation.prompt,
            seedSubmittedAt: new Date().toISOString(),
            ...(!operation.name ? { autoRename: true } : {}),
          };
          const preferences = remembered ?? mobileDroneCreatePreferencesFromPayload({
            runtime: phoneTarget ? 'host' : 'container',
            repoBranchSource: 'host',
            seedAgent: { kind: 'native' },
          });
          const created = await createDrone(payload, preferences);
          if (!created?.droneId) throw new Error('DRONE_NOT_CREATED');
          return created;
        },
        cloneDrone: async (operation) => {
          const source = drones.find((drone) => drone.id === operation.sourceDroneId);
          if (!source) throw new Error(`unknown source drone: ${operation.sourceDroneId}`);
          if (source.runtime.trim().toLowerCase() === 'host') {
            throw new Error('Host runtime drones cannot be cloned.');
          }
          const repoPath = proposalRepoPath(
            operation.repoPath ?? (source.repoAttached === false ? '' : source.repoPath),
          );
          const result: any = await requestDroneControl('drone.create.container', {
            name: operation.name,
            group: operation.group === undefined ? source.group : operation.group,
            repoPath,
            persistVolume: source.persistVolume !== false,
            cloneFrom: source.id,
            cloneChats: operation.cloneChats !== false,
          });
          const droneId = String(result?.id ?? result?.droneId ?? result?.drone?.id ?? '').trim();
          if (!droneId) throw new Error('clone drone did not return an id');
          return {
            droneId,
            droneName: String(result?.name ?? result?.drone?.name ?? operation.name).trim(),
          };
        },
        deleteDrone: async (operation) =>
          await requestDroneControl('drone.delete', { droneId: operation.droneId }),
        renameDrone: async (operation) =>
          await requestDroneControl('drone.rename', {
            droneId: operation.droneId,
            newName: operation.newName,
          }),
        createChat: async (operation) => {
          const created = await requestDroneControl('chat.create', {
            droneId: operation.droneId,
            name: operation.chatName,
            ...(operation.copyFromChat ? { copyFrom: operation.copyFromChat } : {}),
            ...(operation.copyFromChat ? { mode: 'copy-config' } : {}),
            ...(operation.draft === true ? { draft: true } : {}),
          });
          await configureChat(operation);
          return created as Record<string, unknown>;
        },
        cloneChat: async (operation) =>
          await requestDroneControl('chat.create', {
            droneId: operation.droneId,
            name: operation.chatName,
            copyFrom: operation.sourceChat,
            mode: 'fork',
            ...(operation.draft === true ? { draft: true } : {}),
          }),
        deleteChat: async (operation) =>
          await requestDroneControl('chat.delete', {
            droneId: operation.droneId,
            chatName: operation.chatName,
          }),
        renameChat: async (operation) =>
          await requestDroneControl('chat.rename', {
            droneId: operation.droneId,
            chatName: operation.chatName,
            newName: operation.newName,
          }),
        sendMessage: async (operation) =>
          await requestDroneControl('chat.prompt', {
            droneId: operation.droneId,
            chatName: operation.chatName ?? 'default',
            prompt: operation.message,
            deliveryMode: operation.delivery ?? 'queue',
            submittedAt: new Date().toISOString(),
          }),
      });
    },
    openDroneChat: async (args) => {
      if (!targetReachable) throw new Error('TARGET_DEVICE_OFFLINE');
      const droneId = String(args.droneId ?? '').trim();
      const drone = drones.find((candidate) => candidate.id === droneId);
      if (!drone) throw new Error(`unknown drone: ${droneId || '(empty)'}`);
      const requestedChatName = String(args.chatName ?? '').trim();
      const chatName = resolveCompanionChatName(drone.chats, requestedChatName);
      if (!chatName) throw new Error(`unknown chat: ${droneId}/${requestedChatName || '(none)'}`);
      await openChat(drone, chatName);
      const droneName = String(drone.name ?? '').trim() || droneId;
      const repoPath = String(drone.repoPath ?? '').trim();
      return { ok: true, droneId, droneName, repoPath: repoPath || null, chatName };
    },
    highlightDrones: (args) => {
      const requested = Array.isArray(args.droneIds)
        ? [...new Set(args.droneIds.map((value) => String(value ?? '').trim()).filter(Boolean))]
        : [];
      const knownIds = new Set(drones.map((drone) => drone.id));
      const highlighted = requested.filter((droneId) => knownIds.has(droneId));
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      setHighlightedDroneIds(highlighted);
      const durationMs = Math.max(1_000, Math.min(30_000, Number(args.durationMs) || 6_000));
      highlightTimerRef.current = setTimeout(() => {
        highlightTimerRef.current = null;
        setHighlightedDroneIds([]);
      }, durationMs);
      return {
        ok: true,
        highlightedDroneIds: highlighted,
        missingDroneIds: requested.filter((droneId) => !knownIds.has(droneId)),
        durationMs,
      };
    },
  };

  React.useEffect(() => {
    const target: MobileCompanionWorkspaceTarget = {
      targetDeviceId,
      targetName,
      reachable: targetReachable,
      getAppContext: () => implementationRef.current!.getAppContext(),
      readComposer: () => implementationRef.current!.readComposer(),
      applyComposer: (...args) => implementationRef.current!.applyComposer(...args),
      executeProposal: (proposal, context) =>
        implementationRef.current!.executeProposal(proposal, context),
      openDroneChat: (args) => implementationRef.current!.openDroneChat(args),
      highlightDrones: (args) => implementationRef.current!.highlightDrones(args),
    };
    return companion.registerWorkspaceTarget(target);
  }, [companion.registerWorkspaceTarget, targetDeviceId, targetName, targetReachable]);

  return highlightedDroneIds;
}
