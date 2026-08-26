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
      className="relative h-11 flex-shrink-0 border-b border-[var(--app-header-border)] bg-[var(--app-header-bg)] [container-type:inline-size]"
    >
      {children}
    </div>
  );
}
