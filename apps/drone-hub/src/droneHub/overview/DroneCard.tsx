import React from 'react';
import { timeAgo } from '../../domain';
import type { DroneSummary } from '../types';
import {
  IconBaseImage,
  IconClone,
  IconFolder,
  IconPin,
  IconPlus,
  IconRename,
  IconSpinner,
  IconTrash,
} from './icons';
import type { SidebarDensityMode } from '../app/settings-types';
import { sidebarItemTypeClass, sidebarSelectionEdgeClass } from '../sidebar/presentation';
import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';
import { SidebarContextMenu, type SidebarContextMenuItem } from '../app/SidebarContextMenu';
import { formatShortcutBinding } from '../app/shortcuts';

export type DroneInlineRenameResult =
  | boolean
  | void
  | { ok: boolean; error?: string | null };

export type DroneInlineRenameHandler = (
  newName: string,
) => Promise<DroneInlineRenameResult> | DroneInlineRenameResult;

type DroneCardProps = {
  drone: DroneSummary;
  displayName?: string;
  selected: boolean;
  busy?: boolean;
  approvalRequired?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onClick: (opts?: { toggle?: boolean; range?: boolean }) => void;
  dragNodeRef?: React.Ref<HTMLDivElement>;
  dragAttributes?: Record<string, any>;
  dragListeners?: Record<string, any>;
  draggable?: boolean;
  dragging?: boolean;
  onClone?: () => void;
  onCreateChat?: () => void;
  onAddToGroup?: () => void;
  onCreateGroup?: () => void;
  onRename?: DroneInlineRenameHandler;
  inlineRenameRequestKey?: number;
  onSetBaseImage?: () => void;
  onTogglePinned?: () => void;
  onDelete?: () => void;
  onErrorClick?: (drone: DroneSummary, message: string) => void;
  cloneDisabled?: boolean;
  createChatDisabled?: boolean;
  addToGroupDisabled?: boolean;
  renameDisabled?: boolean;
  renameBusy?: boolean;
  setBaseImageDisabled?: boolean;
  setBaseImageBusy?: boolean;
  pinned?: boolean;
  pinBusy?: boolean;
  deleteDisabled?: boolean;
  deleteBusy?: boolean;
  operationLabel?: string;
  statusHint?: string;
  unreadAgentMessage?: boolean;
  highlighted?: boolean;
  active?: boolean;
  activeIndicatorStyle?: 'dot' | 'edge';
  leadingIcon?: React.ReactNode;
  selectionTone?: 'accent' | 'muted';
  showSelectionEdge?: boolean;
  showGroup?: boolean;
  density?: SidebarDensityMode;
};

export type SidebarDroneDisplayState =
  | 'working'
  | 'approval'
  | 'waiting'
  | 'starting'
  | 'blocked'
  | 'offline'
  | 'idle'
  | 'archiving'
  | 'deleting';

const RECENT_BLOCKED_EMPHASIS_MS = 30_000;

function sidebarDroneInactiveDisplayState(drone: DroneSummary): SidebarDroneDisplayState {
  const rawState = `${drone.hubPhase ?? ''} ${drone.hubMessage ?? ''} ${drone.statusError ?? ''}`.toLowerCase();
  if (
    rawState.includes('block') ||
    rawState.includes('error') ||
    rawState.includes('fail') ||
    rawState.includes('problem')
  ) return 'blocked';
  if (drone.statusOk === false) return 'offline';
  if (rawState.includes('wait')) return 'waiting';
  if (rawState.includes('start') || rawState.includes('creat') || rawState.includes('seed')) {
    return 'starting';
  }
  return 'idle';
}

export function sidebarDroneDisplayState(
  drone: DroneSummary,
  busy = false,
  operationLabel = '',
  approvalRequired = false,
): SidebarDroneDisplayState {
  const operation = operationLabel.trim().toLowerCase();
  if (operation.includes('archiv')) return 'archiving';
  if (operation.includes('delet')) return 'deleting';
  if (approvalRequired) return 'approval';
  if (busy || drone.busy || (drone.busyChats?.length ?? 0) > 0) return 'working';

  return sidebarDroneInactiveDisplayState(drone);
}

