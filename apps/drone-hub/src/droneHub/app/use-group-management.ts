import React from 'react';
import { requestJson } from '../http';
import type { DroneSummary } from '../types';
import { isUngroupedGroupName } from '../../domain';
import { useAppConfirmDialog } from '../../ui/AppConfirmDialog';
import { isNotFoundError } from './hooks';
import { buildSidebarGroupDeleteConfirmation } from './sidebar-group-delete-confirmation';
import {
  renameSidebarEntryOrderMapKeysByPrefix,
  renameSidebarGroupTokenListByPrefix,
} from './sidebar-group-order';
import {
  removeSidebarNodeOrderByParentGroupPrefix,
  renameSidebarNodeOrderByParentGroupPrefix,
} from './sidebar-node-order';
import {
  isSameOrDescendantSidebarGroupPath,
  rewriteSidebarGroupPathPrefix,
} from './sidebar-group-paths';
import {
  removeCollapsedGroupKeysByPrefix,
  renameCollapsedGroupKeysByPrefix,
} from './sidebar-collapsed-groups';

type UseGroupManagementArgs = {
  autoDelete: boolean;
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
};

export type MoveDronesToGroupResult = {
  ok: boolean;
  error: string | null;
  groupCreated?: boolean;
};

type DeleteGroupOptions = {
  kind?: 'group' | 'repo';
  label?: string;
  repoPath?: string | null;
};

export function useGroupManagement({
  autoDelete,
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
}: UseGroupManagementArgs) {
  const [groupMoveError, setGroupMoveError] = React.useState<string | null>(null);
  const [pendingGroupMoveCount, setPendingGroupMoveCount] = React.useState(0);
  const movingDroneGroups = pendingGroupMoveCount > 0;
  const [deletingGroups, setDeletingGroups] = React.useState<Record<string, boolean>>({});
  const [renamingGroups, setRenamingGroups] = React.useState<Record<string, boolean>>({});
  const confirmDelete = useAppConfirmDialog();

  const shouldConfirmDelete = React.useCallback(() => !autoDelete, [autoDelete]);

  const renameGroup = React.useCallback(
    async (groupRaw: string, nextNameRaw?: string): Promise<boolean> => {
      const group = String(groupRaw ?? '').trim();
      if (!group) return false;
      if (isUngroupedGroupName(group)) return false;
      if (renamingGroups[group]) return false;

      const next = typeof nextNameRaw === 'string' ? nextNameRaw : window.prompt(`Rename group "${group}" to:`, group);
      const newName = String(next ?? '').trim();
      if (!newName) return false;
      if (newName === group) return false;
      if (isUngroupedGroupName(newName)) {
        window.alert('"Ungrouped" is reserved.');
        return false;
      }

      setRenamingGroups((prev) => ({ ...prev, [group]: true }));
      try {
        await requestJson<{ ok: true; id: string; oldName: string; newName: string; renamed: boolean }>(
          `/api/groups/${encodeURIComponent(groupIdByName[group] ?? group)}/rename`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ newName, repoPath: activeRepoPath }),
          },
        );

        // Keep per-group UI state aligned after rename.
        setCollapsedGroups((prev) => renameCollapsedGroupKeysByPrefix(prev, group, newName));
        setDeletingGroups((prev) => {
          if (!(group in prev)) return prev;
          const nextMap = { ...prev };
          delete nextMap[group];
          nextMap[newName] = false;
          return nextMap;
        });
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
        setSidebarNodeOrderByParent((prev) => renameSidebarNodeOrderByParentGroupPrefix(prev, group, newName));
        if (selectedGroupMultiChat && isSameOrDescendantSidebarGroupPath(selectedGroupMultiChat, group)) {
          setSelectedGroupMultiChat(rewriteSidebarGroupPathPrefix(selectedGroupMultiChat, group, newName));
        }
        return true;
      } catch (e: any) {
        const msg = String(e?.message ?? e ?? '').trim();
        console.error('[DroneHub] rename group failed', { group, newName, error: e });
        window.alert(msg || 'Rename failed.');
        return false;
      } finally {
        setRenamingGroups((prev) => {
          if (!prev[group] && !prev[newName]) return prev;
          const nextMap = { ...prev };
          delete nextMap[group];
          delete nextMap[newName];
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
      if (!group || deletingGroups[group]) return false;
      const targetKind = opts?.kind === 'repo' ? 'repo' : 'group';
      const groupLabel = String(opts?.label ?? group).trim() || group;
      const targetRepoPath = targetKind === 'repo' ? String(opts?.repoPath ?? '').trim() : '';
      const scopedRepoPath =
        targetKind === 'group'
          ? String(opts?.repoPath ?? activeRepoPath ?? '').trim()
          : '';
      if (shouldConfirmDelete()) {
        const ok = await confirmDelete(buildSidebarGroupDeleteConfirmation({
          kind: targetKind,
          label: groupLabel,
          countHint,
          repoPath: targetKind === 'repo' ? targetRepoPath : scopedRepoPath,
        }));
        if (!ok) return false;
      }
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
      setDeletingGroups((prev) => ({ ...prev, [group]: true }));
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
          await requestJson(`/api/groups/${encodeURIComponent(groupIdByName[group] ?? group)}${query}`, { method: 'DELETE' });
        }
        if (!scopedRepoPath) {
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
        if (selectedGroupMultiChat && isSameOrDescendantSidebarGroupPath(selectedGroupMultiChat, group)) {
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
          if (!prev[group]) return prev;
          const nextMap = { ...prev };
          delete nextMap[group];
          return nextMap;
        });
      }
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
      shouldConfirmDelete,
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
    async (targetGroupLabel: string) => {
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
        await requestJson<{ ok: true; name: string; createdAt: string }>(`/api/groups`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: target, repoPath: activeRepoPath }),
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
    createGroup,
    moveDronesToGroup,
    createGroupAndMove,
  };
}
