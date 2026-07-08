import React from 'react';
import { timeAgo } from '../../domain';
import type { DroneSummary } from '../types';
import { IconBaseImage, IconClone, IconPlus, IconRename, IconSpinner, IconTrash, TypingDots } from './icons';
import { StatusBadge } from './StatusBadge';
import type { SidebarDensityMode } from '../app/settings-types';

type DroneCardProps = {
  drone: DroneSummary;
  displayName?: string;
  selected: boolean;
  busy?: boolean;
  onClick: (opts?: { toggle?: boolean; range?: boolean }) => void;
  dragNodeRef?: React.Ref<HTMLDivElement>;
  dragAttributes?: Record<string, any>;
  dragListeners?: Record<string, any>;
  draggable?: boolean;
  dragging?: boolean;
  onClone?: () => void;
  onCreateChat?: () => void;
  onRename?: () => void;
  onSetBaseImage?: () => void;
  onDelete?: () => void;
  onErrorClick?: (drone: DroneSummary, message: string) => void;
  cloneDisabled?: boolean;
  createChatDisabled?: boolean;
  renameDisabled?: boolean;
  renameBusy?: boolean;
  setBaseImageDisabled?: boolean;
  setBaseImageBusy?: boolean;
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
    a.selected === b.selected &&
    Boolean(a.busy) === Boolean(b.busy) &&
    a.dragNodeRef === b.dragNodeRef &&
    a.dragAttributes === b.dragAttributes &&
    a.dragListeners === b.dragListeners &&
    Boolean(a.draggable) === Boolean(b.draggable) &&
    Boolean(a.dragging) === Boolean(b.dragging) &&
    Boolean(a.cloneDisabled) === Boolean(b.cloneDisabled) &&
    Boolean(a.createChatDisabled) === Boolean(b.createChatDisabled) &&
    Boolean(a.renameDisabled) === Boolean(b.renameDisabled) &&
    Boolean(a.renameBusy) === Boolean(b.renameBusy) &&
    Boolean(a.setBaseImageDisabled) === Boolean(b.setBaseImageDisabled) &&
    Boolean(a.setBaseImageBusy) === Boolean(b.setBaseImageBusy) &&
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
  onClick,
  dragNodeRef,
  dragAttributes,
  dragListeners,
  draggable,
  dragging,
  onClone,
  onCreateChat,
  onRename,
  onSetBaseImage,
  onDelete,
  onErrorClick,
  cloneDisabled,
  createChatDisabled,
  renameDisabled,
  renameBusy,
  setBaseImageDisabled,
  setBaseImageBusy,
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
  const canRename = typeof onRename === 'function';
  const canSetBaseImage = typeof onSetBaseImage === 'function';
  const canDelete = typeof onDelete === 'function';
  const actionCount = Number(canClone) + Number(canCreateChat) + Number(canRename) + Number(canSetBaseImage) + Number(canDelete);
  const hasActions = canClone || canCreateChat || canRename || canSetBaseImage || canDelete;
  const activeOperationLabel = String(operationLabel ?? '').trim();
  const showOperationStatus = Boolean(activeOperationLabel);
  const pinActionsVisible = Boolean(renameBusy) || Boolean(setBaseImageBusy) || (Boolean(deleteBusy) && !showOperationStatus);
  const actionReserveWidthClass =
    actionCount >= 5
      ? 'min-w-[116px]'
      : actionCount === 4
        ? 'min-w-[92px]'
      : actionCount === 3
        ? 'min-w-[68px]'
        : actionCount === 2
          ? 'min-w-[44px]'
          : actionCount === 1
            ? 'min-w-[20px]'
            : '';
  const showRespondingAsStatus = Boolean(busy) && Boolean(drone.statusOk) && drone.hubPhase !== 'error';
  const isStarting = drone.hubPhase === 'creating' || drone.hubPhase === 'starting' || drone.hubPhase === 'seeding';
  const showsTrailingStatus =
    showRespondingAsStatus ||
    showOperationStatus ||
    isStarting ||
    drone.hubPhase === 'error' ||
    !drone.statusOk;
  const showUnreadIndicator =
    Boolean(unreadAgentMessage) && !isStarting && !showRespondingAsStatus;
  const showActiveIndicator = Boolean(active) && !showUnreadIndicator;
  const renderActiveEdge = showActiveIndicator && activeIndicatorStyle === 'edge';
  const errText = String(drone.hubMessage ?? drone.statusError ?? '').trim();
  const showInlineError = drone.hubPhase === 'error' && Boolean(errText);
  const canOpenInlineError = showInlineError && typeof onErrorClick === 'function';
  const selectedTone = selectionTone === 'muted' ? 'muted' : 'accent';
  const renderSelectionEdge = showSelectionEdge !== false;
  const rowDensityClass =
    density === 'compact'
      ? 'min-h-[25px] px-2'
      : density === 'comfortable'
        ? 'min-h-[31px] px-3'
        : 'h-7 px-2.5';
  const titleDensityClass =
    density === 'compact'
      ? 'text-[11px]'
      : density === 'comfortable'
        ? 'text-[12.5px]'
        : 'text-[12px]';
  const stopCardSelection = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div
      ref={dragNodeRef}
      data-onboarding-id="sidebar.droneCard"
      role="button"
      tabIndex={0}
      {...dragAttributes}
      {...dragListeners}
      onClick={(e) => onClick({ toggle: e.metaKey || e.ctrlKey, range: e.shiftKey })}
      onKeyDown={(e) => {
        if (e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={`w-full text-left ${rowDensityClass} flex items-center rounded-md border transition-colors duration-150 group/drone relative ${
        selected
          ? selectedTone === 'muted'
            ? 'bg-[rgba(255,255,255,.045)] border-[rgba(255,255,255,.08)]'
            : 'bg-[var(--selected)] border-[var(--accent-muted)]'
          : highlighted
            ? 'bg-[rgba(255,214,102,.10)] border-[rgba(255,214,102,.62)]'
            : 'border-transparent hover:bg-[rgba(255,255,255,.03)] hover:border-[rgba(255,255,255,.06)]'
      } ${draggable ? 'cursor-grab touch-none active:cursor-grabbing' : ''} ${
        dragging ? 'opacity-35' : ''
      } ${
        highlighted ? 'shadow-[0_0_0_1px_rgba(255,214,102,.28),0_0_18px_rgba(255,214,102,.14)]' : ''
      } focus:outline-none focus-visible:outline-none`}
    >
      {/* Accent edge for selected state or open-chat state when requested */}
      {(selected && renderSelectionEdge) || renderActiveEdge ? (
        <div className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-[var(--accent)]" />
      ) : null}

      {/* Single row: name … status/actions */}
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        {leadingIcon ? <span className="inline-flex flex-shrink-0 items-center">{leadingIcon}</span> : null}
        {showUnreadIndicator ? (
          <span
            className="inline-flex h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--yellow)]"
            title="Unread agent message"
            aria-label="Unread agent message"
          />
        ) : showActiveIndicator && !renderActiveEdge ? (
          <span
            className="inline-flex h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--accent)]"
            title="Open chat"
            aria-label="Open chat"
          />
        ) : null}
        <span
          className={`flex-1 min-w-0 truncate ${titleDensityClass} ${selected ? 'font-medium text-[var(--fg)]' : 'text-[var(--fg-secondary)]'}`}
          title={`${shownName}${shownName !== drone.name ? ` (${drone.name})` : ''} · created ${timeAgo(drone.createdAt)}`}
        >
          {shownName}
        </span>
        {statusHint ? (
          <span
            className="flex-shrink-0 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-1 py-0.5 text-[9px] font-semibold tracking-wide uppercase text-[var(--muted-dim)]"
            style={{ fontFamily: 'var(--display)' }}
            title={statusHint}
          >
            {statusHint}
          </span>
        ) : null}
      </div>

      <div className="flex-shrink-0 ml-1.5 flex items-center gap-1 min-w-0">
        {showInlineError ? (
          canOpenInlineError ? (
            <button
              type="button"
              onClick={(e) => {
                stopCardSelection(e);
                onErrorClick?.(drone, errText);
              }}
              onMouseDown={stopCardSelection}
              onPointerDown={stopCardSelection}
              className="text-[10px] text-[var(--red)] truncate max-w-[72px] hover:underline focus:outline-none"
              title="View full error details"
              aria-label={`View error details for ${shownName}`}
            >
              error
            </button>
          ) : (
            <span className="text-[10px] text-[var(--red)] truncate max-w-[72px]" title={errText}>error</span>
          )
        ) : null}
        <div
          className={`relative flex items-center justify-end ${
            pinActionsVisible ? actionReserveWidthClass : hasActions && !showsTrailingStatus ? 'w-0' : ''
          }`}
        >
          <div
            className={
              hasActions
                ? `transition-opacity duration-150 ${
                    pinActionsVisible ? 'opacity-0 pointer-events-none' : 'group-hover/drone:opacity-0 group-hover/drone:pointer-events-none'
                  }`
                : ''
            }
          >
            {showInlineError ? null : showOperationStatus ? (
              <span
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide uppercase bg-[var(--yellow-subtle)] text-[var(--yellow)] border border-[rgba(255,178,36,.15)]"
                style={{ fontFamily: 'var(--display)' }}
                title={activeOperationLabel}
                aria-label={activeOperationLabel}
              >
                <TypingDots color="var(--yellow)" />
                {activeOperationLabel}
              </span>
            ) : showRespondingAsStatus ? (
              <span className="inline-flex items-center" title="Agent responding"><TypingDots color="var(--yellow)" /></span>
            ) : (
              <StatusBadge
                ok={drone.statusOk}
                error={drone.statusError}
                checking={drone.statusChecking}
                hubPhase={drone.hubPhase}
                hubMessage={drone.hubMessage}
              />
            )}
          </div>
          {hasActions && (
            <div
              data-onboarding-id="sidebar.droneCard.actions"
              className={`absolute right-0 z-10 flex items-center gap-1 rounded-md border border-[rgba(255,255,255,.08)] py-0.5 pl-3 pr-0.5 shadow-[0_4px_12px_rgba(0,0,0,.28)] transition-opacity duration-150 before:absolute before:inset-y-0 before:-left-5 before:w-5 before:bg-gradient-to-l before:from-[rgb(19,25,34)] before:to-transparent ${
                pinActionsVisible
                  ? 'opacity-100 pointer-events-auto'
                  : 'opacity-0 pointer-events-none group-hover/drone:opacity-100 group-hover/drone:pointer-events-auto'
              } ${
                selected
                  ? 'bg-[rgb(30,26,43)] before:from-[rgb(30,26,43)]'
                  : 'bg-[rgb(19,25,34)] before:from-[rgb(19,25,34)]'
              }`}
            >
              {canCreateChat && (
                <button
                  type="button"
                  onClick={(e) => { stopCardSelection(e); onCreateChat?.(); }}
                  onMouseDown={stopCardSelection}
                  onPointerDown={stopCardSelection}
                  disabled={Boolean(createChatDisabled)}
                  className={`inline-flex items-center justify-center w-5 h-5 rounded border transition-colors ${
                    createChatDisabled
                      ? 'opacity-50 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                      : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)]'
                  }`}
                  title={`Create chat on "${shownName}"`}
                  aria-label={`Create chat on "${shownName}"`}
                >
                  <IconPlus className="opacity-90" />
                </button>
              )}
              {canClone && (
                <button
                  type="button"
                  onClick={(e) => { stopCardSelection(e); onClone(); }}
                  onMouseDown={stopCardSelection}
                  onPointerDown={stopCardSelection}
                  disabled={Boolean(cloneDisabled)}
                  className={`inline-flex items-center justify-center w-5 h-5 rounded border transition-colors ${
                    cloneDisabled
                      ? 'opacity-50 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                      : 'bg-[var(--accent-subtle)] border-[var(--accent-muted)] text-[var(--accent)] hover:shadow-[var(--glow-accent)]'
                  }`}
                  title={`Clone "${shownName}"`}
                  aria-label={`Clone "${shownName}"`}
                >
                  <IconClone className="opacity-90" />
                </button>
              )}
              {canRename && (
                <button
                  type="button"
                  onClick={(e) => { stopCardSelection(e); onRename?.(); }}
                  onMouseDown={stopCardSelection}
                  onPointerDown={stopCardSelection}
                  disabled={Boolean(renameDisabled)}
                  aria-busy={Boolean(renameDisabled)}
                  className={`inline-flex items-center justify-center w-5 h-5 rounded border transition-colors ${
                    renameDisabled
                      ? 'opacity-50 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                      : 'bg-[rgba(80,130,255,.12)] border-[rgba(90,140,255,.25)] text-[rgb(124,170,255)] hover:bg-[rgba(80,130,255,.18)]'
                  }`}
                  title={renameDisabled ? `Renaming "${shownName}"…` : `Rename "${shownName}"`}
                  aria-label={renameDisabled ? `Renaming "${shownName}"` : `Rename "${shownName}"`}
                >
                  {renameBusy ? <IconSpinner className="opacity-90" /> : <IconRename className="opacity-90" />}
                </button>
              )}
              {canSetBaseImage && (
                <button
                  type="button"
                  onClick={(e) => { stopCardSelection(e); onSetBaseImage?.(); }}
                  onMouseDown={stopCardSelection}
                  onPointerDown={stopCardSelection}
                  disabled={Boolean(setBaseImageDisabled)}
                  aria-busy={Boolean(setBaseImageBusy)}
                  className={`inline-flex items-center justify-center w-5 h-5 rounded border transition-colors ${
                    setBaseImageDisabled
                      ? 'opacity-50 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                      : 'bg-[rgba(250,204,21,.10)] border-[rgba(250,204,21,.22)] text-[rgb(253,224,71)] hover:bg-[rgba(250,204,21,.14)]'
                  }`}
                  title={setBaseImageBusy ? `Setting base image from "${shownName}"…` : `Set "${shownName}" as base image`}
                  aria-label={setBaseImageBusy ? `Setting base image from "${shownName}"` : `Set "${shownName}" as base image`}
                >
                  {setBaseImageBusy ? <IconSpinner className="opacity-90" /> : <IconBaseImage className="opacity-90" />}
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={(e) => { stopCardSelection(e); onDelete(); }}
                  onMouseDown={stopCardSelection}
                  onPointerDown={stopCardSelection}
                  disabled={Boolean(deleteDisabled)}
                  aria-busy={Boolean(deleteDisabled)}
                  className={`inline-flex items-center justify-center w-5 h-5 rounded border transition-colors ${
                    deleteDisabled
                      ? 'opacity-50 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                      : 'bg-[var(--red-subtle)] border-[rgba(255,90,90,.2)] text-[var(--red)] hover:bg-[rgba(255,77,77,.15)]'
                  }`}
                  title={deleteDisabled ? `Deleting "${shownName}"…` : `Delete "${shownName}"`}
                  aria-label={deleteDisabled ? `Deleting "${shownName}"` : `Delete "${shownName}"`}
                >
                  {deleteBusy ? <IconSpinner className="opacity-90" /> : <IconTrash className="opacity-90" />}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}, areDroneCardPropsEqual);
