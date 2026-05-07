import React from 'react';
import { timeAgo } from '../../domain';

const listeners = new Set<() => void>();
let snapshotNowMs = Date.now();
let timerId: number | null = null;

function startTimer(): void {
  if (timerId != null || typeof window === 'undefined') return;
  timerId = window.setInterval(() => {
    snapshotNowMs = Date.now();
    for (const listener of listeners) listener();
  }, 1000);
}

function stopTimer(): void {
  if (listeners.size > 0 || timerId == null) return;
  window.clearInterval(timerId);
  timerId = null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  startTimer();
  return () => {
    listeners.delete(listener);
    stopTimer();
  };
}

function getSnapshot(): number {
  return snapshotNowMs;
}

export function RelativeTimeText({
  at,
  className,
  title,
  fallback = '—',
}: {
  at: string | null | undefined;
  className?: string;
  title?: string;
  fallback?: string;
}) {
  const normalizedAt = String(at ?? '').trim();
  const nowMs = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (
    <span className={className} title={title}>
      {normalizedAt ? timeAgo(normalizedAt, nowMs) : fallback}
    </span>
  );
}
