import React from 'react';

export function MetaChip({
  label,
  value,
  title,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  title?: string;
  mono?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-1.5 py-[1px] text-[10px] ${
        mono ? 'font-mono' : ''
      }`}
      title={title}
    >
      <span className="uppercase tracking-[0.08em] text-[var(--muted-dim)]">{label}</span>
      <span className="text-[var(--fg-secondary)]">{value}</span>
    </span>
  );
}
