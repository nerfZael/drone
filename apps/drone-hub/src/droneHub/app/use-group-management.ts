import React from 'react';
import type { SidebarCommandQueue } from '@drone/hub-model/sidebar';
import { requestJson } from '../http';
import type { DroneSummary } from '../types';
import { isUngroupedGroupName } from '../../domain';
import { useAppConfirmDialog } from '../../ui/AppConfirmDialog';
import { isNotFoundError } from './hooks';
import {
  buildSidebarGroupDeleteConfirmation,
  buildSidebarGroupDronesDeleteConfirmation,
} from './sidebar-group-delete-confirmation';
import {
  renameSidebarEntryOrderMapKeysByPrefix,
  renameSidebarGroupTokenListByPrefix,
} from './sidebar-group-order';
import {
  removeSidebarNodeOrderByParentGroupPrefix,
  renameSidebarRepoScopedNodeOrderByGroupPrefix,
  renameSidebarNodeOrderByParentGroupPrefix,
} from './sidebar-node-order';
import {
  isSameOrDescendantSidebarGroupPath,
} from './sidebar-group-paths';
import {
  removeCollapsedGroupKeysByPrefix,
  renameCollapsedGroupKeysByPrefix,
} from './sidebar-collapsed-groups';
import {
  hasSidebarRepoPathScope,
  sidebarGroupMutationKey,
  sidebarRepoGroupPathFromRepoPath,
  sidebarRepoScopedGroupPath,
} from './sidebar-repository-scope';
import {
  selectedGroupMultiChatTargetsGroup,
  renameSelectedGroupMultiChatGroup,
} from './sidebar-group-multi-chat';
import { sidebarGroupDroneIds } from './sidebar-group-drone-targets';

type UseGroupManagementArgs = {
  sidebarCommandQueue: SidebarCommandQueue;
  activeRepoPath: string;
  groupIdByName: Record<string, string>;
  drones: DroneSummary[];
  polledDrones: DroneSummary[];
  optimisticallyDeletedDrones: Record<string, boolean>;
  setOptimisticallyDeletedDrones: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setCollapsedGroups: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setSidebarGroupOrder: React.Dispatch<React.SetStateAction<string[]>>;
  setSidebarDroneOrderByGroup: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  setSidebarNodeOrderByParent: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  setHiddenSidebarGroups: React.Dispatch<React.SetStateAction<string[]>>;
  selectedGroupMultiChat: string | null;
  setSelectedGroupMultiChat: React.Dispatch<React.SetStateAction<string | null>>;
  onDronesDeleted: (droneIds: string[]) => void;
};

type DeleteGroupDronesResponse = {
  ok: boolean;
  removed?: Array<{ id?: string; name?: string }>;
  errors?: Array<{ id?: string; name?: string; error?: string }>;
};

export type MoveDronesToGroupResult = {
  ok: boolean;
  error: string | null;
  groupCreated?: boolean;
};

export type GroupMutationScope = {
  groupId?: string | null;
  repoPath?: string | null;
};

export type DeleteGroupOptions = GroupMutationScope & {
  kind?: 'group' | 'repo';
  label?: string;
};

export type DeleteDronesInGroupOptions = GroupMutationScope & {
  label?: string;
};

