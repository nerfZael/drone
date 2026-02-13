import React from 'react';
import type { DroneSummary } from '../types';
import { TypingDots } from './icons';

export function StatusBadge({
  ok,
  error,
  hubPhase,
  hubMessage,
}: {
  ok: boolean;
  error?: string | null;
  hubPhase?: DroneSummary['hubPhase'];
  hubMessage?: DroneSummary['hubMessage'];
}) {
  if (hubPhase === 'starting' || hubPhase === 'seeding') {
    const label = hubPhase === 'seeding' ? 'Seeding' : 'Starting';
    const title = String(hubMessage ?? label);
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide uppercase bg-[var(--yellow-subtle)] text-[var(--yellow)] border border-[rgba(255,178,36,.15)]"
        style={{ fontFamily: 'var(--display)' }}
        title={title}
        aria-label={label}
      >
        <TypingDots color="var(--yellow)" />
        {label}
      </span>
    );
  }
  if (hubPhase === 'error') {
    const title = String(hubMessage ?? error ?? 'Error');
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide uppercase bg-[var(--red-subtle)] text-[var(--red)] border border-[rgba(255,90,90,.15)]"
        style={{ fontFamily: 'var(--display)' }}
        title={title}
        aria-label="Error"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)]" />
        Error
      </span>
    );
  }
  if (ok) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide uppercase bg-[var(--red-subtle)] text-[var(--red)] border border-[rgba(255,90,90,.15)]"
      style={{ fontFamily: 'var(--display)' }}
      title={error || 'offline'}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)]" />
      Offline
    </span>
  );
}
