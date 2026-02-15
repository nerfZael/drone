import React from 'react';
import { timeAgo } from '../../domain';
import type { DroneSummary } from '../types';
import { IconClone, IconRename, IconSpinner, IconTrash, TypingDots } from './icons';
import { StatusBadge } from './StatusBadge';

export function DroneCard({
  drone,
  displayName,
  selected,
  busy,
  onClick,
  onDragStart,
  onDragEnd,
  draggable,
  onClone,
  onRename,
  onDelete,
  onErrorClick,
  cloneDisabled,
  renameDisabled,
  renameBusy,
  deleteDisabled,
  deleteBusy,
  statusHint,
}: {
  drone: DroneSummary;
  displayName?: string;
  selected: boolean;
  busy?: boolean;
  onClick: (opts?: { toggle?: boolean; range?: boolean }) => void;
  onDragStart?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
  draggable?: boolean;
  onClone?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onErrorClick?: (drone: DroneSummary, message: string) => void;
  cloneDisabled?: boolean;
  renameDisabled?: boolean;
  renameBusy?: boolean;
  deleteDisabled?: boolean;
  deleteBusy?: boolean;
  statusHint?: string;
  showGroup?: boolean;
}) {
  const shownName = String(displayName ?? drone.name).trim() || drone.name;
  const canClone = typeof onClone === 'function';
  const canRename = typeof onRename === 'function';
  const canDelete = typeof onDelete === 'function';
  const hasActions = canClone || canRename || canDelete;
  const actionsDisabled = Boolean(cloneDisabled) || Boolean(renameDisabled) || Boolean(deleteDisabled);
  const showRespondingAsStatus = Boolean(busy) && Boolean(drone.statusOk) && drone.hubPhase !== 'error';
  const errText = String(drone.hubMessage ?? drone.statusError ?? '').trim();
  const showInlineError = drone.hubPhase === 'error' && Boolean(errText);
  const canOpenInlineError = showInlineError && typeof onErrorClick === 'function';
  const stopCardSelection = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div
      data-onboarding-id="sidebar.droneCard"
      role="button"
      tabIndex={0}
      draggable={Boolean(draggable)}
      onDragStart={(e) => onDragStart?.(e)}
      onDragEnd={() => onDragEnd?.()}
      onClick={(e) => onClick({ toggle: e.metaKey || e.ctrlKey, range: e.shiftKey })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={`w-full text-left px-3 h-8 flex items-center rounded-md border transition-all duration-150 group/drone relative ${
        selected
          ? 'bg-[var(--selected)] border-[var(--accent-muted)]'
          : 'border-transparent hover:bg-[var(--hover)] hover:border-[var(--border-subtle)]'
      }`}
    >
      {/* Accent edge for selected state */}
      {selected && (
        <div className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-[var(--accent)]" />
      )}

      {/* Single row: name … status/actions */}
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <span
          className={`flex-1 min-w-0 truncate text-[12.5px] ${selected ? 'font-semibold text-[var(--fg)]' : 'text-[var(--fg-secondary)]'}`}
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
            className="flex-shrink-0 ml-2 text-[10px] text-[var(--red)] truncate max-w-[80px] hover:underline focus:outline-none"
            title="View full error details"
            aria-label={`View error details for ${shownName}`}
          >
            error
          </button>
        ) : (
          <span className="flex-shrink-0 ml-2 text-[10px] text-[var(--red)] truncate max-w-[80px]" title={errText}>error</span>
        )
      ) : (
        <div className="relative flex items-center justify-end flex-shrink-0 ml-2">
          <div
            className={
              hasActions
                ? `transition-opacity duration-150 ${
                    actionsDisabled ? 'opacity-0 pointer-events-none' : 'group-hover/drone:opacity-0 group-hover/drone:pointer-events-none'
                  }`
                : ''
            }
          >
            {showRespondingAsStatus ? (
              <span className="inline-flex items-center" title="Agent responding"><TypingDots color="var(--yellow)" /></span>
            ) : (
              <StatusBadge ok={drone.statusOk} error={drone.statusError} hubPhase={drone.hubPhase} hubMessage={drone.hubMessage} />
            )}
          </div>
          {hasActions && (
            <div
              data-onboarding-id="sidebar.droneCard.actions"
              className={`absolute right-0 flex items-center gap-1 transition-all ${
                actionsDisabled
                  ? 'opacity-100 pointer-events-auto'
                  : 'opacity-0 pointer-events-none group-hover/drone:opacity-100 group-hover/drone:pointer-events-auto'
              }`}
            >
              {canClone && (
                <button
                  type="button"
                  onClick={(e) => { stopCardSelection(e); onClone(); }}
                  onMouseDown={stopCardSelection}
                  onPointerDown={stopCardSelection}
                  disabled={Boolean(cloneDisabled)}
                  className={`inline-flex items-center justify-center w-6 h-6 rounded border transition-all ${
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
                  className={`inline-flex items-center justify-center w-6 h-6 rounded border transition-all ${
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
              {canDelete && (
                <button
                  type="button"
                  onClick={(e) => { stopCardSelection(e); onDelete(); }}
                  onMouseDown={stopCardSelection}
                  onPointerDown={stopCardSelection}
                  disabled={Boolean(deleteDisabled)}
                  aria-busy={Boolean(deleteDisabled)}
                  className={`inline-flex items-center justify-center w-6 h-6 rounded border transition-all ${
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
      )}
    </div>
  );
}