export function useGroupManagement({
  sidebarCommandQueue,
  activeRepoPath,
  groupIdByName,
  drones,
  polledDrones,
  optimisticallyDeletedDrones,
  setOptimisticallyDeletedDrones,
  setCollapsedGroups,
  setSidebarGroupOrder,
  setSidebarDroneOrderByGroup,
  setSidebarNodeOrderByParent,
  setHiddenSidebarGroups,
  selectedGroupMultiChat,
  setSelectedGroupMultiChat,
  onDronesDeleted,
}: UseGroupManagementArgs) {
  const [groupMoveError, setGroupMoveError] = React.useState<string | null>(null);
  const [pendingGroupMoveCount, setPendingGroupMoveCount] = React.useState(0);
  const movingDroneGroups = pendingGroupMoveCount > 0;
  const [deletingGroups, setDeletingGroups] = React.useState<Record<string, boolean>>({});
  const [renamingGroups, setRenamingGroups] = React.useState<Record<string, boolean>>({});
  const confirmDelete = useAppConfirmDialog();

  const renameGroup = React.useCallback(
    async (
      groupRaw: string,
      nextNameRaw?: string,
      scope?: GroupMutationScope,
    ): Promise<boolean> => {
      const group = String(groupRaw ?? '').trim();
      if (!group) return false;
      if (isUngroupedGroupName(group)) return false;
      const repoPath = resolveScopedRepoPath(activeRepoPath, scope);
      const repoScoped = hasSidebarRepoPathScope(scope);
      const repoGroupPath = repoScoped
        ? sidebarRepoGroupPathFromRepoPath(repoPath)
        : null;
      const mutationKey = sidebarGroupMutationKey(group, repoGroupPath);
      if (renamingGroups[mutationKey]) return false;

      const next = typeof nextNameRaw === 'string' ? nextNameRaw : window.prompt(`Rename group "${group}" to:`, group);
      const newName = String(next ?? '').trim();
      if (!newName) return false;
      if (newName === group) return false;
      if (isUngroupedGroupName(newName)) {
        window.alert('"Ungrouped" is reserved.');
        return false;
      }

      const groupId = String(scope?.groupId ?? groupIdByName[group] ?? '').trim();
      setRenamingGroups((prev) => ({ ...prev, [mutationKey]: true }));
      try {
        await requestJson<{ ok: true; id: string; oldName: string; newName: string; renamed: boolean }>(
          `/api/groups/${encodeURIComponent(groupId || group)}/rename`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ newName, repoPath }),
          },
        );

        // Keep per-group UI state aligned after rename.
        const currentCollapsePath = repoGroupPath
          ? sidebarRepoScopedGroupPath(repoGroupPath, group)
          : group;
        const nextCollapsePath = repoGroupPath
          ? sidebarRepoScopedGroupPath(repoGroupPath, newName)
          : newName;
        setCollapsedGroups((prev) =>
          renameCollapsedGroupKeysByPrefix(prev, currentCollapsePath, nextCollapsePath),
        );
        if (!repoScoped) {
          setSidebarGroupOrder((prev) =>
            renameSidebarGroupTokenListByPrefix(
              prev,
              { group, kind: 'group' },
              { group: newName, kind: 'group' },
            ),
          );
          setHiddenSidebarGroups((prev) =>
            renameSidebarGroupTokenListByPrefix(
              prev,
              { group, kind: 'group' },
              { group: newName, kind: 'group' },
            ),
          );
          setSidebarDroneOrderByGroup((prev) =>
            renameSidebarEntryOrderMapKeysByPrefix(
              prev,
              { group, kind: 'group' },
              { group: newName, kind: 'group' },
            ),
          );
        }
        setSidebarNodeOrderByParent((prev) =>
          repoScoped
            ? renameSidebarRepoScopedNodeOrderByGroupPrefix(
                prev,
                sidebarRepoGroupPathFromRepoPath(repoPath),
                group,
                newName,
              )
            : renameSidebarNodeOrderByParentGroupPrefix(prev, group, newName),
        );
        const nextSelectedGroupMultiChat = renameSelectedGroupMultiChatGroup(
          selectedGroupMultiChat,
          group,
          newName,
          repoGroupPath,
        );
        if (nextSelectedGroupMultiChat !== selectedGroupMultiChat) {
          setSelectedGroupMultiChat(nextSelectedGroupMultiChat);
        }
        return true;
      } catch (e: any) {
        const msg = String(e?.message ?? e ?? '').trim();
        console.error('[DroneHub] rename group failed', { group, newName, error: e });
        window.alert(msg || 'Rename failed.');
        return false;
      } finally {
        setRenamingGroups((prev) => {
          if (!prev[mutationKey]) return prev;
          const nextMap = { ...prev };
          delete nextMap[mutationKey];
          return nextMap;
        });
      }
    },
    [
      groupIdByName,
      activeRepoPath,
      renamingGroups,
      selectedGroupMultiChat,
      setCollapsedGroups,
      setHiddenSidebarGroups,
      setSelectedGroupMultiChat,
      setSidebarDroneOrderByGroup,
      setSidebarGroupOrder,
      setSidebarNodeOrderByParent,
    ],
  );

  const deleteGroup = React.useCallback(
    async (groupRaw: string, countHint?: number, opts?: DeleteGroupOptions): Promise<boolean> => {
      const group = String(groupRaw ?? '').trim();
      const targetKind = opts?.kind === 'repo' ? 'repo' : 'group';
      const groupLabel = String(opts?.label ?? group).trim() || group;
      const targetRepoPath = targetKind === 'repo' ? String(opts?.repoPath ?? '').trim() : '';
      const scopedRepoPath =
        targetKind === 'group'
          ? resolveScopedRepoPath(activeRepoPath, opts)
          : '';
      const repoScoped = targetKind === 'group' && hasSidebarRepoPathScope(opts);
      const repoGroupPath = repoScoped
        ? sidebarRepoGroupPathFromRepoPath(scopedRepoPath)
        : null;
      const mutationKey = sidebarGroupMutationKey(group, repoGroupPath);
      if (!group || deletingGroups[mutationKey]) return false;
      const targetGroupId = String(opts?.groupId ?? groupIdByName[group] ?? '').trim();
      const ok = await confirmDelete(buildSidebarGroupDeleteConfirmation({
        kind: targetKind,
        label: groupLabel,
        countHint,
        repoPath: targetKind === 'repo' ? targetRepoPath : scopedRepoPath,
      }));
      if (!ok) return false;
      const wantsUngroupedGroup = targetKind === 'group' && isUngroupedGroupName(group);
      const targetNames = Array.from(
        new Set(
          polledDrones
            .filter((d) => {
              if (targetKind === 'repo') {
                const droneRepoPath = String(d?.repoPath ?? '').trim();
                if (targetRepoPath) return droneRepoPath === targetRepoPath;
                return !droneRepoPath;
              }
              if (String(d?.repoPath ?? '').trim() !== scopedRepoPath) return false;
              const droneGroup = String(d?.group ?? '').trim();
              if (wantsUngroupedGroup) return !droneGroup || isUngroupedGroupName(droneGroup);
              return isSameOrDescendantSidebarGroupPath(droneGroup, group);
            })
            .map((d) => String(d?.id ?? '').trim())
            .filter(Boolean),
        ),
      );
      if (targetKind === 'repo' && targetNames.length === 0) return false;
      const preHidden = new Set(
        Object.keys(optimisticallyDeletedDrones).filter((name) => optimisticallyDeletedDrones[name]),
      );
      const addedByThisDelete = targetNames.filter((name) => !preHidden.has(name));
      if (targetNames.length > 0) {
        setOptimisticallyDeletedDrones((prev) => {
          const nextMap = { ...prev };
          let changed = false;
          for (const name of targetNames) {
            if (nextMap[name]) continue;
            nextMap[name] = true;
            changed = true;
          }
          return changed ? nextMap : prev;
        });
      }
      setDeletingGroups((prev) => ({ ...prev, [mutationKey]: true }));
      return await sidebarCommandQueue.enqueue(async () => {
        try {
        if (targetKind === 'repo') {
          const failed: string[] = [];
          for (const id of targetNames) {
            try {
              await requestJson(`/api/drones/${encodeURIComponent(id)}`, { method: 'DELETE' });
            } catch (e: any) {
              console.error('[DroneHub] delete repo-group drone failed', {
                group: groupLabel,
                id,
                error: e,
              });
              failed.push(id);
            }
          }
          if (failed.length > 0) {
            setOptimisticallyDeletedDrones((prev) => {
              const nextMap = { ...prev };
              let changed = false;
              for (const id of failed) {
                if (!nextMap[id]) continue;
                delete nextMap[id];
                changed = true;
              }
              return changed ? nextMap : prev;
            });
            const plural = failed.length === 1 ? '' : 's';
            window.alert(
              failed.length === targetNames.length
                ? `Failed to delete ${failed.length} drone${plural} from "${groupLabel}".`
                : `Deleted ${targetNames.length - failed.length} drone${targetNames.length - failed.length === 1 ? '' : 's'} from "${groupLabel}", but ${failed.length} failed.`,
            );
          }
        } else {
          const query = `?repoPath=${encodeURIComponent(scopedRepoPath)}`;
          await requestJson(`/api/groups/${encodeURIComponent(targetGroupId || group)}${query}`, { method: 'DELETE' });
        }
        if (!repoScoped) {
          const deletedStableTokens = new Set(
            Object.entries(groupIdByName)
              .filter(([name]) => isSameOrDescendantSidebarGroupPath(name, group))
              .map(([, id]) => `group-id:${id}`),
          );
          setCollapsedGroups((prev) => removeCollapsedGroupKeysByPrefix(prev, group));
          setSidebarGroupOrder((prev) => prev.filter((token) =>
            !deletedStableTokens.has(token) &&
            (!token.startsWith('group:') || !isSameOrDescendantSidebarGroupPath(token.slice('group:'.length), group)),
          ));
          setHiddenSidebarGroups((prev) => prev.filter((token) =>
            !deletedStableTokens.has(token) &&
            (!token.startsWith('group:') || !isSameOrDescendantSidebarGroupPath(token.slice('group:'.length), group)),
          ));
          setSidebarDroneOrderByGroup((prev) => {
            let changed = false;
            const nextMap: Record<string, string[]> = {};
            for (const [key, value] of Object.entries(prev)) {
              if (deletedStableTokens.has(key) || (key.startsWith('group:') && isSameOrDescendantSidebarGroupPath(key.slice('group:'.length), group))) {
                changed = true;
                continue;
              }
              nextMap[key] = value;
            }
            return changed ? nextMap : prev;
          });
          setSidebarNodeOrderByParent((prev) => removeSidebarNodeOrderByParentGroupPrefix(prev, group));
        }
        if (selectedGroupMultiChatTargetsGroup(selectedGroupMultiChat, group, repoGroupPath)) {
          setSelectedGroupMultiChat(null);
        }
        return true;
        } catch (e: any) {
        console.error('[DroneHub] delete group failed', { group, error: e });
        if (addedByThisDelete.length > 0) {
          setOptimisticallyDeletedDrones((prev) => {
            const nextMap = { ...prev };
            let changed = false;
            for (const name of addedByThisDelete) {
              if (!nextMap[name]) continue;
              delete nextMap[name];
              changed = true;
            }
            return changed ? nextMap : prev;
          });
        }
        return false;
        } finally {
        setDeletingGroups((prev) => {
          if (!prev[mutationKey]) return prev;
          const nextMap = { ...prev };
          delete nextMap[mutationKey];
          return nextMap;
        });
        }
      });
    },
    [
      deletingGroups,
      activeRepoPath,
      groupIdByName,
      optimisticallyDeletedDrones,
      polledDrones,
      selectedGroupMultiChat,
      setCollapsedGroups,
      setOptimisticallyDeletedDrones,
      setSelectedGroupMultiChat,
      setSidebarDroneOrderByGroup,
      setSidebarNodeOrderByParent,
      setSidebarGroupOrder,
      setHiddenSidebarGroups,
      confirmDelete,
      sidebarCommandQueue,
    ],
  );

  const deleteDronesInGroup = React.useCallback(
    async (groupRaw: string, opts?: DeleteDronesInGroupOptions): Promise<boolean> => {
      const group = String(groupRaw ?? '').trim();
      const groupLabel = String(opts?.label ?? group).trim() || group;
      const scopedRepoPath = resolveScopedRepoPath(activeRepoPath, opts);
      const repoGroupPath = hasSidebarRepoPathScope(opts)
        ? sidebarRepoGroupPathFromRepoPath(scopedRepoPath)
        : null;
      const mutationKey = sidebarGroupMutationKey(group, repoGroupPath);
      if (!group || deletingGroups[mutationKey]) return false;

      const targetIds = sidebarGroupDroneIds(drones, group, scopedRepoPath);
      if (targetIds.length === 0) return false;

      const ok = await confirmDelete(
        buildSidebarGroupDronesDeleteConfirmation({
          label: groupLabel,
          countHint: targetIds.length,
          repoPath: scopedRepoPath,
        }),
      );
      if (!ok) return false;

      const addedByThisDelete = new Set(targetIds.filter((id) => !optimisticallyDeletedDrones[id]));
      setOptimisticallyDeletedDrones((prev) => {
        const nextMap = { ...prev };
        let changed = false;
        for (const id of targetIds) {
          if (nextMap[id]) continue;
          nextMap[id] = true;
          changed = true;
        }
        return changed ? nextMap : prev;
      });
      setDeletingGroups((prev) => ({ ...prev, [mutationKey]: true }));

      return await sidebarCommandQueue.enqueue(async () => {
        try {
          const targetGroupRef = String(opts?.groupId ?? '').trim() || group;
          const query = new URLSearchParams({ repoPath: scopedRepoPath }).toString();
          let response: DeleteGroupDronesResponse;
          try {
            response = await requestJson<DeleteGroupDronesResponse>(
              `/api/groups/${encodeURIComponent(targetGroupRef)}/drones?${query}`,
              { method: 'DELETE' },
            );
          } catch (error: any) {
            const partial = error?.data;
            if (!partial || !Array.isArray(partial.removed)) throw error;
            response = partial as DeleteGroupDronesResponse;
          }

          const removedIds = Array.from(
            new Set(
              (response.removed ?? []).map((item) => String(item?.id ?? '').trim()).filter(Boolean),
            ),
          );
          const removedIdSet = new Set(removedIds);
          const failedTargetIds = targetIds.filter((id) => !removedIdSet.has(id));
          if (removedIds.length > 0) {
            setOptimisticallyDeletedDrones((prev) => {
              const nextMap = { ...prev };
              let changed = false;
              for (const id of removedIds) {
                if (nextMap[id]) continue;
                nextMap[id] = true;
                changed = true;
              }
              return changed ? nextMap : prev;
            });
          }
          if (failedTargetIds.length > 0) {
            setOptimisticallyDeletedDrones((prev) => {
              const nextMap = { ...prev };
              let changed = false;
              for (const id of failedTargetIds) {
                if (!addedByThisDelete.has(id) || !nextMap[id]) continue;
                delete nextMap[id];
                changed = true;
              }
              return changed ? nextMap : prev;
            });
          }
          if (removedIds.length > 0) {
            try {
              onDronesDeleted(removedIds);
            } catch (cleanupError) {
              console.error('[DroneHub] group drone client cleanup failed', {
                group,
                removedIds,
                error: cleanupError,
              });
            }
          }

          const errors = Array.isArray(response.errors) ? response.errors : [];
          if (!response.ok || errors.length > 0) {
            const failedCount = errors.length || failedTargetIds.length;
            const deletedCount = removedIds.length;
            window.alert(
              deletedCount === 0
                ? `Failed to delete ${failedCount} drone${failedCount === 1 ? '' : 's'} from “${groupLabel}”.`
                : `Deleted ${deletedCount} drone${deletedCount === 1 ? '' : 's'} from “${groupLabel}”, but ${failedCount} failed.`,
            );
          }
          return response.ok;
        } catch (error: any) {
          console.error('[DroneHub] delete group drones failed', { group, error });
          setOptimisticallyDeletedDrones((prev) => {
            const nextMap = { ...prev };
            let changed = false;
            for (const id of addedByThisDelete) {
              if (!nextMap[id]) continue;
              delete nextMap[id];
              changed = true;
            }
            return changed ? nextMap : prev;
          });
          window.alert(String(error?.message ?? '').trim() || 'Delete drones failed.');
          return false;
        } finally {
          setDeletingGroups((prev) => {
            if (!prev[mutationKey]) return prev;
            const nextMap = { ...prev };
            delete nextMap[mutationKey];
            return nextMap;
          });
        }
      });
    },
    [
      activeRepoPath,
      confirmDelete,
      deletingGroups,
      drones,
      onDronesDeleted,
      optimisticallyDeletedDrones,
      setOptimisticallyDeletedDrones,
      sidebarCommandQueue,
    ],
  );

  const moveDronesToGroup = React.useCallback(
    async (targetGroupLabel: string, rawDroneNames: string[]) => {
      const target = String(targetGroupLabel ?? '').trim();
      if (!target) return { ok: true, error: null } as MoveDronesToGroupResult;
      const targetGroup = isUngroupedGroupName(target) ? null : target;
      const byId = new Map(drones.map((d) => [d.id, d]));
      const requested = Array.from(new Set(rawDroneNames.map((n) => String(n ?? '').trim()).filter(Boolean)));
      if (requested.length === 0) return { ok: true, error: null } as MoveDronesToGroupResult;

      // The rendered drones may still reflect an earlier server snapshot while
      // optimistic moves are pending. Always submit every known requested drone;
      // filtering against that stale snapshot can incorrectly discard a quick
      // follow-up move back to the original group.
      const movable = requested.filter((id) => byId.has(id));
      if (movable.length === 0) return { ok: true, error: null } as MoveDronesToGroupResult;

      setGroupMoveError(null);
      setPendingGroupMoveCount((count) => count + 1);
      const runMove = async (): Promise<MoveDronesToGroupResult> => {
        setGroupMoveError(null);
        try {
          const scopedGroupId = targetGroup && groupIdByName[targetGroup] &&
            movable.every((id) => String(byId.get(id)?.repoPath ?? '').trim() === String(activeRepoPath ?? '').trim())
            ? groupIdByName[targetGroup]
            : null;
          const resp = await requestJson<{
            ok: true;
            moved: Array<{ id: string; name: string; previousGroup: string | null; group: string | null }>;
            rejected: Array<{ id: string; name: string; error: string }>;
          }>(`/api/drones/group-set`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(
              targetGroup && scopedGroupId
                ? { droneIds: movable, groupId: scopedGroupId }
                : { droneIds: movable, group: targetGroup },
            ),
          });
          const rejected = Array.isArray(resp?.rejected) ? resp.rejected : [];
          if (rejected.length > 0) {
            const msg = rejected
              .slice(0, 3)
              .map((r) => `${String(r?.name ?? r?.id ?? 'unknown')}: ${String(r?.error ?? 'failed')}`)
              .join(', ');
            const errorMessage =
              rejected.length > 3
                ? `Some drones could not be moved (${msg}, +${rejected.length - 3} more).`
                : `Some drones could not be moved (${msg}).`;
            setGroupMoveError(errorMessage);
            return { ok: false, error: errorMessage } as MoveDronesToGroupResult;
          }
          return { ok: true, error: null } as MoveDronesToGroupResult;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          let errorMessage = String(msg ?? 'move failed');
          if (isNotFoundError(e)) {
            errorMessage = 'Hub API is missing group-move support. Restart the hub after rebuilding/updating `drone`.';
            setGroupMoveError(errorMessage);
          } else {
            setGroupMoveError(errorMessage);
          }
          console.error('[DroneHub] move drones between groups failed', {
            targetGroup: targetGroup ?? null,
            drones: movable,
            error: e,
          });
          return { ok: false, error: errorMessage } as MoveDronesToGroupResult;
        }
      };
      try {
        return await runMove();
      } finally {
        setPendingGroupMoveCount((count) => Math.max(0, count - 1));
      }
    },
    [activeRepoPath, drones, groupIdByName],
  );

  const createGroupAndMove = React.useCallback(
    async (targetGroupLabel: string, rawDroneNames: string[]) => {
      const target = String(targetGroupLabel ?? '').trim();
      if (!target) {
        const msg = 'Group name is required.';
        setGroupMoveError(msg);
        return { ok: false, error: msg } as MoveDronesToGroupResult;
      }
      if (isUngroupedGroupName(target)) {
        const msg = '"Ungrouped" is reserved.';
        setGroupMoveError(msg);
        return { ok: false, error: msg } as MoveDronesToGroupResult;
      }
      const requested = Array.from(new Set(rawDroneNames.map((n) => String(n ?? '').trim()).filter(Boolean)));
      if (requested.length === 0) {
        const msg = 'No drones selected for group move.';
        setGroupMoveError(msg);
        return { ok: false, error: msg } as MoveDronesToGroupResult;
      }

      setGroupMoveError(null);
      let groupCreated = false;
      try {
        await requestJson<{ ok: true; name: string; createdAt: string }>(`/api/groups`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: target, repoPath: activeRepoPath }),
        });
        groupCreated = true;
      } catch (e: any) {
        const msg = String(e?.message ?? e ?? '').trim();
        if (!/group already exists/i.test(msg)) {
          setGroupMoveError(msg || 'Create group failed.');
          return { ok: false, error: msg || 'Create group failed.', groupCreated: false } as MoveDronesToGroupResult;
        }
      }

      const result = await moveDronesToGroup(target, requested);
      return { ...result, groupCreated };
    },
    [activeRepoPath, moveDronesToGroup],
  );

  const createGroup = React.useCallback(
    async (targetGroupLabel: string, scope?: Pick<GroupMutationScope, 'repoPath'>) => {
      const target = String(targetGroupLabel ?? '').trim();
      if (!target) {
        const msg = 'Group name is required.';
        setGroupMoveError(msg);
        return { ok: false, error: msg };
      }
      if (isUngroupedGroupName(target)) {
        const msg = '"Ungrouped" is reserved.';
        setGroupMoveError(msg);
        return { ok: false, error: msg };
      }

      setGroupMoveError(null);
      try {
        const repoPath = resolveScopedRepoPath(activeRepoPath, scope);
        await requestJson<{ ok: true; name: string; createdAt: string }>(`/api/groups`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: target, repoPath }),
        });
        return { ok: true, error: null };
      } catch (e: any) {
        const msg = String(e?.message ?? e ?? '').trim();
        if (/group already exists/i.test(msg)) return { ok: true, error: null };
        setGroupMoveError(msg || 'Create group failed.');
        return { ok: false, error: msg || 'Create group failed.' };
      }
    },
    [activeRepoPath],
  );

  return {
    groupMoveError,
    setGroupMoveError,
    movingDroneGroups,
    deletingGroups,
    renamingGroups,
    renameGroup,
    deleteGroup,
    deleteDronesInGroup,
    createGroup,
    moveDronesToGroup,
    createGroupAndMove,
  };
}

function resolveScopedRepoPath(
  activeRepoPath: string,
  scope: Pick<GroupMutationScope, 'repoPath'> | undefined,
): string {
  return String(hasSidebarRepoPathScope(scope) ? scope?.repoPath ?? '' : activeRepoPath ?? '').trim();
}
