import React from 'react';
import { timeAgo } from '../../domain';
import type { DroneSummary } from '../types';
import { RelativeTimeText } from '../chat/RelativeTimeText';
import {
  chooseDropdownVerticalPlacement,
  dropdownMenuItemBaseClass,
  dropdownPanelBaseClass,
  dropdownViewportBounds,
  type DropdownVerticalPlacement,
  useDropdownDismiss,
} from '../../ui/dropdown';
import {
  IconBaseImage,
  IconClone,
  IconFolder,
  IconMore,
  IconPin,
  IconPlus,
  IconRename,
  IconSpinner,
  IconTrash,
} from './icons';
import type { SidebarDensityMode } from '../app/settings-types';
import { sidebarItemTypeClass, sidebarSelectionEdgeClass } from '../sidebar/presentation';

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
  onRename?: () => void;
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
}: {
  state: SidebarDroneDisplayState;
  unread?: boolean;
  showReadyAnchor?: boolean;
}) {
  const ready = state === 'idle' && !unread;
  const working = state === 'working' || state === 'starting' || state === 'archiving' || state === 'deleting';
  const approvalRequired = state === 'approval';
  const indicatorToneClass =
    unread && state === 'idle'
      ? 'bg-[var(--green)]'
      : state === 'waiting'
        ? 'bg-[var(--info)]'
        : state === 'blocked' || state === 'offline'
          ? 'bg-[var(--red)]'
          : 'bg-[var(--muted)]';
  return (
    <span className="inline-flex h-3 w-3 flex-shrink-0 self-center items-center justify-center leading-none" aria-hidden="true">
      {ready ? (
        showReadyAnchor ? (
          <span
            data-sidebar-ready-anchor="true"
            className="h-1.5 w-1.5 rounded-full border border-[var(--muted-dim)] opacity-35"
          />
        ) : null
      ) : working ? (
        <SidebarWorkingStatusIndicator />
      ) : approvalRequired ? (
        <SidebarApprovalStatusIndicator />
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
    Boolean(a.onRename) === Boolean(b.onRename) &&
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
  onRename,
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
  const shownName = String(displayName ?? drone.name).trim() || drone.name;
  const canClone = typeof onClone === 'function';
  const canCreateChat = typeof onCreateChat === 'function';
  const canAddToGroup = typeof onAddToGroup === 'function';
  const canRename = typeof onRename === 'function';
  const canSetBaseImage = typeof onSetBaseImage === 'function';
  const canTogglePinned = typeof onTogglePinned === 'function';
  const canDelete = typeof onDelete === 'function';
  const hasSecondaryActions = canTogglePinned || canClone || canCreateChat || canAddToGroup || canRename || canSetBaseImage;
  const hasActions = hasSecondaryActions || canDelete;
  const activeOperationLabel = String(operationLabel ?? '').trim();
  const pinActionsVisible = Boolean(pinBusy) || Boolean(renameBusy) || Boolean(setBaseImageBusy) || Boolean(deleteBusy);
  const actionMenuRef = React.useRef<HTMLDivElement | null>(null);
  const actionMenuPanelRef = React.useRef<HTMLDivElement | null>(null);
  const [actionMenuOpen, setActionMenuOpen] = React.useState(false);
  const [actionMenuPlacement, setActionMenuPlacement] =
    React.useState<DropdownVerticalPlacement>('below');
  useDropdownDismiss(actionMenuRef, actionMenuOpen, setActionMenuOpen);
  React.useLayoutEffect(() => {
    if (!actionMenuOpen) return;

    const updatePlacement = () => {
      const anchor = actionMenuRef.current;
      const panel = actionMenuPanelRef.current;
      if (!anchor || !panel) return;
      const anchorRect = anchor.getBoundingClientRect();
      const viewport = dropdownViewportBounds(anchor);
      const nextPlacement = chooseDropdownVerticalPlacement({
        anchorTop: anchorRect.top,
        anchorBottom: anchorRect.bottom,
        panelHeight: panel.getBoundingClientRect().height,
        viewportTop: viewport.top,
        viewportBottom: viewport.bottom,
      });
      setActionMenuPlacement((current) =>
        current === nextPlacement ? current : nextPlacement,
      );
    };

    updatePlacement();
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    return () => {
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
    };
  }, [actionMenuOpen]);
  const isDraftDrone = drone.draft === true || drone.hubPhase === 'draft';
  const unread = !isDraftDrone && (Boolean(unreadAgentMessage) || (drone.unreadChats?.length ?? 0) > 0);
  const displayState = sidebarDroneDisplayState(
    drone,
    Boolean(busy),
    activeOperationLabel,
    Boolean(approvalRequired),
  );
  const stateLabel = sidebarDroneStateLabel(displayState, unread);
  const showActiveIndicator = Boolean(active) && !unread;
  const renderActiveEdge = showActiveIndicator && activeIndicatorStyle === 'edge';
  const errText = String(drone.hubMessage ?? drone.statusError ?? '').trim();
  const canOpenInlineError = displayState === 'blocked' && Boolean(errText) && typeof onErrorClick === 'function';
  const selectedTone = selectionTone === 'muted' ? 'muted' : 'accent';
  const renderSelectionEdge = showSelectionEdge !== false;
  const rowDensityClass =
    density === 'compact'
      ? 'min-h-[42px] py-1 pl-1 pr-1'
      : density === 'comfortable'
        ? 'min-h-[52px] py-2 pl-2 pr-1.5'
        : 'min-h-[48px] py-1.5 pl-1.5 pr-1.5';
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
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.target !== e.currentTarget) return;
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onClick();
        }
      }}
      className={`dh-sidebar-row-interactive ${highlighted ? 'dh-sidebar-row-highlighted' : ''} ${actionMenuOpen ? 'z-50' : ''} w-full text-left ${rowDensityClass} flex items-center rounded-[var(--sidebar-row-radius)] border transition-colors duration-150 group/drone relative ${
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
        className={`flex min-w-0 flex-1 items-center gap-1.5 self-stretch ${
          hasActions
            ? 'transition-[padding] duration-150 group-hover/drone:pr-12 group-focus-within/drone:pr-12'
            : ''
        } ${pinActionsVisible || actionMenuOpen ? 'pr-12' : ''}`}
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
            <SidebarItemStateIndicator state={displayState} unread={unread} showReadyAnchor />
          </button>
        ) : (
          <span
            role="img"
            className="inline-flex flex-shrink-0"
            title={errText || stateLabel}
            aria-label={stateLabel}
          >
            <SidebarItemStateIndicator state={displayState} unread={unread} showReadyAnchor />
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
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-[3px]">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={`min-w-0 flex-1 truncate leading-tight ${titleDensityClass} ${sidebarItemTypeClass(selected)}`}
              title={`${shownName}${shownName !== drone.name ? ` (${drone.name})` : ''} · created ${timeAgo(drone.createdAt)}`}
            >
              {shownName}
            </span>
            {statusHint ? (
              <span
                className="flex-shrink-0 rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-1 py-0.5 text-[var(--text-9)] font-[var(--weight-semibold)] tracking-wide uppercase text-[var(--muted-dim)]"
                title={statusHint}
              >
                {statusHint}
              </span>
            ) : null}
          </div>
          <div
            data-sidebar-drone-metadata="true"
            className="flex min-w-0 items-center gap-1.5 text-[.5625rem] font-normal leading-none text-[var(--sidebar-meta-fg)]"
          >
            {isDraftDrone ? (
              <span
                className="inline-flex flex-shrink-0 items-center rounded-[3px] bg-[var(--accent-subtle)] px-1.5 py-[3px] font-[var(--weight-semibold)] normal-case tracking-[0.02em] text-[var(--accent)]"
                style={{ fontFamily: 'var(--display)' }}
                title="Draft drone · queued messages run after publishing"
                aria-label="Draft drone"
              >
                Draft
              </span>
            ) : (
              <>
                <span className="min-w-0 truncate">{stateLabel}</span>
                {drone.lastMessageAt ? (
                  <>
                    <span className="opacity-55" aria-hidden="true">·</span>
                    <RelativeTimeText
                      at={drone.lastMessageAt}
                      compact
                      className="flex-shrink-0 font-mono"
                      title={`Last message ${timeAgo(drone.lastMessageAt)}`}
                    />
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>

      {hasActions ? (
        <div
          ref={actionMenuRef}
          data-onboarding-id="sidebar.droneCard.actions"
          className={`absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1 transition-opacity duration-150 ${
            pinActionsVisible || actionMenuOpen
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 pointer-events-none group-hover/drone:opacity-100 group-hover/drone:pointer-events-auto group-focus-within/drone:opacity-100 group-focus-within/drone:pointer-events-auto'
          }`}
        >
          {canDelete ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDelete?.();
              }}
              onMouseDown={stopActionPressPropagation}
              onPointerDown={stopActionPressPropagation}
              disabled={Boolean(deleteDisabled)}
              aria-busy={Boolean(deleteBusy)}
              className={`inline-flex h-5 w-5 items-center justify-center rounded border transition-colors ${
                deleteDisabled
                  ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted-dim)] opacity-50'
                  : 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)] hover:bg-[var(--danger-panel)]'
              }`}
              title={deleteBusy ? `Deleting "${shownName}"…` : `Delete "${shownName}"`}
              aria-label={deleteBusy ? `Deleting "${shownName}"` : `Delete "${shownName}"`}
            >
              {deleteBusy ? <IconSpinner className="h-3 w-3" /> : <IconTrash className="h-3 w-3" />}
            </button>
          ) : null}
          {hasSecondaryActions ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setActionMenuOpen((open) => !open);
              }}
              onMouseDown={stopActionPressPropagation}
              onPointerDown={stopActionPressPropagation}
              className={`inline-flex h-5 w-5 items-center justify-center rounded border transition-colors ${
                actionMenuOpen
                  ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                  : 'border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)]'
              }`}
              title={`More actions for "${shownName}"`}
              aria-label={`More actions for "${shownName}"`}
              aria-haspopup="menu"
              aria-expanded={actionMenuOpen}
            >
              {renameBusy || setBaseImageBusy ? (
                <IconSpinner className="h-3 w-3" />
              ) : (
                <IconMore className="h-3 w-3" />
              )}
            </button>
          ) : null}
          {hasSecondaryActions && actionMenuOpen ? (
            <div
              ref={actionMenuPanelRef}
              className={`absolute right-0 z-50 w-[11.5rem] ${
                actionMenuPlacement === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'
              } ${dropdownPanelBaseClass}`}
              role="menu"
              aria-label={`Actions for ${shownName}`}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={stopActionPressPropagation}
              onPointerDown={stopActionPressPropagation}
            >
              <div className="py-1">
                {canTogglePinned ? (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={Boolean(pinBusy)}
                    onClick={(event) => {
                      event.stopPropagation();
                      setActionMenuOpen(false);
                      onTogglePinned?.();
                    }}
                    className={`${dropdownMenuItemBaseClass} flex items-center gap-2 text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-45`}
                  >
                    {pinBusy ? <IconSpinner className="h-3.5 w-3.5 text-[var(--accent)]" /> : <IconPin className="h-3.5 w-3.5 text-[var(--accent)]" filled={Boolean(pinned)} />}
                    <span>{pinned ? 'Unpin from top' : 'Pin to top'}</span>
                  </button>
                ) : null}
                {canCreateChat ? (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={Boolean(createChatDisabled)}
                    onClick={(event) => {
                      event.stopPropagation();
                      setActionMenuOpen(false);
                      onCreateChat?.();
                    }}
                    className={`${dropdownMenuItemBaseClass} flex items-center gap-2 text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-45`}
                  >
                    <IconPlus className="h-3.5 w-3.5 text-[var(--accent)]" />
                    <span>Create chat</span>
                  </button>
                ) : null}
                {canAddToGroup ? (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={Boolean(addToGroupDisabled)}
                    onClick={(event) => {
                      event.stopPropagation();
                      setActionMenuOpen(false);
                      onAddToGroup?.();
                    }}
                    className={`${dropdownMenuItemBaseClass} flex items-center gap-2 text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-45`}
                  >
                    <IconFolder className="h-3.5 w-3.5 text-[var(--accent)]" />
                    <span>Add to group</span>
                  </button>
                ) : null}
                {canClone ? (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={Boolean(cloneDisabled)}
                    onClick={(event) => {
                      event.stopPropagation();
                      setActionMenuOpen(false);
                      onClone?.();
                    }}
                    className={`${dropdownMenuItemBaseClass} flex items-center gap-2 text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-45`}
                  >
                    <IconClone className="h-3.5 w-3.5 text-[var(--accent)]" />
                    <span>Clone drone</span>
                  </button>
                ) : null}
                {canRename ? (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={Boolean(renameDisabled)}
                    onClick={(event) => {
                      event.stopPropagation();
                      setActionMenuOpen(false);
                      onRename?.();
                    }}
                    className={`${dropdownMenuItemBaseClass} flex items-center gap-2 text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-45`}
                  >
                    {renameBusy ? <IconSpinner className="h-3.5 w-3.5 text-[var(--info)]" /> : <IconRename className="h-3.5 w-3.5 text-[var(--info)]" />}
                    <span>Rename</span>
                  </button>
                ) : null}
                {canSetBaseImage ? (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={Boolean(setBaseImageDisabled)}
                    onClick={(event) => {
                      event.stopPropagation();
                      setActionMenuOpen(false);
                      onSetBaseImage?.();
                    }}
                    className={`${dropdownMenuItemBaseClass} flex items-center gap-2 text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-45`}
                  >
                    {setBaseImageBusy ? <IconSpinner className="h-3.5 w-3.5 text-[var(--yellow)]" /> : <IconBaseImage className="h-3.5 w-3.5 text-[var(--yellow)]" />}
                    <span>Set as base image</span>
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}, areDroneCardPropsEqual);
