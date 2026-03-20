import React from 'react';
import { IconGrip } from './icons';
import type { SidebarGroupDropPlacement } from './sidebar-group-order';

export function sidebarDropPlacementFromClientY(
  clientY: number,
  currentTarget: Pick<HTMLElement, 'getBoundingClientRect'>,
): SidebarGroupDropPlacement {
  const rect = currentTarget.getBoundingClientRect();
  return clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

export function SidebarReorderDropIndicator({
  placement,
}: {
  placement: SidebarGroupDropPlacement;
}) {
  return (
    <div
      className={`pointer-events-none absolute left-0 right-0 h-[2px] bg-[var(--accent)] ${
        placement === 'before' ? 'top-0' : 'bottom-0'
      }`}
    />
  );
}

export function SidebarReorderHandle({
  title,
  ariaLabel,
  className,
  ...buttonProps
}: {
  title: string;
  ariaLabel?: string;
  className: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'title' | 'aria-label'>) {
  return (
    <button
      type="button"
      {...buttonProps}
      className={className}
      title={title}
      aria-label={ariaLabel ?? title}
    >
      <IconGrip className="opacity-80" />
    </button>
  );
}
