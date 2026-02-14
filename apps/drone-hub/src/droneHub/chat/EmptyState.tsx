import React from 'react';

export function EmptyState({
  icon,
  title,
  description,
  actions,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="w-16 h-16 rounded-lg bg-[rgba(255,255,255,.02)] border border-[var(--border-subtle)] flex items-center justify-center mb-5 relative">
        {icon}
        {/* Corner brackets */}
        <div className="absolute -top-px -left-px w-2 h-2 border-t border-l border-[var(--accent-muted)] opacity-30" />
        <div className="absolute -bottom-px -right-px w-2 h-2 border-b border-r border-[var(--accent-muted)] opacity-30" />
      </div>
      <h3
        className="text-base font-semibold text-[var(--fg)] mb-1.5 tracking-tight"
        style={{ fontFamily: 'var(--display)' }}
      >
        {title}
      </h3>
      <p className="text-sm text-[var(--muted)] max-w-[320px] leading-relaxed">{description}</p>
      {actions ? <div className="mt-5 w-full max-w-[340px]">{actions}</div> : null}
    </div>
  );
}