export function sidebarChatDisplayState(
  drone: DroneSummary,
  busy = false,
  approvalRequired = false,
): SidebarDroneDisplayState {
  if (approvalRequired) return 'approval';
  if (busy) return 'working';
  return sidebarDroneInactiveDisplayState(drone);
}

export function sidebarDroneStateLabel(state: SidebarDroneDisplayState, unread: boolean): string {
  if (unread && state === 'idle') return 'Unread';
  if (state === 'offline') return 'Unavailable';
  if (state === 'approval') return 'Approval required';
  if (state === 'idle') return 'Ready';
  return `${state[0]?.toUpperCase() ?? ''}${state.slice(1)}`;
}

export function sidebarItemStateToneClass(
  state: SidebarDroneDisplayState,
  unread = false,
): string {
  if (state === 'working' || state === 'starting' || state === 'archiving' || state === 'deleting') {
    return 'text-[var(--yellow)]';
  }
  if (state === 'approval') return 'text-[var(--yellow)]';
  if (unread && state === 'idle') return 'text-[var(--green)]';
  if (state === 'waiting') return 'text-[var(--info)]';
  if (state === 'blocked' || state === 'offline') return 'text-[var(--red)]';
  return 'text-[var(--muted)]';
}

export function SidebarItemStateIndicator({
  state,
  unread = false,
  showReadyAnchor = false,
  emphasized = false,
}: {
  state: SidebarDroneDisplayState;
  unread?: boolean;
  showReadyAnchor?: boolean;
  emphasized?: boolean;
}) {
  const ready = state === 'idle' && !unread;
  const working = state === 'working' || state === 'starting' || state === 'archiving' || state === 'deleting';
  const approvalRequired = state === 'approval';
  const indicatorToneClass =
    unread && state === 'idle'
      ? 'bg-[var(--green)] shadow-[0_0_5px_var(--green-border)]'
      : state === 'waiting'
        ? 'bg-[var(--info)]'
        : state === 'offline'
          ? 'bg-[var(--red)]'
          : 'bg-[var(--muted)]';
  return (
    <span className="inline-flex h-3 w-3 flex-shrink-0 self-center items-center justify-center leading-none" aria-hidden="true">
      {ready ? (
        showReadyAnchor ? (
          <span
            data-sidebar-ready-anchor="true"
            className="h-1.5 w-1.5 rounded-full border border-[var(--sidebar-item-icon)] opacity-70"
          />
        ) : null
      ) : working ? (
        <SidebarWorkingStatusIndicator />
      ) : approvalRequired ? (
        <SidebarApprovalStatusIndicator />
      ) : state === 'blocked' ? (
        <SidebarBlockedStatusIndicator emphasized={emphasized} />
      ) : (
        <span className={`h-1.5 w-1.5 rounded-full ${indicatorToneClass}`} />
      )}
    </span>
  );
}

export function SidebarWorkingStatusIndicator() {
  return (
    <svg
      className="block h-3 w-3 animate-[spin_1.6s_linear_infinite] text-[var(--yellow)]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

export function SidebarApprovalStatusIndicator() {
  return (
    <svg
      className="block h-3 w-3 text-[var(--yellow)]"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 2.5v7M8 2.5v7" />
    </svg>
  );
}

export function SidebarBlockedStatusIndicator({ emphasized = false }: { emphasized?: boolean }) {
  return (
    <svg
      data-sidebar-blocked-indicator={emphasized ? 'emphasized' : 'quiet'}
      className={`block h-3 w-3 transition-[color,opacity] ${
        emphasized
          ? 'text-[var(--sidebar-blocked-indicator)] opacity-100'
          : 'text-[var(--sidebar-item-icon)] opacity-70 group-hover/drone:text-[var(--sidebar-blocked-indicator)] group-hover/drone:opacity-100 group-hover/chat-row:text-[var(--sidebar-blocked-indicator)] group-hover/chat-row:opacity-100'
      }`}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 1.25 11 10.25H1L6 1.25Z" />
      <path d="M6 4.15v2.75" />
      <circle cx="6" cy="8.5" r=".55" fill="currentColor" stroke="none" />
    </svg>
  );
}

function sameDroneCardDrone(a: DroneSummary, b: DroneSummary): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.createdAt === b.createdAt &&
    a.statusOk === b.statusOk &&
    (a.statusError ?? '') === (b.statusError ?? '') &&
    Boolean(a.statusChecking) === Boolean(b.statusChecking) &&
    a.hubPhase === b.hubPhase &&
    (a.hubMessage ?? '') === (b.hubMessage ?? '')
  );
}

