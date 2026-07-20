import React from 'react';

export function GroupBadge({ group }: { group: string }) {
  return (
    <span className="text-[var(--text-10-5)] text-[var(--muted-dim)] truncate max-w-[100px]" title={group}>
      {group}
    </span>
  );
}
