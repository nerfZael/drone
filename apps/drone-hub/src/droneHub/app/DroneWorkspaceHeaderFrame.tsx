import React from 'react';

type DroneWorkspaceHeaderFrameProps = {
  children: React.ReactNode;
  expanded?: boolean;
  selectedHeader?: boolean;
};

export function DroneWorkspaceHeaderFrame({
  children,
  expanded = false,
  selectedHeader = false,
}: DroneWorkspaceHeaderFrameProps) {
  return (
    <div
      data-drone-selected-header={selectedHeader ? 'true' : undefined}
      className={`relative flex-shrink-0 border-b border-[var(--app-header-border)] bg-[var(--app-header-bg)] ${
        expanded ? 'h-auto max-h-[46dvh] overflow-y-auto' : 'h-[3.25rem]'
      }`}
    >
      {children}
    </div>
  );
}
