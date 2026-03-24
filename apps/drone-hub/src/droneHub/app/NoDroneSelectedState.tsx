import React from 'react';
import { EmptyState } from '../chat';
import { FleetDashboard, type NoDroneSelectedStateProps } from './FleetDashboard';
import { IconBoard, IconDrone, IconList, IconPlus, IconPlusDouble } from './icons';

export function NoDroneSelectedState({
  dronesLoading,
  sidebarDroneCount,
  dronesError,
  onOpenDraftChatComposer,
  onOpenCreateModal,
  onOpenKanbanBoard,
  onOpenPlaybookRuns,
  ...fleetDashboardProps
}: NoDroneSelectedStateProps) {
  const showNoDronesEmptyState = !dronesLoading && sidebarDroneCount === 0 && !dronesError;

  if (showNoDronesEmptyState) {
    return (
      <EmptyState
        icon={<IconDrone className="w-8 h-8 text-[var(--muted-dim)]" />}
        title="No drones yet"
        description="Create your first drone to get started."
        actions={
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onOpenDraftChatComposer}
              className="w-full inline-flex items-center gap-2 h-[32px] px-3 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[11px] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] transition-all"
              title="Create new drone"
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
              className="w-full inline-flex items-center gap-2 h-[32px] px-3 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[11px] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] transition-all"
              title="Create multiple drones"
              aria-label="Create multiple drones"
            >
              <IconPlusDouble className="opacity-80" />
              <span className="font-semibold tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                Create multiple drones
              </span>
            </button>
            <button
              type="button"
              onClick={onOpenKanbanBoard}
              className="w-full inline-flex items-center gap-2 h-[32px] px-3 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[11px] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] transition-all"
              title="Open task board"
              aria-label="Open task board"
            >
              <IconBoard className="opacity-80" />
              <span className="font-semibold tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                Open task board
              </span>
            </button>
            <button
              type="button"
              onClick={onOpenPlaybookRuns}
              className="w-full inline-flex items-center gap-2 h-[32px] px-3 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[11px] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] transition-all"
              title="Open playbook runs"
              aria-label="Open playbook runs"
            >
              <IconList className="opacity-80" />
              <span className="font-semibold tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                Open playbook runs
              </span>
            </button>
          </div>
        }
      />
    );
  }

  return <FleetDashboard {...fleetDashboardProps} dronesLoading={dronesLoading} sidebarDroneCount={sidebarDroneCount} dronesError={dronesError} onOpenDraftChatComposer={onOpenDraftChatComposer} onOpenCreateModal={onOpenCreateModal} onOpenKanbanBoard={onOpenKanbanBoard} onOpenPlaybookRuns={onOpenPlaybookRuns} />;
}
