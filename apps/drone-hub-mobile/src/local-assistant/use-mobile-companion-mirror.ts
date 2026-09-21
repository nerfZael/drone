import React from 'react';
import * as Crypto from 'expo-crypto';
import type { CompanionMirrorCommand, CompanionMirrorSnapshot } from '@drone/assistant-chat';
import { useMesh } from '../mesh/MeshContext';

type Input = {
  deviceId: string;
  read(): CompanionMirrorSnapshot;
  act(command: CompanionMirrorCommand): void | Promise<void>;
  schedule?(callback: () => void, delayMs: number): () => void;
};

/** Publish the phone's UI without giving another client ownership of its conversation. */
export function useMobileCompanionMirror(input: Input): void {
  const { request, subscribe } = useMesh();
  const current = React.useRef(input); current.current = input;
  const publishRef = React.useRef<(() => void) | null>(null);
  React.useEffect(() => {
    if (!input.deviceId) return;
    const deviceId = input.deviceId;
    const sessionId = Crypto.randomUUID();
    let disposed = false;
    let enabled = false;
    let sequence = 0;
    let publishing = false;
    let dirty = false;
    let lastSent = '';
    let scheduled: (() => void) | undefined;
    let cancelRetry: (() => void) | undefined;
    const clock = input.schedule ?? ((callback: () => void, delayMs: number) => {
      const timer = setTimeout(callback, delayMs); return () => clearTimeout(timer);
    });
    const seen = new Set<string>();
    const send = (operation: string, payload: Record<string, unknown>) => request(deviceId, 'companion', operation, payload);
    const publish = async (force = false) => {
      if (disposed || !enabled || current.current.deviceId !== deviceId) return;
      if (publishing) { dirty = true; return; }
      const snapshot = boundedSnapshot(current.current.read());
      const serialized = JSON.stringify(snapshot);
      if (!force && serialized === lastSent) return;
      publishing = true;
      try {
        const result = await send('mirror.publish', { sessionId, sequence: ++sequence, snapshot });
        if (typeof result?.enabled === 'boolean') enabled = result.enabled;
        lastSent = serialized;
      } catch { lastSent = ''; }
      finally {
        publishing = false;
        if (disposed) void send('mirror.close', { sessionId }).catch(() => undefined);
        else if (dirty) { dirty = false; schedule(); }
      }
    };
    const schedule = () => {
      if (scheduled || disposed) return;
      scheduled = clock(() => { scheduled = undefined; void publish(); }, 150);
    };
    const load = async () => {
      try {
        const settings = await send('mirror.settings.get', {});
        if (disposed) return;
        enabled = settings?.enabled === true;
        if (enabled) await publish(true);
      } catch { /* A reconnect retries discovery without interrupting voice. */ }
    };
    const unsubscribeSettings = subscribe('companion', 'mirror.settings.changed', (event) => {
      if (event.sourceDeviceId !== deviceId || typeof event.payload?.enabled !== 'boolean') return;
      enabled = event.payload.enabled;
      if (enabled) void publish(true);
    });
    const unsubscribeCommands = subscribe('companion', 'mirror.command', async (event) => {
      const command = event.payload as CompanionMirrorCommand;
      if (disposed || !enabled || current.current.deviceId !== deviceId || event.sourceDeviceId !== deviceId || command?.sessionId !== sessionId ||
        typeof command.commandId !== 'string' || seen.has(command.commandId)) return;
      seen.add(command.commandId);
      if (seen.size > 64) seen.delete(seen.values().next().value!);
      let error: string | undefined;
      try {
        if (!Number.isFinite(command.expiresAt) || command.expiresAt < Date.now()) throw new Error('The approval request expired. Try again.');
        await current.current.act(command);
      } catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
      // Send the current execution flag/revision before acknowledging the click.
      void publish(true).finally(() => send('mirror.result', {
        sessionId, commandId: command.commandId, ok: !error, ...(error ? { error } : {}),
      }).catch(() => undefined));
    });
    publishRef.current = schedule;
    void load();
    // Also recover a dropped publish or settings event when the mesh reconnects.
    const retry = () => { cancelRetry = clock(() => { void load(); if (!disposed) retry(); }, 5_000); };
    retry();
    return () => {
      disposed = true; publishRef.current = null;
      cancelRetry?.(); scheduled?.();
      unsubscribeSettings(); unsubscribeCommands();
      void send('mirror.close', { sessionId }).catch(() => undefined);
    };
  }, [input.deviceId, input.schedule, request, subscribe]);
  React.useEffect(() => { publishRef.current?.(); });
}

export function boundedSnapshot(snapshot: CompanionMirrorSnapshot): CompanionMirrorSnapshot {
  const next = { ...snapshot, error: snapshot.error.slice(0, 2_000), history: snapshot.history ? [...snapshot.history] : undefined };
  const notices: string[] = [];
  const size = () => JSON.stringify(next).length;
  // Conservatively allow four UTF-8 bytes per character plus the signed mesh envelope.
  const limit = 59_000; // Reserve space for omission notices.
  if (size() > limit) next.lastExecution = null; // Already present in history on updated clients.
  for (const key of ['captions', 'reply'] as const) {
    if (size() > limit && next[key].length > 12_000) { next[key] = `…\n${next[key].slice(-12_000)}`; notices.push(`Only recent ${key === 'captions' ? 'voice transcript' : 'reply text'} is shown.`); }
  }
  if (size() > limit && next.activity?.length) { next.activity = []; notices.push('Activity is too large to mirror; review it on the phone.'); }
  while (size() > limit && next.history?.length) { next.history.shift(); }
  if (next.history?.length !== snapshot.history?.length) notices.push('Older executions are omitted; review them on the phone.');
  if (size() > limit) {
    next.proposal = null; next.proposalExecution = null;
    next.error = 'This proposal is too large to mirror. Review and approve it on the phone.';
    notices.push(next.error);
  }
  if (size() > limit) { next.proposals = []; notices.push('The proposal list is too large to mirror; review it on the phone.'); }
  if (size() > limit && next.subscriptions?.length) { next.subscriptions = []; notices.push('Subscriptions are too large to mirror; review them on the phone.'); }
  if (notices.length) next.reviewNotice = notices.join(' ');
  return next;
}
