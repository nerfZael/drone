import React from 'react';
import type { DroneSummary } from '../types';

export type HubPhase = DroneSummary['hubPhase'];

export function isProvisioningPhase(hubPhase: HubPhase | undefined): boolean {
  return hubPhase === 'creating' || hubPhase === 'starting' || hubPhase === 'seeding';
}

export function provisioningLabel(hubPhase: HubPhase | undefined): string {
  if (hubPhase === 'seeding') return 'Seeding';
  return 'Starting';
}

export type PaneReadinessState = {
  ready: boolean;
  waiting: boolean;
  timedOut: boolean;
  suppressErrors: boolean;
  markReady: () => void;
  reset: () => void;
};

/**
 * Tracks whether a pane has "come online" at least once for a given drone/pane key.
 *
 * While hub is provisioning (starting/seeding) and the pane has not had its first
 * successful load, we consider it "waiting" and allow callers to suppress transient
 * fetch errors until a timeout elapses.
 */
export function usePaneReadiness({
  hubPhase,
  resetKey,
  timeoutMs = 15_000,
}: {
  hubPhase: HubPhase | undefined;
  resetKey: string;
  timeoutMs?: number;
}): PaneReadinessState {
  const [ready, setReady] = React.useState(false);
  const [timedOut, setTimedOut] = React.useState(false);
  const startedWaitingAtRef = React.useRef<number | null>(null);
  const prevProvisioningRef = React.useRef<boolean>(false);

  const reset = React.useCallback(() => {
    setReady(false);
    setTimedOut(false);
    startedWaitingAtRef.current = null;
  }, []);

  React.useEffect(() => {
    reset();
  }, [resetKey, reset]);

  const provisioning = isProvisioningPhase(hubPhase);
  const waiting = provisioning && !ready;

  React.useEffect(() => {
    const wasProvisioning = prevProvisioningRef.current;
    prevProvisioningRef.current = provisioning;
    if (!wasProvisioning && provisioning) {
      // New provisioning cycle: clear readiness so panes show "connecting" placeholders again.
      setReady(false);
      setTimedOut(false);
      startedWaitingAtRef.current = null;
    }
  }, [provisioning]);

  React.useEffect(() => {
    if (!waiting) {
      startedWaitingAtRef.current = null;
      setTimedOut(false);
      return;
    }

    const now = Date.now();
    if (startedWaitingAtRef.current == null) startedWaitingAtRef.current = now;
    const elapsed = now - startedWaitingAtRef.current;
    const remaining = Math.max(0, Math.floor(timeoutMs - elapsed));

    if (remaining <= 0) {
      setTimedOut(true);
      return;
    }

    setTimedOut(false);
    const t = setTimeout(() => setTimedOut(true), remaining);
    return () => clearTimeout(t);
  }, [timeoutMs, waiting]);

  const markReady = React.useCallback(() => {
    setReady(true);
    setTimedOut(false);
    startedWaitingAtRef.current = null;
  }, []);

  return {
    ready,
    waiting,
    timedOut,
    suppressErrors: waiting && !timedOut,
    markReady,
    reset,
  };
}

