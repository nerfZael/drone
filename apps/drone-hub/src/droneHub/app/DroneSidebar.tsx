import React from 'react';
import { isUngroupedGroupName } from '../../domain';
import { DroneCard } from '../overview';
import type { DroneSummary, RepoSummary } from '../types';
import { DRONE_DND_MIME } from './app-config';
import { compareDronesByNewestFirst, isDroneStartingOrSeeding } from './helpers';
import { IconChevron, IconColumns, IconFolder, IconList, IconPencil, IconPlus, IconPlusDouble, IconSettings, IconSpinner, IconTrash, SkeletonLine } from './icons';
import { useDroneSidebarUiState } from './use-drone-hub-ui-store';

type SidebarGroup = {
  group: string;
  items: DroneSummary[];
};

export type DroneSidebarProps = {
  dronesError: string | null | undefined;
  groupMoveError: string | null;
  dronesLoading: boolean;
  sidebarDronesFilteredByRepo: DroneSummary[];
  sidebarDrones: DroneSummary[];
  sidebarOptimisticDroneIdSet: Set<string>;
  selectedDroneSet: Set<string>;
  selectedIsResponding: boolean;
  deletingDrones: Record<string, boolean>;
  renamingDrones: Record<string, boolean>;
  settingBaseImages: Record<string, boolean>;
  movingDroneGroups: boolean;
  sidebarGroups: SidebarGroup[];
  collapsedGroups: Record<string, boolean>;
  deletingGroups: Record<string, boolean>;
  renamingGroups: Record<string, boolean>;
  dragOverGroup: string | null;
  sidebarHasUngroupedGroup: boolean;
  draggingDroneNames: string[] | null;
  dragOverUngrouped: boolean;
  repos: RepoSummary[];
  reposLoading: boolean;
  reposError: string | null | undefined;
  dronesCount: number;
  droneCountByRepoPath: Map<string, number>;
  uiDroneName: (nameRaw: string) => string;
  onOpenDraftChatComposer: () => void;
  onOpenCreateModal: () => void;
  onSelectDroneCard: (droneId: string, opts?: { toggle?: boolean; range?: boolean }) => void;
  onOpenCloneModal: (drone: DroneSummary) => void;
  onRenameDrone: (droneId: string) => void;
  onSetDroneBaseImage: (droneId: string) => void;
  onDeleteDrone: (droneId: string) => void;
  onOpenDroneErrorModal: (drone: DroneSummary, message: string) => void;
  onUngroupedDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onUngroupedDragLeave: (event: React.DragEvent<HTMLDivElement>) => void;
  onUngroupedDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onGroupDragOver: (group: string, event: React.DragEvent<HTMLDivElement>) => void;
  onGroupDragLeave: (group: string, event: React.DragEvent<HTMLDivElement>) => void;
  onGroupDrop: (group: string, event: React.DragEvent<HTMLDivElement>) => void;
  onCreateGroupAndMove: (
    group: string,
    droneIds: string[],
  ) => Promise<{ ok: boolean; error: string | null }>;
  onToggleGroupCollapsed: (group: string) => void;
  onRenameGroup: (group: string) => void;
  onOpenGroupMultiChat: (group: string) => void;
  onDeleteGroup: (group: string, count: number) => void;
  onDroneDragStart: (droneId: string, event: React.DragEvent<HTMLDivElement>) => void;
  onDroneDragEnd: () => void;
  onOpenReposModal: () => void;
};

