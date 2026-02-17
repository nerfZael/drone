import React from 'react';
import { requestJson } from '../http';
import type { DroneSummary } from '../types';
import { isUngroupedGroupName } from '../../domain';
import { isNotFoundError } from './hooks';

type UseGroupManagementArgs = {
  autoDelete: boolean;
  drones: DroneSummary[];
  polledDrones: DroneSummary[];
  optimisticallyDeletedDrones: Record<string, boolean>;
  setOptimisticallyDeletedDrones: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setCollapsedGroups: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
};

export function useGroupManagement({
  autoDelete,
  drones,
  polledDrones,
  optimisticallyDeletedDrones,
  setOptimisticallyDeletedDrones,
  setCollapsedGroups,
}: UseGroupManagementArgs) {
  const [groupMoveError, setGroupMoveError] = React.useState<string | null>(null);
  const [movingDroneGroups, setMovingDroneGroups] = React.useState(false);
  const [deletingGroups, setDeletingGroups] = React.useState<Record<string, boolean>>({});
  const [renamingGroups, setRenamingGroups] = React.useState<Record<string, boolean>>({});

  const shouldConfirmDelete = React.useCallback(() => !autoDelete, [autoDelete]);

  const renameGroup = React.useCallback(
    async (groupRaw: string): Promise<void> => {
      const group = String(groupRaw ?? '').trim();
      if (!group) return;
      if (isUngroupedGroupName(group)) return;
      if (renamingGroups[group]) return;

      const next = window.prompt(`Rename group "${group}" to:`, group);
      const newName = String(next ?? '').trim();
      if (!newName) return;
      if (newName === group) return;
      if (isUngroupedGroupName(newName)) {
        window.alert('"Ungrouped" is reserved.');
        return;
      }

      setRenamingGroups((prev) => ({ ...prev, [group]: true }));
      try {
        await requestJson<{ ok: true; oldName: string; newName: string; renamed: boolean }>(
          `/api/groups/${encodeURIComponent(group)}/rename`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ newName }),
          },
        );

        // Keep per-group UI state aligned after rename.
        setCollapsedGroups((prev) => {
          if (!(group in prev)) return prev;
          const nextMap = { ...prev };
          const wasCollapsed = Boolean(nextMap[group]);
          delete nextMap[group];
          nextMap[newName] = wasCollapsed;
          return nextMap;
        });
        setDeletingGroups((prev) => {
          if (!(group in prev)) return prev;
          const nextMap = { ...prev };
          delete nextMap[group];
          return nextMap;
        });
      } catch (e: any) {
        const msg = String(e?.message ?? e ?? '').trim();
        console.error('[DroneHub] rename group failed', { group, newName, error: e });
        window.alert(msg || 'Rename failed.');
      } finally {
        setRenamingGroups((prev) => {
          if (!prev[group]) return prev;
          const nextMap = { ...prev };
          delete nextMap[group];
          return nextMap;
        });
      }
    },
    [renamingGroups, setCollapsedGroups],
  );

  const deleteGroup = React.useCallback(
    async (groupRaw: string, countHint?: number) => {
      const group = String(groupRaw ?? '').trim();
      if (!group || deletingGroups[group]) return;
      if (shouldConfirmDelete()) {
        const n = typeof countHint === 'number' && Number.isFinite(countHint) ? countHint : null;
        const ok = window.confirm(
          `Are you sure you want to delete group "${group}"${n != null ? ` (${n} drone${n === 1 ? '' : 's'})` : ''}?\n\nThis will delete ALL drones inside the group (containers + registry entries).`,
        );
        if (!ok) return;
      }
      const wantsUngrouped = isUngroupedGroupName(group);
      const targetNames = Array.from(
        new Set(
          polledDrones
            .filter((d) => {
              const droneGroup = String(d?.group ?? '').trim();
              if (wantsUngrouped) return !droneGroup || isUngroupedGroupName(droneGroup);
              return droneGroup === group;
            })
            .map((d) => String(d?.id ?? '').trim())
            .filter(Boolean),
        ),
      );
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
        await requestJson(`/api/groups/${encodeURIComponent(group)}`, { method: 'DELETE' });
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
      optimisticallyDeletedDrones,
      polledDrones,
      setOptimisticallyDeletedDrones,
      shouldConfirmDelete,
    ],
  );

  const moveDronesToGroup = React.useCallback(
    async (targetGroupLabel: string, rawDroneNames: string[]) => {
      const target = String(targetGroupLabel ?? '').trim();
      if (!target) return;
      const targetGroup = isUngroupedGroupName(target) ? null : target;
      const byId = new Map(drones.map((d) => [d.id, d]));
      const requested = Array.from(new Set(rawDroneNames.map((n) => String(n ?? '').trim()).filter(Boolean)));
      if (requested.length === 0) return;

      const movable = requested.filter((name) => {
        const d = byId.get(name);
        if (!d) return false;
        const currentRaw = String(d.group ?? '').trim();
        const currentGroup = !currentRaw || isUngroupedGroupName(currentRaw) ? 'Ungrouped' : currentRaw;
        return currentGroup !== target;
      });
      if (movable.length === 0) return;

      setGroupMoveError(null);
      setMovingDroneGroups(true);
      try {
        const resp = await requestJson<{
          ok: true;
          moved: Array<{ id: string; name: string; previousGroup: string | null; group: string | null }>;
          rejected: Array<{ id: string; name: string; error: string }>;
        }>(`/api/drones/group-set`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ droneIds: movable, group: targetGroup }),
        });
        const rejected = Array.isArray(resp?.rejected) ? resp.rejected : [];
        if (rejected.length > 0) {
          const msg = rejected
            .slice(0, 3)
            .map((r) => `${String(r?.name ?? r?.id ?? 'unknown')}: ${String(r?.error ?? 'failed')}`)
            .join(', ');
          setGroupMoveError(
            rejected.length > 3
              ? `Some drones could not be moved (${msg}, +${rejected.length - 3} more).`
              : `Some drones could not be moved (${msg}).`,
          );
        }
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        if (isNotFoundError(e)) {
          setGroupMoveError(
            'Hub API is missing group-move support. Restart the hub after rebuilding/updating `drone`.',
          );
        } else {
          setGroupMoveError(msg);
        }
        console.error('[DroneHub] move drones between groups failed', {
          targetGroup: targetGroup ?? null,
          drones: movable,
          error: e,
        });
      } finally {
        setMovingDroneGroups(false);
      }
    },
    [drones],
  );

  return {
    groupMoveError,
    setGroupMoveError,
    movingDroneGroups,
    deletingGroups,
    renamingGroups,
    renameGroup,
    deleteGroup,
    moveDronesToGroup,
  };
}