function areDroneCardPropsEqual(a: DroneCardProps, b: DroneCardProps): boolean {
  return (
    sameDroneCardDrone(a.drone, b.drone) &&
    (a.displayName ?? '') === (b.displayName ?? '') &&
    (a.drone.lastMessageAt ?? '') === (b.drone.lastMessageAt ?? '') &&
    (a.drone.runtime ?? '') === (b.drone.runtime ?? '') &&
    (a.drone.chats ?? []).join('\u0000') === (b.drone.chats ?? []).join('\u0000') &&
    (a.drone.unreadChats ?? []).join('\u0000') === (b.drone.unreadChats ?? []).join('\u0000') &&
    (a.drone.busyChats ?? []).join('\u0000') === (b.drone.busyChats ?? []).join('\u0000') &&
    Boolean(a.drone.busy) === Boolean(b.drone.busy) &&
    a.selected === b.selected &&
    Boolean(a.busy) === Boolean(b.busy) &&
    Boolean(a.approvalRequired) === Boolean(b.approvalRequired) &&
    Boolean(a.disabled) === Boolean(b.disabled) &&
    (a.disabledReason ?? '') === (b.disabledReason ?? '') &&
    a.dragNodeRef === b.dragNodeRef &&
    a.dragAttributes === b.dragAttributes &&
    a.dragListeners === b.dragListeners &&
    Boolean(a.draggable) === Boolean(b.draggable) &&
    Boolean(a.dragging) === Boolean(b.dragging) &&
    Boolean(a.onClone) === Boolean(b.onClone) &&
    Boolean(a.onCreateChat) === Boolean(b.onCreateChat) &&
    Boolean(a.onAddToGroup) === Boolean(b.onAddToGroup) &&
    Boolean(a.onCreateGroup) === Boolean(b.onCreateGroup) &&
    Boolean(a.onRename) === Boolean(b.onRename) &&
    (a.inlineRenameRequestKey ?? 0) === (b.inlineRenameRequestKey ?? 0) &&
    Boolean(a.onSetBaseImage) === Boolean(b.onSetBaseImage) &&
    Boolean(a.onTogglePinned) === Boolean(b.onTogglePinned) &&
    Boolean(a.onDelete) === Boolean(b.onDelete) &&
    Boolean(a.onErrorClick) === Boolean(b.onErrorClick) &&
    Boolean(a.cloneDisabled) === Boolean(b.cloneDisabled) &&
    Boolean(a.createChatDisabled) === Boolean(b.createChatDisabled) &&
    Boolean(a.addToGroupDisabled) === Boolean(b.addToGroupDisabled) &&
    Boolean(a.renameDisabled) === Boolean(b.renameDisabled) &&
    Boolean(a.renameBusy) === Boolean(b.renameBusy) &&
    Boolean(a.setBaseImageDisabled) === Boolean(b.setBaseImageDisabled) &&
    Boolean(a.setBaseImageBusy) === Boolean(b.setBaseImageBusy) &&
    Boolean(a.pinned) === Boolean(b.pinned) &&
    Boolean(a.pinBusy) === Boolean(b.pinBusy) &&
    Boolean(a.deleteDisabled) === Boolean(b.deleteDisabled) &&
    Boolean(a.deleteBusy) === Boolean(b.deleteBusy) &&
    (a.operationLabel ?? '') === (b.operationLabel ?? '') &&
    (a.statusHint ?? '') === (b.statusHint ?? '') &&
    Boolean(a.unreadAgentMessage) === Boolean(b.unreadAgentMessage) &&
    Boolean(a.highlighted) === Boolean(b.highlighted) &&
    Boolean(a.active) === Boolean(b.active) &&
    (a.activeIndicatorStyle ?? 'dot') === (b.activeIndicatorStyle ?? 'dot') &&
    (a.selectionTone ?? 'accent') === (b.selectionTone ?? 'accent') &&
    (a.showSelectionEdge ?? true) === (b.showSelectionEdge ?? true) &&
    (a.density ?? 'default') === (b.density ?? 'default')
  );
}

