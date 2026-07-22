import React from 'react';

export function DeviceConnectionIndicator({
  online,
  className = '',
}: {
  online: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      style={
        online
          ? {
              boxShadow:
                '0 0 3px color-mix(in srgb, var(--green) 35%, transparent)',
            }
          : undefined
      }
      className={`inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${
        online
          ? 'bg-[var(--green)]'
          : 'border border-[var(--muted-dim)] bg-transparent'
      } ${className}`}
    />
  );
}
