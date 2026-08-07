import React from 'react';

export const APP_SHORTCUT_BOUNDARY_SELECTOR = '[data-app-shortcuts-disabled="true"]';

export function AppShortcutBoundary({
  onKeyDown,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      data-app-shortcuts-disabled="true"
      onKeyDown={(event) => {
        event.stopPropagation();
        onKeyDown?.(event);
      }}
    />
  );
}
