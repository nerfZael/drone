import * as React from 'react';
import type { EntityEvent, EntitySnapshot } from '@entity/core';
import { requestJson } from '../http';

export type EntityConfig = { headModel: string; taskModel: string; voiceModel: string; reasoning: string; evaluator: 'off' | 'jev' | 'qwen'; workspace: string; allowCommands: boolean; summaries?: boolean; review?: 'off' | 'separate' | 'head' };
type EntityState = { config: EntityConfig; snapshot: EntitySnapshot; events: EntityEvent[]; sessionId: string | null };

const MAX_EVENTS = 3000;

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
        const snapshot = JSON.parse((raw as MessageEvent<string>).data) as EntitySnapshot;
        setState((current) => current ? { ...current, snapshot } : current);
      } catch { /* ignore malformed snapshots */ }
    });
    return () => source.close();
  }, [enabled]);

  const post = React.useCallback(async (path: string, body: unknown) => {
    try {
      setError('');
      await requestJson(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  return {
    state,
    error,
    connected,
    control: (action: 'start' | 'pause' | 'resume' | 'reset') => post('/api/entity/control', { action }),
    input: (type: string, data: Record<string, unknown>) => post('/api/entity/input', { type, data }),
    configure: (update: Partial<EntityConfig>) => post('/api/entity/config', update),
    worker: (id: string, action: 'message' | 'stop', text?: string) => post('/api/entity/worker', { id, action, text }),
    reroute: (seq: number, how: 'separate' | 'fork') => post('/api/entity/reroute', { seq, how }),
  };
}
