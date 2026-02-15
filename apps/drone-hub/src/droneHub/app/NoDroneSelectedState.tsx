import React from 'react';
import { EmptyState } from '../chat';
import { IconDrone, IconPlus, IconPlusDouble } from './icons';

type NoDroneSelectedStateProps = {
  dronesLoading: boolean;
  sidebarDroneCount: number;
  dronesError: string | null | undefined;
  onOpenDraftChatComposer: () => void;
  onOpenCreateModal: () => void;
};

export function NoDroneSelectedState({
  dronesLoading,
  sidebarDroneCount,
  dronesError,
  onOpenDraftChatComposer,
  onOpenCreateModal,
}: NoDroneSelectedStateProps) {
  if (!dronesLoading && sidebarDroneCount === 0 && !dronesError) {
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
              className="w-full inline-flex items-center gap-2 h-[32px] px-3 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[11px] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] transition-all"
              title="Create multiple drones (S)"
              aria-label="Create multiple drones"
            >
              <IconPlusDouble className="opacity-80" />
              <span className="font-semibold tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                Create multiple drones
              </span>
            </button>
          </div>
        }
      />
    );
  }

  return (
    <EmptyState
      icon={<IconDrone className="w-8 h-8 text-[var(--muted-dim)]" />}
      title="Select a drone"
      description="Choose a drone from the sidebar to view its session output."
    />
  );
}
