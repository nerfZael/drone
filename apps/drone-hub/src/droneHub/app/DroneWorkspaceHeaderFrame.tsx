import React from 'react';

type DroneWorkspaceHeaderFrameProps = {
  children: React.ReactNode;
  selectedHeader?: boolean;
};

export function DroneWorkspaceHeaderFrame({
  children,
  selectedHeader = false,
}: DroneWorkspaceHeaderFrameProps) {
  return (
    <div
      data-drone-selected-header={selectedHeader ? 'true' : undefined}
      className="relative h-[3.25rem] flex-shrink-0 border-b border-[var(--border)] bg-[var(--panel-alt)]"
    >
      {children}
    </div>
  );
}
