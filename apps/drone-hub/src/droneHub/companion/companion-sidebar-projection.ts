import type {
  CompanionProposal,
  CompanionProposalExecution,
  CompanionProposalExecutionProgress,
} from '@drone/assistant-chat';

import type { DroneSummary } from '../types';
import type { SidebarGroup } from '../app/use-sidebar-view-model';

export const COMPANION_PROPOSAL_DRONE_ID_PREFIX = '__companion-proposal-drone__:';

export type CompanionSidebarProjectionMark = {
  operationId: string;
  action: 'create' | 'clone' | 'rename' | 'delete';
  label: string;
  previousLabel?: string;
  active: boolean;
};

export type CompanionSidebarProjectionMarks = {
  groups: Record<string, CompanionSidebarProjectionMark>;
  drones: Record<string, CompanionSidebarProjectionMark>;
  chats: Record<string, CompanionSidebarProjectionMark>;
};

export type CompanionSidebarProjection = {
  sidebarDrones: DroneSummary[];
  sidebarGroups: SidebarGroup[];
  repoScopedGroupPathsByRepoGroup: Record<string, string[]>;
  sidebarGroupCreatedAtByName: Record<string, string | null>;
  marks: CompanionSidebarProjectionMarks;
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function repoGroupPath(repoPathRaw: string): string {
  const repoPath = text(repoPathRaw);
  return repoPath ? `repo:${repoPath}` : 'repo:ungrouped';
}

function repoLabel(repoPathRaw: string): string {
  const repoPath = text(repoPathRaw);
  if (!repoPath) return 'Ungrouped';
  const parts = repoPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || repoPath;
}

function groupBaseName(groupRaw: unknown): string {
  const group = text(groupRaw);
  const parts = group.split('/').filter(Boolean);
  return parts[parts.length - 1] || group;
}

function normalizedGroup(groupRaw: unknown): string {
  return text(groupRaw) || 'Ungrouped';
}

function groupPathPrefixes(groupRaw: unknown): string[] {
  const group = text(groupRaw);
  if (!group || group === 'Ungrouped') return [];
  const parts = group
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

export function companionSidebarChatProjectionKey(droneIdRaw: string, chatNameRaw: string): string {
  return `${text(droneIdRaw)}\u0000${text(chatNameRaw) || 'default'}`;
}

export function companionSidebarGroupProjectionKey(
  groupPathRaw: string,
  repoGroupPathRaw?: string | null,
): string {
  return `${text(repoGroupPathRaw)}\u0000${text(groupPathRaw)}`;
}

function operationMark(
  operationId: string,
  action: CompanionSidebarProjectionMark['action'],
  label: string,
  activeOperationId: string | null,
  previousLabel?: string,
): CompanionSidebarProjectionMark {
  return {
    operationId,
    action,
    label,
    ...(previousLabel ? { previousLabel } : {}),
    active: activeOperationId === operationId,
  };
}

function emptyMarks(): CompanionSidebarProjectionMarks {
  return { groups: {}, drones: {}, chats: {} };
}

export function buildCompanionSidebarProjection({
  proposal,
  execution,
  progress,
  defaultRepoPath,
  sidebarDrones,
  allDrones,
  sidebarGroups,
  repoScopedGroupPathsByRepoGroup,
  sidebarGroupCreatedAtByName,
  sidebarGroupingMode,
}: {
  proposal: CompanionProposal | null;
  execution: CompanionProposalExecution | null;
  progress?: CompanionProposalExecutionProgress | null;
  defaultRepoPath: string | null;
  sidebarDrones: readonly DroneSummary[];
  allDrones: readonly DroneSummary[];
  sidebarGroups: readonly SidebarGroup[];
  repoScopedGroupPathsByRepoGroup: Readonly<Record<string, string[]>>;
  sidebarGroupCreatedAtByName: Readonly<Record<string, string | null>>;
  sidebarGroupingMode: 'groups' | 'repos';
}): CompanionSidebarProjection {
  if (!proposal || execution) {
    return {
      sidebarDrones: sidebarDrones.slice(),
      sidebarGroups: sidebarGroups.slice(),
      repoScopedGroupPathsByRepoGroup: { ...repoScopedGroupPathsByRepoGroup },
      sidebarGroupCreatedAtByName: { ...sidebarGroupCreatedAtByName },
      marks: emptyMarks(),
    };
  }

  const completedById = new Map(
    (progress?.operations ?? [])
      .filter((operation) => operation.status === 'completed')
      .map((operation) => [operation.id, operation]),
  );
  const activeOperationId = progress?.activeOperationId ?? null;
  const marks = emptyMarks();
  const knownDroneById = new Map(allDrones.map((drone) => [text(drone.id), drone] as const));
  const droneById = new Map(sidebarDrones.map((drone) => [text(drone.id), drone] as const));
  const outputDroneIds = sidebarDrones.map((drone) => text(drone.id));
  const proposedDroneIdByOperationId = new Map<string, string>();
  const createdDroneIds = new Set<string>();
  const createdGroupPathsByRepoGroup = new Map<string, Set<string>>();
  const existingDroneGroupPathsByRepoGroup = new Map<string, Set<string>>();
  for (const drone of allDrones) {
    const repoGroup = repoGroupPath(text(drone.repoPath));
    const paths = existingDroneGroupPathsByRepoGroup.get(repoGroup) ?? new Set<string>();
    for (const prefix of groupPathPrefixes(drone.group)) paths.add(prefix);
    existingDroneGroupPathsByRepoGroup.set(repoGroup, paths);
  }
  const existingStandaloneGroupPaths = new Set(
    sidebarGroups
      .filter((group) => group.kind === 'group')
      .flatMap((group) => groupPathPrefixes(group.group)),
  );
  const createdStandaloneGroupPaths = new Set<string>();
  const renderedRepoGroupPaths = Object.fromEntries(
    Object.entries(repoScopedGroupPathsByRepoGroup).map(([key, paths]) => [key, [...paths]]),
  );
  const renderedGroupCreatedAtByName = { ...sidebarGroupCreatedAtByName };
  const projectionCreatedAt = new Date().toISOString();

  const resolvedRepoPath = (repoPath: string | undefined): string =>
    text(repoPath ?? defaultRepoPath);
  const resolveDroneId = (droneIdRaw: string): string => {
    const droneId = text(droneIdRaw);
    if (!droneId.startsWith('$')) return droneId;
    return proposedDroneIdByOperationId.get(droneId.slice(1)) || droneId;
  };
  const replaceDrone = (drone: DroneSummary) => {
    const droneId = text(drone.id);
    if (!droneId) return;
    droneById.set(droneId, drone);
    if (!outputDroneIds.includes(droneId)) outputDroneIds.push(droneId);
  };
  const addRepoScopedGroupPath = (repoPath: string, groupPath: string) => {
    const normalized = text(groupPath);
    if (!normalized || normalized === 'Ungrouped') return;
    const repoGroup = repoGroupPath(repoPath);
    const paths = (renderedRepoGroupPaths[repoGroup] ??= []);
    if (!paths.includes(normalized)) paths.push(normalized);
  };
  const markCreatedGroup = (operationId: string, repoPath: string, groupPath: string) => {
    const repoGroup = repoGroupPath(repoPath);
    const existing = new Set([
      ...(renderedRepoGroupPaths[repoGroup] ?? []).flatMap((path) => groupPathPrefixes(path)),
      ...(existingDroneGroupPathsByRepoGroup.get(repoGroup) ?? []),
    ]);
    const created = createdGroupPathsByRepoGroup.get(repoGroup) ?? new Set<string>();
    for (const prefix of groupPathPrefixes(groupPath)) {
      if (!existing.has(prefix) && !created.has(prefix)) {
        marks.groups[companionSidebarGroupProjectionKey(prefix, repoGroup)] = operationMark(
          operationId,
          'create',
          groupBaseName(prefix),
          activeOperationId,
        );
        created.add(prefix);
        renderedGroupCreatedAtByName[prefix] ??= projectionCreatedAt;
      }
      addRepoScopedGroupPath(repoPath, prefix);
    }
    createdGroupPathsByRepoGroup.set(repoGroup, created);
  };
  const markCreatedStandaloneGroup = (operationId: string, groupPath: string) => {
    for (const prefix of groupPathPrefixes(groupPath)) {
      if (existingStandaloneGroupPaths.has(prefix) || createdStandaloneGroupPaths.has(prefix)) {
        continue;
      }
      marks.groups[companionSidebarGroupProjectionKey(prefix)] = operationMark(
        operationId,
        'create',
        groupBaseName(prefix),
        activeOperationId,
      );
      createdStandaloneGroupPaths.add(prefix);
      renderedGroupCreatedAtByName[prefix] ??= projectionCreatedAt;
    }
  };

  for (const operation of proposal.operations) {
    const completed = completedById.get(operation.id);
    if (completed) {
      if (operation.type === 'create_drone' || operation.type === 'clone_drone') {
        const createdId = text(completed.result?.droneId ?? completed.result?.id);
        if (createdId) proposedDroneIdByOperationId.set(operation.id, createdId);
      }
      continue;
    }

    switch (operation.type) {
      case 'create_group': {
        const repoPath = resolvedRepoPath(operation.repoPath);
        const group = normalizedGroup(operation.name);
        if (sidebarGroupingMode === 'repos') {
          markCreatedGroup(operation.id, repoPath, group);
        } else {
          markCreatedStandaloneGroup(operation.id, group);
        }
        break;
      }
      case 'delete_group':
      case 'rename_group': {
        const repoPath = resolvedRepoPath(operation.repoPath);
        const repoGroup = sidebarGroupingMode === 'repos' ? repoGroupPath(repoPath) : '';
        const group = normalizedGroup(operation.name);
        marks.groups[companionSidebarGroupProjectionKey(group, repoGroup)] = operationMark(
          operation.id,
          operation.type === 'delete_group' ? 'delete' : 'rename',
          operation.type === 'rename_group'
            ? groupBaseName(operation.newName)
            : groupBaseName(group),
          activeOperationId,
          operation.type === 'rename_group' ? groupBaseName(group) : undefined,
        );
        break;
      }
      case 'create_drone':
      case 'clone_drone': {
        const source =
          operation.type === 'clone_drone'
            ? knownDroneById.get(resolveDroneId(operation.sourceDroneId))
            : undefined;
        const repoPath = resolvedRepoPath(operation.repoPath ?? source?.repoPath);
        const group = normalizedGroup(
          operation.group === undefined ? source?.group : operation.group,
        );
        const droneId = `${COMPANION_PROPOSAL_DRONE_ID_PREFIX}${operation.id}`;
        const name = text(operation.name) || 'New drone';
        const sourceChats = Array.isArray(source?.chats)
          ? source.chats.map(text).filter(Boolean)
          : [];
        const chats =
          operation.type === 'clone_drone' &&
          operation.cloneChats !== false &&
          sourceChats.length > 0
            ? sourceChats
            : ['default'];
        const projectedDrone: DroneSummary = {
          id: droneId,
          name,
          group: group === 'Ungrouped' ? null : group,
          createdAt: new Date().toISOString(),
          runtime:
            operation.type === 'create_drone'
              ? (operation.runtime ?? 'container')
              : (source?.runtime ?? 'container'),
          repoAttached: Boolean(repoPath),
          repoPath,
          containerPort: 0,
          hostPort: null,
          statusOk: true,
          statusError: null,
          chats,
          draft: operation.type === 'create_drone' && operation.draft === true,
          hubPhase: null,
          hubMessage: 'Proposed',
          busy: false,
        };
        proposedDroneIdByOperationId.set(operation.id, droneId);
        createdDroneIds.add(droneId);
        replaceDrone(projectedDrone);
        marks.drones[droneId] = operationMark(
          operation.id,
          operation.type === 'clone_drone' ? 'clone' : 'create',
          name,
          activeOperationId,
        );
        if (sidebarGroupingMode === 'repos') {
          markCreatedGroup(operation.id, repoPath, group);
        } else {
          markCreatedStandaloneGroup(operation.id, group);
        }
        break;
      }
      case 'delete_drone':
      case 'rename_drone': {
        const droneId = resolveDroneId(operation.droneId);
        const drone = droneById.get(droneId) ?? knownDroneById.get(droneId);
        if (!drone || !droneById.has(droneId)) break;
        const previousLabel = text(drone.name) || droneId;
        const label = operation.type === 'rename_drone' ? operation.newName : previousLabel;
        marks.drones[droneId] = operationMark(
          operation.id,
          operation.type === 'delete_drone' ? 'delete' : 'rename',
          label,
          activeOperationId,
          operation.type === 'rename_drone' ? previousLabel : undefined,
        );
        break;
      }
      case 'create_chat':
      case 'clone_chat': {
        const droneId = resolveDroneId(operation.droneId);
        const drone = droneById.get(droneId);
        if (!drone) break;
        const chatName = operation.chatName;
        const chats = Array.from(
          new Set([...(drone.chats ?? []).map(text), chatName].filter(Boolean)),
        );
        replaceDrone({ ...drone, chats });
        marks.chats[companionSidebarChatProjectionKey(droneId, chatName)] = operationMark(
          operation.id,
          operation.type === 'clone_chat' ? 'clone' : 'create',
          chatName,
          activeOperationId,
        );
        break;
      }
      case 'delete_chat':
      case 'rename_chat': {
        const droneId = resolveDroneId(operation.droneId);
        if (!droneById.has(droneId)) break;
        marks.chats[companionSidebarChatProjectionKey(droneId, operation.chatName)] = operationMark(
          operation.id,
          operation.type === 'delete_chat' ? 'delete' : 'rename',
          operation.type === 'rename_chat' ? operation.newName : operation.chatName,
          activeOperationId,
          operation.type === 'rename_chat' ? operation.chatName : undefined,
        );
        break;
      }
      case 'send_message':
        break;
    }
  }

  const projectedDrones = outputDroneIds
    .map((droneId) => droneById.get(droneId))
    .filter((drone): drone is DroneSummary => Boolean(drone));
  const projectedDroneById = new Map(projectedDrones.map((drone) => [text(drone.id), drone]));
  const projectedGroups = sidebarGroups.map((group) => ({
    ...group,
    items: group.items.map((drone) => projectedDroneById.get(text(drone.id)) ?? drone),
  }));

  for (const droneId of createdDroneIds) {
    const drone = projectedDroneById.get(droneId);
    if (!drone) continue;
    const groupName =
      sidebarGroupingMode === 'repos'
        ? repoGroupPath(text(drone.repoPath))
        : normalizedGroup(drone.group);
    let group = projectedGroups.find((candidate) => candidate.group === groupName);
    if (!group) {
      group =
        sidebarGroupingMode === 'repos'
          ? {
              group: groupName,
              label: repoLabel(text(drone.repoPath)),
              kind: 'repo',
              items: [],
            }
          : { group: groupName, label: groupName, kind: 'group', items: [] };
      projectedGroups.push(group);
    }
    if (!group.items.some((item) => text(item.id) === droneId)) group.items.push(drone);
    if (sidebarGroupingMode === 'repos') {
      addRepoScopedGroupPath(text(drone.repoPath), normalizedGroup(drone.group));
    }
  }

  if (sidebarGroupingMode === 'groups') {
    for (const operation of proposal.operations) {
      if (operation.type !== 'create_group' || completedById.has(operation.id)) continue;
      const groupName = normalizedGroup(operation.name);
      if (!projectedGroups.some((group) => group.group === groupName)) {
        projectedGroups.push({ group: groupName, label: groupName, kind: 'group', items: [] });
      }
    }
  }

  return {
    sidebarDrones: projectedDrones,
    sidebarGroups: projectedGroups,
    repoScopedGroupPathsByRepoGroup: renderedRepoGroupPaths,
    sidebarGroupCreatedAtByName: renderedGroupCreatedAtByName,
    marks,
  };
}
