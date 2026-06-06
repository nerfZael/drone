import React from 'react';
import { timeAgo } from '../../domain';
import { getRelativeTimeUpdateDelayMs } from './relative-time-schedule';

type RelativeTimeListener = {
  atMs: number;
  listener: () => void;
  nextUpdateAtMs: number;
};

const listeners = new Map<() => void, RelativeTimeListener>();
let snapshotNowMs = Date.now();
let timerId: number | null = null;
let timerDueAtMs: number | null = null;

function clearTimer(): void {
  if (timerId != null && typeof window !== 'undefined') window.clearTimeout(timerId);
  timerId = null;
  timerDueAtMs = null;
}

function setTimer(nextUpdateAtMs: number, nowMs: number): void {
  clearTimer();
  timerDueAtMs = nextUpdateAtMs;
  timerId = window.setTimeout(notifyDueListeners, Math.max(1, nextUpdateAtMs - nowMs));
}

function scheduleTimer(nowMs: number = Date.now()): void {
  clearTimer();
  if (listeners.size === 0 || typeof window === 'undefined') return;

  let nextUpdateAtMs = Infinity;
  for (const entry of listeners.values()) {
    nextUpdateAtMs = Math.min(nextUpdateAtMs, entry.nextUpdateAtMs);
  }

  if (!Number.isFinite(nextUpdateAtMs)) return;

  setTimer(nextUpdateAtMs, nowMs);
}

function scheduleTimerIfSooner(nextUpdateAtMs: number, nowMs: number): void {
  if (typeof window === 'undefined') return;
  if (timerDueAtMs != null && timerDueAtMs <= nextUpdateAtMs) return;
  setTimer(nextUpdateAtMs, nowMs);
}

function notifyDueListeners(): void {
  timerId = null;
  timerDueAtMs = null;
  snapshotNowMs = Date.now();

  const dueListeners: Array<() => void> = [];
  for (const entry of listeners.values()) {
    if (entry.nextUpdateAtMs > snapshotNowMs) continue;

    const delayMs = getRelativeTimeUpdateDelayMs(entry.atMs, snapshotNowMs);
    if (delayMs == null) continue;

    entry.nextUpdateAtMs = snapshotNowMs + delayMs;
    dueListeners.push(entry.listener);
  }

  for (const listener of dueListeners) {
    if (listeners.has(listener)) listener();
  }

  scheduleTimer(snapshotNowMs);
}

function subscribeToRelativeTime(atMs: number, listener: () => void): () => void {
  if (!Number.isFinite(atMs) || typeof window === 'undefined') return () => {};

  snapshotNowMs = Date.now();
  const delayMs = getRelativeTimeUpdateDelayMs(atMs, snapshotNowMs);
  if (delayMs == null) return () => {};

  listeners.set(listener, {
    atMs,
    listener,
    nextUpdateAtMs: snapshotNowMs + delayMs,
  });
  scheduleTimerIfSooner(snapshotNowMs + delayMs, snapshotNowMs);

  return () => {
    const entry = listeners.get(listener);
    listeners.delete(listener);
    if (listeners.size === 0) clearTimer();
    else if (entry?.nextUpdateAtMs === timerDueAtMs) scheduleTimer();
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
  const atMs = normalizedAt ? new Date(normalizedAt).getTime() : NaN;
  const subscribe = React.useCallback(
    (listener: () => void) => subscribeToRelativeTime(atMs, listener),
    [atMs],
  );
  const nowMs = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (
    <span className={className} title={title}>
      {normalizedAt ? timeAgo(normalizedAt, nowMs) : fallback}
    </span>
  );
}