export function DroneSidebar({
  dronesError,
  groupMoveError,
  dronesLoading,
  sidebarDronesFilteredByRepo,
  sidebarDrones,
  sidebarOptimisticDroneIdSet,
  selectedDroneSet,
  selectedIsResponding,
  deletingDrones,
  renamingDrones,
  settingBaseImages,
  movingDroneGroups,
  sidebarGroups,
  collapsedGroups,
  deletingGroups,
  renamingGroups,
  dragOverGroup,
  sidebarHasUngroupedGroup,
  draggingDroneNames,
  dragOverUngrouped,
  repos,
  reposLoading,
  reposError,
  dronesCount,
  droneCountByRepoPath,
  uiDroneName,
  onOpenDraftChatComposer,
  onOpenCreateModal,
  onSelectDroneCard,
  onOpenCloneModal,
  onRenameDrone,
  onSetDroneBaseImage,
  onDeleteDrone,
  onOpenDroneErrorModal,
  onUngroupedDragOver,
  onUngroupedDragLeave,
  onUngroupedDrop,
  onGroupDragOver,
  onGroupDragLeave,
  onGroupDrop,
  onCreateGroupAndMove,
  onToggleGroupCollapsed,
  onRenameGroup,
  onOpenGroupMultiChat,
  onDeleteGroup,
  onDroneDragStart,
  onDroneDragEnd,
  onOpenReposModal,
}: DroneSidebarProps) {
  const {
    sidebarCollapsed,
    selectedDroneIds,
    draftChat,
    appView,
    viewMode,
    activeRepoPath,
    selectedDrone,
    selectedGroupMultiChat,
    sidebarReposCollapsed,
    autoDelete,
    setAppView,
    setViewMode,
    setSidebarReposCollapsed,
    setActiveRepoPath,
    setAutoDelete,
    setSidebarCollapsed,
  } = useDroneSidebarUiState();
  const [dragOverCreateGroup, setDragOverCreateGroup] = React.useState(false);
  const [createGroupTargetDroneIds, setCreateGroupTargetDroneIds] = React.useState<string[] | null>(null);
  const [createGroupName, setCreateGroupName] = React.useState('');
  const [createGroupInlineError, setCreateGroupInlineError] = React.useState<string | null>(null);
  const [creatingGroupMove, setCreatingGroupMove] = React.useState(false);
  const createGroupInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!createGroupTargetDroneIds || createGroupTargetDroneIds.length === 0) return;
    const id = window.requestAnimationFrame(() => {
      createGroupInputRef.current?.focus();
      createGroupInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [createGroupTargetDroneIds]);

  const parseDraggedDroneIds = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>): string[] => {
      const out: string[] = [];
      const add = (raw: unknown) => {
        const id = String(raw ?? '').trim();
        if (!id || out.includes(id)) return;
        out.push(id);
      };

      try {
        const jsonRaw = event.dataTransfer.getData(DRONE_DND_MIME);
        if (jsonRaw) {
          const parsed = JSON.parse(jsonRaw);
          if (Array.isArray(parsed)) {
            for (const id of parsed) add(id);
          }
        }
      } catch {
        // Ignore malformed drag payload.
      }

      if (out.length === 0) {
        const plain = String(event.dataTransfer.getData('text/plain') ?? '');
        if (plain) {
          for (const line of plain.split('\n')) add(line);
        }
      }

      if (out.length === 0 && Array.isArray(draggingDroneNames)) {
        for (const id of draggingDroneNames) add(id);
      }

      return out;
    },
    [draggingDroneNames],
  );

  const closeCreateGroupInline = React.useCallback(() => {
    if (creatingGroupMove) return;
    setCreateGroupTargetDroneIds(null);
    setCreateGroupName('');
    setCreateGroupInlineError(null);
  }, [creatingGroupMove]);

  const onCreateGroupDragOver = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const ids = parseDraggedDroneIds(event);
      if (ids.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      if (!dragOverCreateGroup) setDragOverCreateGroup(true);
    },
    [dragOverCreateGroup, parseDraggedDroneIds],
  );

  const onCreateGroupDragLeave = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) return;
    setDragOverCreateGroup(false);
  }, []);

  const onCreateGroupDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setDragOverCreateGroup(false);
      const ids = parseDraggedDroneIds(event);
      if (ids.length === 0) return;
      setCreateGroupTargetDroneIds(ids);
      setCreateGroupInlineError(null);
    },
    [parseDraggedDroneIds],
  );

  const onSubmitCreateGroupInline = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (creatingGroupMove) return;
      const ids = createGroupTargetDroneIds ?? [];
      const group = String(createGroupName ?? '').trim();
      if (!group) {
        setCreateGroupInlineError('Group name is required.');
        return;
      }
      if (ids.length === 0) {
        setCreateGroupInlineError('No drones selected for group move.');
        return;
      }

      setCreatingGroupMove(true);
      setCreateGroupInlineError(null);
      try {
        const result = await onCreateGroupAndMove(group, ids);
        if (!result.ok) {
          setCreateGroupInlineError(result.error || 'Failed to create group.');
          return;
        }
        setCreateGroupTargetDroneIds(null);
        setCreateGroupName('');
      } catch (error: any) {
        const msg = String(error?.message ?? error ?? '').trim();
        setCreateGroupInlineError(msg || 'Failed to create group.');
      } finally {
        setCreatingGroupMove(false);
      }
    },
    [createGroupName, createGroupTargetDroneIds, creatingGroupMove, onCreateGroupAndMove],
  );

  return (
    <>
      <aside
        className="bg-[var(--panel-alt)] border-r border-[var(--border)] flex flex-col min-h-0 relative dh-dot-grid flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-out"
        style={{ width: sidebarCollapsed ? 0 : 280 }}
      >
        <div className="flex-shrink-0 px-3 py-3 border-b border-[var(--border)] relative">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-[var(--accent)] via-[var(--accent-muted)] to-transparent opacity-40" />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="font-semibold text-[13px] text-[var(--fg)] whitespace-nowrap"
                style={{ fontFamily: 'var(--display)' }}
              >
                Drone Hub
              </span>
              {selectedDroneIds.length > 1 && (
                <span className="text-[10px] text-[var(--accent)] whitespace-nowrap" title={`${selectedDroneIds.length} drones selected`}>
                  {selectedDroneIds.length} selected
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={onOpenDraftChatComposer}
                className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
                  draftChat
                    ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                    : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
                }`}
                title="Create drone (A)"
                aria-label="Create drone"
              >
                <IconPlus className="opacity-80" />
              </button>
              <button
                type="button"
                onClick={onOpenCreateModal}
                className="inline-flex items-center justify-center w-7 h-7 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] transition-all"
                title="Create multiple drones (S)"
                aria-label="Create multiple drones"
              >
                <IconPlusDouble className="opacity-80" />
              </button>
              <button
                type="button"
                onClick={() => setAppView((prev) => (prev === 'settings' ? 'workspace' : 'settings'))}
                className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
                  appView === 'settings'
                    ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                    : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
                }`}
                title={appView === 'settings' ? 'Back to workspace' : 'Open settings'}
                aria-label={appView === 'settings' ? 'Back to workspace' : 'Open settings'}
              >
                <IconSettings className="opacity-80" />
              </button>
              <button
                onClick={() => setViewMode((prev) => (prev === 'grouped' ? 'flat' : 'grouped'))}
                className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-[10px] font-semibold text-[var(--muted-dim)] hover:text-[var(--muted)] hover:bg-[var(--hover)] border border-transparent hover:border-[var(--border-subtle)] transition-all"
                title={viewMode === 'grouped' ? 'Switch to flat list' : 'Switch to grouped folders'}
              >
                <IconList className="opacity-60" />
                {viewMode === 'grouped' ? 'Grp' : 'Flat'}
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
          {dronesError && (
            <div className="mx-2 mb-2 p-3 rounded border border-[rgba(255,90,90,.15)] bg-[var(--red-subtle)] text-xs text-[var(--red)]">
              Failed to load drones: {dronesError}
            </div>
          )}
          {groupMoveError && (
            <div className="mx-2 mb-2 p-2 rounded border border-[rgba(255,90,90,.15)] bg-[var(--red-subtle)] text-[11px] text-[var(--red)]">
              Group move failed: {groupMoveError}
            </div>
          )}
          {dronesLoading && sidebarDronesFilteredByRepo.length === 0 && !dronesError && (
            <div className="px-3 py-3 flex flex-col gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex flex-col gap-2 opacity-30">
                  <SkeletonLine w="65%" />
                  <SkeletonLine w="40%" />
                </div>
              ))}
            </div>
          )}
          {!dronesLoading && sidebarDrones.length === 0 && !dronesError && (
            <div className="px-3 py-10 text-center">
              <div
                className="text-[var(--muted-dim)] text-[11px] tracking-wide uppercase"
                style={{ fontFamily: 'var(--display)' }}
              >
                No drones registered
              </div>
              <div className="mt-4 mx-auto max-w-[240px] flex flex-col gap-2">
                <button
                  type="button"
                  onClick={onOpenDraftChatComposer}
                  className="w-full inline-flex items-center gap-2 h-[30px] px-3 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[11px] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] transition-all"
                  title="Create new drone (A)"
                  aria-label="Create new drone"
                >
                  <IconPlus className="opacity-80" />
                  <span className="font-semibold tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                    Create new drone
                  </span>
                </button>
                <button
                  type="button"
                  onClick={onOpenCreateModal}
                  className="w-full inline-flex items-center gap-2 h-[30px] px-3 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[11px] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] transition-all"
                  title="Create multiple drones (S)"
                  aria-label="Create multiple drones"
                >
                  <IconPlusDouble className="opacity-80" />
                  <span className="font-semibold tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                    Create multiple drones
                  </span>
                </button>
              </div>
              <div className="text-[var(--muted-dim)] text-[10px] mt-4">
                Or run{' '}
                <code className="px-1.5 py-0.5 rounded bg-[rgba(167,139,250,.06)] border border-[rgba(167,139,250,.08)] text-[#C4B5FD] text-[10px]">
                  drone create &lt;name&gt;
                </code>{' '}
                in your terminal.
              </div>
            </div>
          )}
          {!dronesLoading && sidebarDrones.length > 0 && sidebarDronesFilteredByRepo.length === 0 && activeRepoPath && !dronesError && (
            <div className="px-3 py-10 text-center">
              <div
                className="text-[var(--muted-dim)] text-[11px] tracking-wide uppercase"
                style={{ fontFamily: 'var(--display)' }}
              >
                No drones for selected repo
              </div>
              <div className="text-[var(--muted-dim)] text-[10px] mt-2 font-mono truncate" title={activeRepoPath}>
                {activeRepoPath}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-0.5 select-none">
            {viewMode === 'flat' ? (
              sidebarDronesFilteredByRepo
                .slice()
                .sort(compareDronesByNewestFirst)
                .map((d) => {
                  const isOptimistic = sidebarOptimisticDroneIdSet.has(d.id);
                  return (
                    <DroneCard
                      key={d.id}
                      drone={d}
                      displayName={uiDroneName(d.name)}
                      statusHint={isOptimistic ? 'queued' : undefined}
                      selected={selectedDroneSet.has(d.id)}
                      busy={
                        isDroneStartingOrSeeding(d.hubPhase)
                          ? false
                          : Boolean(d.busy) || (d.id === selectedDrone && selectedIsResponding)
                      }
                      onClick={(opts) => onSelectDroneCard(d.id, opts)}
                      onClone={() => onOpenCloneModal(d)}
                      onRename={() => onRenameDrone(d.id)}
                      onSetBaseImage={() => onSetDroneBaseImage(d.id)}
                      onDelete={() => onDeleteDrone(d.id)}
                      onErrorClick={onOpenDroneErrorModal}
                      cloneDisabled={isOptimistic || Boolean(deletingDrones[d.id]) || Boolean(renamingDrones[d.id]) || Boolean(settingBaseImages[d.id])}
                      renameDisabled={isOptimistic || Boolean(deletingDrones[d.id]) || Boolean(renamingDrones[d.id]) || Boolean(settingBaseImages[d.id])}
                      renameBusy={Boolean(renamingDrones[d.id])}
                      setBaseImageDisabled={
                        isOptimistic ||
                        Boolean(deletingDrones[d.id]) ||
                        Boolean(renamingDrones[d.id]) ||
                        Boolean(settingBaseImages[d.id]) ||
                        isDroneStartingOrSeeding(d.hubPhase)
                      }
                      setBaseImageBusy={Boolean(settingBaseImages[d.id])}
                      deleteDisabled={isOptimistic || Boolean(deletingDrones[d.id]) || Boolean(renamingDrones[d.id]) || Boolean(settingBaseImages[d.id])}
                      deleteBusy={Boolean(deletingDrones[d.id])}
                    />
                  );
                })
            ) : (
              <>
                <div
                  className="flex flex-col gap-1.5"
                  onDragOver={onUngroupedDragOver}
                  onDragLeave={onUngroupedDragLeave}
                  onDrop={onUngroupedDrop}
                >
                {sidebarGroups.map(({ group, items }) => {
                  const collapsed = !!collapsedGroups[group];
                  const isDeletingGroup = Boolean(deletingGroups[group]);
                  const isRenamingGroup = Boolean(renamingGroups[group]);
                  const isDropTarget = dragOverGroup === group;
                  const canRenameGroup = !isUngroupedGroupName(group);
                  return (
                    <div
                      key={group}
                      className={`rounded-md border bg-[rgba(0,0,0,.15)] overflow-hidden transition-colors ${
                        isDropTarget ? 'border-[var(--accent-muted)] ring-1 ring-[var(--accent-muted)]' : 'border-[var(--border-subtle)]'
                      }`}
                      onDragOver={(event) => onGroupDragOver(group, event)}
                      onDragLeave={(event) => onGroupDragLeave(group, event)}
                      onDrop={(event) => onGroupDrop(group, event)}
                    >
                      <div
                        className={`group/group-header w-full px-3 py-2 flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] transition-colors ${
                          isDropTarget ? 'bg-[var(--accent-subtle)]' : 'hover:bg-[var(--hover)]'
                        }`}
                      >
                        <button
                          onClick={() => onToggleGroupCollapsed(group)}
                          className="flex items-center gap-2 min-w-0 text-left flex-1"
                          title={collapsed ? 'Expand group' : 'Collapse group'}
                        >
                          <IconChevron down={!collapsed} className="text-[var(--muted-dim)]" />
                          <IconFolder className="text-[var(--muted-dim)] opacity-50" />
                          <span
                            className="text-[11px] font-semibold text-[var(--fg-secondary)] truncate tracking-wide uppercase"
                            style={{ fontFamily: 'var(--display)' }}
                          >
                            {group}
                          </span>
                        </button>
                        <div className="flex items-center justify-end flex-shrink-0 min-w-[148px]">
                          <div className="relative w-full flex justify-end">
                            <div
                              className={`flex items-center gap-2 text-[10px] font-mono text-[var(--muted-dim)] transition-opacity duration-150 ${
                                isDeletingGroup || isRenamingGroup
                                  ? 'opacity-0 pointer-events-none'
                                  : 'group-hover/group-header:opacity-0 group-hover/group-header:pointer-events-none'
                              }`}
                            >
                              <span>
                                {items.length} drone{items.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                            {canRenameGroup && (
                              <button
                                onClick={() => onRenameGroup(group)}
                                disabled={isDeletingGroup || isRenamingGroup}
                                aria-busy={isRenamingGroup}
                                className={`absolute right-8 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
                                  isDeletingGroup || isRenamingGroup
                                    ? 'opacity-50 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                                    : 'opacity-0 pointer-events-none group-hover/group-header:opacity-100 group-hover/group-header:pointer-events-auto bg-[rgba(167,139,250,.08)] border-[rgba(167,139,250,.18)] text-[var(--accent)] hover:bg-[rgba(167,139,250,.12)]'
                                }`}
                                title={isRenamingGroup ? `Renaming group "${group}"…` : `Rename group "${group}"`}
                                aria-label={isRenamingGroup ? `Renaming group "${group}"` : `Rename group "${group}"`}
                              >
                                {isRenamingGroup ? <IconSpinner className="opacity-90" /> : <IconPencil className="opacity-90" />}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onOpenGroupMultiChat(group)}
                              disabled={isDeletingGroup}
                              className={`absolute right-16 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
                                isDeletingGroup
                                  ? 'opacity-50 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                                  : selectedGroupMultiChat === group
                                    ? 'opacity-100 pointer-events-auto bg-[var(--accent-subtle)] border-[var(--accent-muted)] text-[var(--accent)]'
                                    : 'opacity-0 pointer-events-none group-hover/group-header:opacity-100 group-hover/group-header:pointer-events-auto bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
                              }`}
                              title={`Open "${group}" multi-chat`}
                              aria-label={`Open "${group}" multi-chat`}
                            >
                              <IconColumns className="opacity-90" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteGroup(group, items.length)}
                              disabled={isDeletingGroup || isRenamingGroup}
                              aria-busy={isDeletingGroup}
                              className={`absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
                                isDeletingGroup || isRenamingGroup
                                  ? 'opacity-50 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                                  : 'opacity-0 pointer-events-none group-hover/group-header:opacity-100 group-hover/group-header:pointer-events-auto bg-[var(--red-subtle)] border-[rgba(255,90,90,.2)] text-[var(--red)] hover:bg-[rgba(255,90,90,.15)]'
                              }`}
                              title={
                                isDeletingGroup
                                  ? `Deleting group "${group}"…`
                                  : `Delete group "${group}" (and all drones inside)`
                              }
                              aria-label={
                                isDeletingGroup
                                  ? `Deleting group "${group}"`
                                  : `Delete group "${group}" (and all drones inside)`
                              }
                            >
                              {isDeletingGroup ? <IconSpinner className="opacity-90" /> : <IconTrash className="opacity-90" />}
                            </button>
                          </div>
                        </div>
                      </div>
                      {!collapsed && (
                        <div className="px-1.5 py-1.5 flex flex-col gap-0.5">
                          {items.map((d) => {
                            const isOptimistic = sidebarOptimisticDroneIdSet.has(d.id);
                            return (
                              <DroneCard
                                key={d.id}
                                drone={d}
                                displayName={uiDroneName(d.name)}
                                statusHint={isOptimistic ? 'queued' : undefined}
                                selected={selectedDroneSet.has(d.id)}
                                busy={
                                  isDroneStartingOrSeeding(d.hubPhase)
                                    ? false
                                    : Boolean(d.busy) || (d.id === selectedDrone && selectedIsResponding)
                                }
                                showGroup={false}
                                onClick={(opts) => onSelectDroneCard(d.id, opts)}
                                draggable={!movingDroneGroups && !isOptimistic}
                                onDragStart={(event) => onDroneDragStart(d.id, event)}
                                onDragEnd={onDroneDragEnd}
                                onClone={() => onOpenCloneModal(d)}
                                onRename={() => onRenameDrone(d.id)}
                                onSetBaseImage={() => onSetDroneBaseImage(d.id)}
                                onDelete={() => onDeleteDrone(d.id)}
                                onErrorClick={onOpenDroneErrorModal}
                                cloneDisabled={isOptimistic || Boolean(deletingDrones[d.id]) || Boolean(renamingDrones[d.id]) || Boolean(settingBaseImages[d.id])}
                                renameDisabled={isOptimistic || Boolean(deletingDrones[d.id]) || Boolean(renamingDrones[d.id]) || Boolean(settingBaseImages[d.id])}
                                renameBusy={Boolean(renamingDrones[d.id])}
                                setBaseImageDisabled={
                                  isOptimistic ||
                                  Boolean(deletingDrones[d.id]) ||
                                  Boolean(renamingDrones[d.id]) ||
                                  Boolean(settingBaseImages[d.id]) ||
                                  isDroneStartingOrSeeding(d.hubPhase)
                                }
                                setBaseImageBusy={Boolean(settingBaseImages[d.id])}
                                deleteDisabled={isOptimistic || Boolean(deletingDrones[d.id]) || Boolean(renamingDrones[d.id]) || Boolean(settingBaseImages[d.id])}
                                deleteBusy={Boolean(deletingDrones[d.id])}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {!sidebarHasUngroupedGroup && draggingDroneNames && draggingDroneNames.length > 0 && (
                  <div
                    className={`rounded-md border border-dashed px-3 py-2 text-[10px] font-semibold tracking-wide uppercase transition-colors ${
                      dragOverUngrouped
                        ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                        : 'border-[var(--border-subtle)] text-[var(--muted-dim)]'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    Drop here to move to Ungrouped
                  </div>
                )}
                </div>
                {((draggingDroneNames && draggingDroneNames.length > 0) ||
                  (createGroupTargetDroneIds && createGroupTargetDroneIds.length > 0)) && (
                  <div
                    className={`mt-1 rounded-md border border-dashed px-3 py-2 transition-colors ${
                      dragOverCreateGroup || (createGroupTargetDroneIds && createGroupTargetDroneIds.length > 0)
                        ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)]'
                        : 'border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)]'
                    }`}
                    onDragOver={onCreateGroupDragOver}
                    onDragLeave={onCreateGroupDragLeave}
                    onDrop={onCreateGroupDrop}
                  >
                    <div
                      className="text-[10px] font-semibold tracking-wide uppercase text-[var(--muted-dim)]"
                      style={{ fontFamily: 'var(--display)' }}
                    >
                      {createGroupTargetDroneIds && createGroupTargetDroneIds.length > 0
                        ? `Create new group (${createGroupTargetDroneIds.length} drone${createGroupTargetDroneIds.length === 1 ? '' : 's'})`
                        : 'Drop here to create a new group'}
                    </div>
                    {createGroupTargetDroneIds && createGroupTargetDroneIds.length > 0 && (
                      <form className="mt-2 flex flex-col gap-2" onSubmit={onSubmitCreateGroupInline}>
                        <input
                          ref={createGroupInputRef}
                          value={createGroupName}
                          onChange={(event) => setCreateGroupName(event.target.value)}
                          disabled={creatingGroupMove}
                          maxLength={64}
                          placeholder="Group name"
                          className="w-full rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-2 py-1.5 text-[11px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="submit"
                            disabled={creatingGroupMove}
                            className={`inline-flex h-7 items-center rounded px-2 text-[10px] font-semibold tracking-wide uppercase transition-all ${
                              creatingGroupMove
                                ? 'cursor-not-allowed border border-[var(--border-subtle)] text-[var(--muted-dim)]'
                                : 'border border-[var(--accent-muted)] bg-[rgba(167,139,250,.12)] text-[var(--accent)] hover:bg-[rgba(167,139,250,.18)]'
                            }`}
                            style={{ fontFamily: 'var(--display)' }}
                          >
                            {creatingGroupMove ? 'Creating…' : 'Create & move'}
                          </button>
                          <button
                            type="button"
                            onClick={closeCreateGroupInline}
                            disabled={creatingGroupMove}
                            className={`inline-flex h-7 items-center rounded px-2 text-[10px] font-semibold tracking-wide uppercase transition-all ${
                              creatingGroupMove
                                ? 'cursor-not-allowed border border-[var(--border-subtle)] text-[var(--muted-dim)]'
                                : 'border border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
                            }`}
                            style={{ fontFamily: 'var(--display)' }}
                          >
                            Cancel
                          </button>
                        </div>
                        {createGroupInlineError && (
                          <div className="text-[10px] text-[var(--red)]">
                            {createGroupInlineError}
                          </div>
                        )}
                      </form>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex-shrink-0 border-t border-[var(--border)] bg-[rgba(0,0,0,.12)]">
          <div className="px-2.5 py-1.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSidebarReposCollapsed((prev) => !prev)}
              className="flex-1 min-w-0 inline-flex items-center gap-2 px-1.5 py-1 rounded text-left text-[10px] font-semibold tracking-wide uppercase text-[var(--muted-dim)] hover:text-[var(--muted)] hover:bg-[var(--hover)] transition-all"
              style={{ fontFamily: 'var(--display)' }}
              title={sidebarReposCollapsed ? 'Expand repos list' : 'Collapse repos list'}
              aria-label={sidebarReposCollapsed ? 'Expand repos list' : 'Collapse repos list'}
            >
              <IconChevron down={!sidebarReposCollapsed} className="opacity-70" />
              <IconFolder className="opacity-60 w-3 h-3" />
              <span className="truncate">Repos {repos.length > 0 ? repos.length : ''}</span>
              {activeRepoPath ? (
                <span className="ml-auto px-1.5 py-0.5 rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[9px] text-[var(--accent)]">
                  Filtered
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={onOpenReposModal}
              className="inline-flex items-center justify-center w-7 h-7 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] transition-all"
              title={`Manage repos (${repos.length})`}
              aria-label="Manage repos"
            >
              <IconSettings className="opacity-70" />
            </button>
          </div>
          {!sidebarReposCollapsed && (
            <div className="max-h-[190px] overflow-y-auto px-2 pb-2 flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => setActiveRepoPath('')}
                className={`w-full text-left px-2.5 py-2 rounded border transition-all ${
                  !activeRepoPath
                    ? 'bg-[var(--selected)] border-[var(--accent-muted)]'
                    : 'border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--hover)]'
                }`}
                title="Show drones from all repos"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-[var(--fg-secondary)]">All repos</span>
                  <span className="text-[10px] font-mono text-[var(--muted-dim)]">{dronesCount}</span>
                </div>
              </button>
              {repos
                .slice()
                .sort((a, b) => a.path.localeCompare(b.path))
                .map((r) => {
                  const p = String(r.path ?? '').trim();
                  if (!p) return null;
                  const selected = p === activeRepoPath;
                  const base = r.github
                    ? `${r.github.owner}/${r.github.repo}`
                    : p.split(/[\\/]/).filter(Boolean).pop() || p;
                  const droneCount = droneCountByRepoPath.get(p) ?? 0;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setActiveRepoPath((prev) => (prev === p ? '' : p))}
                      className={`w-full text-left px-2.5 py-2 rounded border transition-all ${
                        selected
                          ? 'bg-[var(--selected)] border-[var(--accent-muted)] shadow-[0_0_8px_rgba(167,139,250,.06)]'
                          : 'border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--hover)]'
                      }`}
                      title={p}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11px] text-[var(--fg-secondary)] truncate">{base}</div>
                          <div className="text-[10px] text-[var(--muted-dim)] truncate font-mono mt-0.5">{p}</div>
                        </div>
                        <span className="text-[10px] font-mono text-[var(--muted-dim)] mt-0.5">{droneCount}</span>
                      </div>
                    </button>
                  );
                })}
              {!reposLoading && repos.length === 0 && !reposError && (
                <div className="px-2.5 py-3 text-[10px] text-[var(--muted-dim)]">
                  No repos registered yet.
                </div>
              )}
              {reposError && (
                <div className="px-2.5 py-3 text-[10px] text-[var(--red)]">
                  Failed to load repos.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex-shrink-0 px-3 py-2.5 border-t border-[var(--border)] flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 select-none cursor-pointer group">
            <input
              type="checkbox"
              className="accent-[var(--accent)] w-3.5 h-3.5"
              checked={autoDelete}
              onChange={(e) => setAutoDelete(e.target.checked)}
            />
            <span className="text-[10px] text-[var(--muted-dim)] group-hover:text-[var(--muted)] transition-colors" title="When enabled, deletes won't ask for confirmation.">
              Auto-delete
            </span>
          </label>
          <button
            type="button"
            onClick={() => setSidebarCollapsed(true)}
            className="inline-flex items-center justify-center w-7 h-7 rounded text-[var(--muted-dim)] hover:text-[var(--muted)] hover:bg-[var(--hover)] transition-all"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 3L6 8l5 5" /><line x1="3" y1="3" x2="3" y2="13" /></svg>
          </button>
        </div>
      </aside>

      {sidebarCollapsed && (
        <div className="flex-shrink-0 w-10 bg-[var(--panel-alt)] border-r border-[var(--border)] flex flex-col items-center pt-3 gap-2">
          <button
            type="button"
            onClick={() => setSidebarCollapsed(false)}
            className="inline-flex items-center justify-center w-7 h-7 rounded text-[var(--muted-dim)] hover:text-[var(--accent)] hover:bg-[var(--accent-subtle)] transition-all"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3l5 5-5 5" /><line x1="13" y1="3" x2="13" y2="13" /></svg>
          </button>
          <button
            type="button"
            onClick={() => { setSidebarCollapsed(false); onOpenDraftChatComposer(); }}
            className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
              draftChat
                ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
            }`}
            title="Create drone (A)"
            aria-label="Create drone"
          >
            <IconPlus className="opacity-80" />
          </button>
          <button
            type="button"
            onClick={() => { setSidebarCollapsed(false); onOpenCreateModal(); }}
            className="inline-flex items-center justify-center w-7 h-7 rounded border border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] transition-all"
            title="Create multiple drones (S)"
            aria-label="Create multiple drones"
          >
            <IconPlusDouble className="opacity-80" />
          </button>
        </div>
      )}
    </>
  );
}