export const DroneCard = React.memo(function DroneCard({
  drone,
  displayName,
  selected,
  busy,
  approvalRequired,
  disabled,
  disabledReason,
  onClick,
  dragNodeRef,
  dragAttributes,
  dragListeners,
  draggable,
  dragging,
  onClone,
  onCreateChat,
  onAddToGroup,
  onCreateGroup,
  onRename,
  inlineRenameRequestKey,
  onSetBaseImage,
  onTogglePinned,
  onDelete,
  onErrorClick,
  cloneDisabled,
  createChatDisabled,
  addToGroupDisabled,
  renameDisabled,
  renameBusy,
  setBaseImageDisabled,
  setBaseImageBusy,
  pinned,
  pinBusy,
  deleteDisabled,
  deleteBusy,
  operationLabel,
  statusHint,
  unreadAgentMessage,
  highlighted,
  active,
  activeIndicatorStyle,
  leadingIcon,
  selectionTone,
  showSelectionEdge,
  density = 'default',
}: DroneCardProps) {
  const taggedToDo = useDroneHubUiStore((state) => state.toDoDroneIds.includes(drone.id));
  const shortcutBindings = useDroneHubUiStore((state) => state.shortcutBindings);
  const shownName = String(displayName ?? drone.name).trim() || drone.name;
  const canClone = typeof onClone === 'function';
  const canCreateChat = typeof onCreateChat === 'function';
  const canAddToGroup = typeof onAddToGroup === 'function';
  const canCreateGroup = typeof onCreateGroup === 'function';
  const canRename = typeof onRename === 'function';
  const canSetBaseImage = typeof onSetBaseImage === 'function';
  const canTogglePinned = typeof onTogglePinned === 'function';
  const canDelete = typeof onDelete === 'function';
  const hasContextMenuActions =
    canTogglePinned ||
    canClone ||
    canCreateChat ||
    canAddToGroup ||
    canCreateGroup ||
    canRename ||
    canSetBaseImage ||
    canDelete;
  const activeOperationLabel = String(operationLabel ?? '').trim();
  const [actionMenuPosition, setActionMenuPosition] = React.useState<{ x: number; y: number } | null>(null);
  const [inlineRenameOpen, setInlineRenameOpen] = React.useState(false);
  const [inlineRenameValue, setInlineRenameValue] = React.useState('');
  const [inlineRenameError, setInlineRenameError] = React.useState<string | null>(null);
  const [inlineRenamePending, setInlineRenamePending] = React.useState(false);
  const inlineRenameInputRef = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => {
    if (!inlineRenameOpen) return;
    const id = window.requestAnimationFrame(() => {
      inlineRenameInputRef.current?.focus();
      inlineRenameInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [inlineRenameOpen]);
  React.useEffect(() => {
    if (!inlineRenameRequestKey || !onRename || renameDisabled) return;
    setActionMenuPosition(null);
    setInlineRenameValue(shownName);
    setInlineRenameError(null);
    setInlineRenameOpen(true);
  }, [inlineRenameRequestKey]);
  const isDraftDrone = drone.draft === true || drone.hubPhase === 'draft';
  const unread = !isDraftDrone && (Boolean(unreadAgentMessage) || (drone.unreadChats?.length ?? 0) > 0);
  const displayState = sidebarDroneDisplayState(
    drone,
    Boolean(busy),
    activeOperationLabel,
    Boolean(approvalRequired),
  );
  const previousDisplayStateRef = React.useRef<SidebarDroneDisplayState>(displayState);
  const [recentlyBlocked, setRecentlyBlocked] = React.useState(false);
  React.useEffect(() => {
    const previousDisplayState = previousDisplayStateRef.current;
    previousDisplayStateRef.current = displayState;
    if (displayState !== 'blocked') {
      setRecentlyBlocked(false);
      return;
    }
    if (previousDisplayState === 'blocked') return;
    setRecentlyBlocked(true);
    const timeoutId = window.setTimeout(
      () => setRecentlyBlocked(false),
      RECENT_BLOCKED_EMPHASIS_MS,
    );
    return () => window.clearTimeout(timeoutId);
  }, [displayState]);
  const stateLabel = sidebarDroneStateLabel(displayState, unread);
  const showActiveIndicator = Boolean(active) && !unread;
  const renderActiveEdge = showActiveIndicator && activeIndicatorStyle === 'edge';
  const errText = String(drone.hubMessage ?? drone.statusError ?? '').trim();
  const canOpenInlineError = displayState === 'blocked' && Boolean(errText) && typeof onErrorClick === 'function';
  const selectedTone = selectionTone === 'muted' ? 'muted' : 'accent';
  const renderSelectionEdge = showSelectionEdge !== false;
  const rowDensityClass =
    density === 'compact'
      ? 'h-6 px-1'
      : density === 'comfortable'
        ? 'h-8 px-2'
        : 'h-7 px-1.5';
  const titleDensityClass =
    density === 'compact'
      ? 'text-[var(--sidebar-drone-compact-size)]'
      : density === 'comfortable'
        ? 'text-[var(--sidebar-drone-comfortable-size)]'
        : 'text-[var(--sidebar-drone-size)]';
  const stopCardSelection = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const stopActionPressPropagation = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };
  const submitInlineRename = async () => {
    if (!onRename || inlineRenamePending) return;
    const nextName = inlineRenameValue.trim();
    if (!nextName) {
      setInlineRenameError('Name is required.');
      return;
    }
    if (nextName === shownName) {
      setInlineRenameOpen(false);
      setInlineRenameError(null);
      return;
    }
    setInlineRenamePending(true);
    setInlineRenameError(null);
    try {
      const result = await onRename(nextName);
      const ok =
        typeof result === 'object' && result !== null && 'ok' in result
          ? result.ok
          : result !== false;
      if (!ok) {
        const error =
          typeof result === 'object' && result !== null && 'error' in result
            ? String(result.error ?? '').trim()
            : '';
        setInlineRenameError(error || 'Rename failed.');
        return;
      }
      setInlineRenameOpen(false);
    } catch (error: any) {
      setInlineRenameError(String(error?.message ?? error ?? '').trim() || 'Rename failed.');
    } finally {
      setInlineRenamePending(false);
    }
  };
  const actionMenuItems: SidebarContextMenuItem[] = [];
  if (canTogglePinned) {
    actionMenuItems.push({
      id: 'pin',
      label: pinned ? 'Unpin from top' : 'Pin to top',
      shortcut: shortcutBindings.toggleSelectedDronePinned
        ? formatShortcutBinding(shortcutBindings.toggleSelectedDronePinned)
        : undefined,
      icon: pinBusy ? (
        <IconSpinner className="h-3.5 w-3.5 text-[var(--accent)]" />
      ) : (
        <IconPin className="h-3.5 w-3.5 text-[var(--accent)]" filled={Boolean(pinned)} />
      ),
      disabled: Boolean(pinBusy),
      onSelect: () => onTogglePinned?.(),
    });
  }
  if (canCreateChat) {
    actionMenuItems.push({
      id: 'create-chat',
      label: 'Create chat',
      shortcut: shortcutBindings.createDroneChat
        ? formatShortcutBinding(shortcutBindings.createDroneChat)
        : undefined,
      separatorBefore: actionMenuItems.length > 0,
      icon: <IconPlus className="h-3.5 w-3.5 text-[var(--accent)]" />,
      disabled: Boolean(createChatDisabled),
      onSelect: () => onCreateChat?.(),
    });
  }
  if (canAddToGroup) {
    actionMenuItems.push({
      id: 'add-to-group',
      label: 'Add to group',
      separatorBefore: canTogglePinned && !canCreateChat,
      icon: <IconFolder className="h-3.5 w-3.5 text-[var(--accent)]" />,
      disabled: Boolean(addToGroupDisabled),
      onSelect: () => onAddToGroup?.(),
    });
  }
  if (canCreateGroup) {
    actionMenuItems.push({
      id: 'new-group',
      label: 'New group',
      shortcut: shortcutBindings.createDraftGroup
        ? formatShortcutBinding(shortcutBindings.createDraftGroup)
        : undefined,
      separatorBefore: canTogglePinned && !canCreateChat && !canAddToGroup,
      icon: <IconPlus className="h-3.5 w-3.5 text-[var(--accent)]" />,
      onSelect: () => onCreateGroup?.(),
    });
  }
  if (canClone) {
    actionMenuItems.push({
      id: 'clone',
      label: 'Clone drone',
      separatorBefore: actionMenuItems.length > 0,
      icon: <IconClone className="h-3.5 w-3.5 text-[var(--accent)]" />,
      disabled: Boolean(cloneDisabled),
      onSelect: () => onClone?.(),
    });
  }
  if (canRename) {
    actionMenuItems.push({
      id: 'rename',
      label: 'Rename',
      shortcut: 'F2',
      separatorBefore: !canClone && actionMenuItems.length > 0,
      icon: renameBusy ? (
        <IconSpinner className="h-3.5 w-3.5 text-[var(--info)]" />
      ) : (
        <IconRename className="h-3.5 w-3.5 text-[var(--info)]" />
      ),
      disabled: Boolean(renameDisabled),
      onSelect: () => {
        setInlineRenameValue(shownName);
        setInlineRenameError(null);
        setInlineRenameOpen(true);
      },
    });
  }
  if (canSetBaseImage) {
    actionMenuItems.push({
      id: 'set-base-image',
      label: 'Set as base image',
      separatorBefore: !canClone && !canRename && actionMenuItems.length > 0,
      icon: setBaseImageBusy ? (
        <IconSpinner className="h-3.5 w-3.5 text-[var(--yellow)]" />
      ) : (
        <IconBaseImage className="h-3.5 w-3.5 text-[var(--yellow)]" />
      ),
      disabled: Boolean(setBaseImageDisabled),
      onSelect: () => onSetBaseImage?.(),
    });
  }
  if (canDelete) {
    actionMenuItems.push({
      id: 'delete',
      label: 'Delete drone',
      shortcut: 'Delete',
      separatorBefore: actionMenuItems.length > 0,
      icon: deleteBusy ? (
        <IconSpinner className="h-3.5 w-3.5" />
      ) : (
        <IconTrash className="h-3.5 w-3.5" />
      ),
      disabled: Boolean(deleteDisabled) || Boolean(deleteBusy),
      tone: 'danger',
      onSelect: () => onDelete?.(),
    });
  }
  return (
    <div
      ref={dragNodeRef}
      data-onboarding-id="sidebar.droneCard"
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      title={disabled ? disabledReason : undefined}
      {...dragAttributes}
      {...dragListeners}
      onClick={(e) => {
        if (disabled) return;
        onClick({ toggle: e.metaKey || e.ctrlKey, range: e.shiftKey });
      }}
      onContextMenu={(event) => {
        if (disabled || !hasContextMenuActions) return;
        event.preventDefault();
        event.stopPropagation();
        setActionMenuPosition({ x: event.clientX, y: event.clientY });
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.target !== e.currentTarget) return;
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onClick();
        }
      }}
      className={`dh-sidebar-row-interactive ${highlighted ? 'dh-sidebar-row-highlighted' : ''} w-full text-left ${rowDensityClass} flex items-center rounded-[var(--sidebar-row-radius)] border transition-colors duration-150 group/drone relative ${
        highlighted
          ? 'bg-[var(--yellow-subtle)] border-[var(--yellow-border)]'
          : selected
          ? selectedTone === 'muted'
            ? 'border-transparent'
            : 'dh-sidebar-row-selected border-[var(--sidebar-row-selected-border)]'
          : renderActiveEdge
            ? 'dh-sidebar-row-selected border-transparent'
            : 'border-transparent'
      } ${draggable ? 'cursor-grab touch-none active:cursor-grabbing' : ''} ${
        dragging ? 'opacity-35' : ''
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''} ${
        highlighted ? 'shadow-[var(--glow-yellow)]' : ''
      } focus:outline-none`}
    >
      {/* Accent edge for selected state or open-chat state when requested */}
      {(selected && renderSelectionEdge) || renderActiveEdge ? (
        <div className={sidebarSelectionEdgeClass} />
      ) : null}

      <div
        className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch"
        style={taggedToDo ? { paddingRight: '3rem' } : undefined}
      >
        {leadingIcon ? <span className="inline-flex flex-shrink-0 items-center">{leadingIcon}</span> : null}
        {isDraftDrone ? (
          <span
            className="inline-flex h-3 w-3 flex-shrink-0"
            data-sidebar-state-spacer="draft"
            aria-hidden="true"
          />
        ) : canOpenInlineError ? (
          <button
            type="button"
            onClick={(e) => {
              stopCardSelection(e);
              onErrorClick?.(drone, errText);
            }}
            onMouseDown={stopActionPressPropagation}
            onPointerDown={stopActionPressPropagation}
            className="inline-flex flex-shrink-0 rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--red)]"
            title={`${stateLabel}: view full error details`}
            aria-label={`${stateLabel}: view full error details`}
          >
            <SidebarItemStateIndicator
              state={displayState}
              unread={unread}
              showReadyAnchor
              emphasized={recentlyBlocked || selected || Boolean(active) || Boolean(highlighted)}
            />
          </button>
        ) : (
          <span
            role="img"
            className="inline-flex flex-shrink-0"
            title={errText || stateLabel}
            aria-label={stateLabel}
          >
            <SidebarItemStateIndicator
              state={displayState}
              unread={unread}
              showReadyAnchor
              emphasized={recentlyBlocked || selected || Boolean(active) || Boolean(highlighted)}
            />
          </span>
        )}
        {showActiveIndicator && !renderActiveEdge ? (
          <span
            role="img"
            className="inline-flex h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--accent)]"
            title="Open chat"
            aria-label="Open chat"
          />
        ) : null}
        {inlineRenameOpen ? (
          <input
            ref={inlineRenameInputRef}
            value={inlineRenameValue}
            onChange={(event) => {
              setInlineRenameValue(event.target.value);
              setInlineRenameError(null);
            }}
            onBlur={() => {
              setInlineRenameOpen(false);
              setInlineRenameError(null);
            }}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') {
                event.preventDefault();
                void submitInlineRename();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setInlineRenameOpen(false);
                setInlineRenameError(null);
              }
            }}
            readOnly={inlineRenamePending}
            maxLength={80}
            aria-label="Drone name"
            aria-invalid={Boolean(inlineRenameError)}
            title={inlineRenameError || 'Rename drone'}
            className={`min-w-0 flex-1 appearance-none rounded-none border-0 bg-transparent p-0 leading-tight shadow-none outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 ${
              inlineRenameError ? 'text-[var(--red)]' : sidebarItemTypeClass(selected)
            } ${titleDensityClass}`}
            style={{ border: 0, outline: 'none', boxShadow: 'none' }}
          />
        ) : (
          <span
            className={`min-w-0 flex-1 truncate leading-tight ${titleDensityClass} ${sidebarItemTypeClass(selected)}`}
            title={`${shownName}${shownName !== drone.name ? ` (${drone.name})` : ''} · ${stateLabel} · created ${timeAgo(drone.createdAt)}`}
          >
            {shownName}
          </span>
        )}
        {isDraftDrone ? (
          <span
            className="inline-flex flex-shrink-0 items-center rounded-[3px] bg-[var(--accent-subtle)] px-1 py-0.5 text-[var(--text-8)] font-[var(--weight-semibold)] normal-case leading-none tracking-[0.02em] text-[var(--accent)]"
            style={{ fontFamily: 'var(--display)' }}
            title="Draft drone · queued messages run after publishing"
            aria-label="Draft drone"
          >
            Draft
          </span>
        ) : null}
        {statusHint ? (
          <span
            className="flex-shrink-0 rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-1 py-0.5 text-[var(--text-8)] font-[var(--weight-semibold)] leading-none tracking-wide uppercase text-[var(--muted-dim)]"
            title={statusHint}
          >
            {statusHint}
          </span>
        ) : null}
      </div>

      {taggedToDo ? (
        <span
          data-sidebar-drone-label="to-do"
          className="pointer-events-none absolute right-1 top-1/2 inline-flex -translate-y-1/2 items-center rounded-[3px] border border-[var(--yellow-border)] bg-[var(--yellow-subtle)] px-1 py-px text-[.5rem] font-[var(--weight-semibold)] uppercase leading-none tracking-[0.03em] text-[var(--yellow)] opacity-70"
          aria-label="TODO"
        >
          TODO
        </span>
      ) : null}

      {actionMenuPosition ? (
        <SidebarContextMenu
          x={actionMenuPosition.x}
          y={actionMenuPosition.y}
          label={`Actions for ${shownName}`}
          items={actionMenuItems}
          onClose={() => setActionMenuPosition(null)}
        />
      ) : null}
    </div>
  );
}, areDroneCardPropsEqual);
