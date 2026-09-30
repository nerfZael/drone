import * as React from 'react';
import type { EntityEvent, EntitySnapshot } from '@entity/core';
import type { ChatWorkspaceAccess } from '@drone/assistant-chat';
import { requestJson } from '../http';

/** One part of the entity: the model it runs on and how hard that model thinks ('off', 'minimal' … 'xhigh'). */
export type ModelChoice = { model: string; reasoning: string };
/** The model for each part: head (the reviewer uses it too), workers, and the voice (null: the head is the front). */
export type EntityModels = { head: ModelChoice; task: ModelChoice; voice: ModelChoice | null };
export type EntityProfile = { id: string; name: string; models: EntityModels };
export type EntityConfig = { models: EntityModels; evaluator: 'off' | 'jev' | 'qwen'; workspace: string; workspaceAccess?: ChatWorkspaceAccess; summaries?: boolean; review?: 'off' | 'separate' | 'head' };
type EntityState = { config: EntityConfig; snapshot: EntitySnapshot; events: EntityEvent[]; sessionId: string | null };

/** The same as the Hub sends on connect, so a reconnect shows what the live view showed. */
const MAX_EVENTS = 2000;

/** Live view of the Hub's entity session: initial state, then events and snapshots over SSE. */
export function useEntitySession(enabled: boolean) {
  const [state, setState] = React.useState<EntityState | null>(null);
  const [error, setError] = React.useState('');
  const [connected, setConnected] = React.useState(false);

  React.useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/entity/stream');
    source.addEventListener('open', () => setConnected(true));
    source.addEventListener('error', () => setConnected(false));
    source.addEventListener('state', (raw) => {
      try { setState(JSON.parse((raw as MessageEvent<string>).data)); } catch { /* keep the last good state */ }
    });
    source.addEventListener('event', (raw) => {
      try {
        const event = JSON.parse((raw as MessageEvent<string>).data) as EntityEvent;
        setState((current) => current ? { ...current, events: [...current.events.slice(-(MAX_EVENTS - 1)), event] } : current);
      } catch { /* ignore malformed events */ }
    });
    source.addEventListener('snapshot', (raw) => {
      try {
        // Only the sections that changed since the last one; the rest stay as they were.
        const patch = JSON.parse((raw as MessageEvent<string>).data) as Partial<EntitySnapshot>;
        setState((current) => current ? { ...current, snapshot: { ...current.snapshot, ...patch } } : current);
      } catch { /* ignore malformed snapshots */ }
    });
    return () => source.close();
  }, [enabled]);

  /** Resolves true once the Hub accepted it; a failure shows as the bench's error. */
  const post = React.useCallback(async (path: string, body: unknown): Promise<boolean> => {
    try {
      setError('');
      await requestJson(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, []);

  return {
    state,
    error,
    connected,
    control: (action: 'start' | 'pause' | 'resume' | 'reset') => post('/api/entity/control', { action }),
    input: (type: string, data: Record<string, unknown>) => post('/api/entity/input', { type, data }),
    configure: (update: Partial<EntityConfig>) => post('/api/entity/config', update),
    /** `answers` is the seq of the worker's question when the text is a clicked option. */
    worker: (id: string, action: 'message' | 'stop' | 'rename', text?: string, answers?: number, picks?: string[]) =>
      post('/api/entity/worker', { id, action, text, ...(answers !== undefined ? { answers } : {}), ...(picks ? { picks } : {}) }),
    reroute: (seq: number, how: 'separate' | 'fork') => post('/api/entity/reroute', { seq, how }),
  };
}
