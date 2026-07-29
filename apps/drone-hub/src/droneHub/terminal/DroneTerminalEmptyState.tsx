import React from 'react';
import { UiPaneState, UiToolbarButton } from '../../ui/components';

export function DroneTerminalEmptyState({
  onCreateSession,
}: {
  onCreateSession: () => void;
}) {
  return (
    <UiPaneState
      kind="empty"
      title="No terminal tabs"
      description="No terminal tabs are open in this pane."
      className="absolute inset-0 z-10 bg-[var(--surface-inset-strong)]/80 backdrop-blur"
      action={
        <UiToolbarButton tone="accent" active onClick={onCreateSession}>
          New terminal
        </UiToolbarButton>
      }
    />
  );
}
