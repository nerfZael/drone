import React from 'react';
import { CompanionLiveConnection } from './CompanionLiveConnection';
import { CompanionJevGate, createJevTranscriptHistory } from './CompanionJevGate';
import { retainJevDebugEntries, type JevDebugEntry } from './jev-debug';

type Backend = (prompt: string, signal: AbortSignal) => Promise<string>;
type Session = { connection: CompanionLiveConnection; gate: CompanionJevGate; muted: boolean; displayTimer?: ReturnType<typeof setInterval> };
const EMPTY = { captions: '', error: '', hasStarted: false, queued: 0, status: 'idle' as 'idle' | 'connecting' | 'listening' | 'error', capturing: false, muted: false };

export function useCompanionJev(decisionIntervalMs = 250) {
  const intervalRef = React.useRef(decisionIntervalMs);
  intervalRef.current = decisionIntervalMs;
  const history = React.useRef(createJevTranscriptHistory());
  const active = React.useRef<Session | null>(null);
  const backend = React.useRef<Backend | null>(null);
  const cleanup = React.useRef<Promise<void>>(Promise.resolve());
  const mounted = React.useRef(true);
  const [state, setState] = React.useState(EMPTY);
  const [requests, setRequests] = React.useState<JevDebugEntry[]>([]);
  React.useEffect(() => { active.current?.gate.setIntervalMs(decisionIntervalMs); }, [decisionIntervalMs]);
  const stop = React.useCallback(() => {
    const session = active.current;
    active.current = null;
    session?.gate.stop();
    clearInterval(session?.displayTimer);
    if (session) cleanup.current = Promise.all([cleanup.current, session.connection.close()]).then(() => {});
    if (mounted.current) setState(previous => ({ ...previous, status: 'idle', capturing: false, queued: 0, muted: false }));
  }, []);
  React.useEffect(() => {
    mounted.current = true;
    window.addEventListener('pagehide', stop);
    return () => { mounted.current = false; window.removeEventListener('pagehide', stop); stop(); };
  }, [stop]);

  const start = React.useCallback(async (runBackend: Backend) => {
    if (active.current) return;
    backend.current = runBackend;
    const id = crypto.randomUUID();
    const eventIds = new Set<string>();
    let session: Session;
    let decisionNotice = '';
    let latestRequestId = '';
    const captions = () => [gate.displayTranscript, gate.history.lastTranscriptAt !== undefined ? `Silence: ${(gate.silenceMs / 1000).toFixed(2)} s` : '', decisionNotice].filter(Boolean).join('\n\n');
    const update = (patch: Partial<typeof state>) => {
      if (mounted.current && active.current === session) setState(previous => ({ ...previous, ...patch }));
    };
    const gate = new CompanionJevGate({
      history: history.current, intervalMs: intervalRef.current,
      evaluate: async (transcript, context, signal, silenceMs) => {
        const requestId = crypto.randomUUID();
        latestRequestId = requestId;
        const startedAt = Date.now();
        const input = { transcript, context, silenceMs };
        try {
        const response = await fetch('/api/companion/jev/evaluate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript, context, silenceMs }), signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Jev evaluation failed.');
        if (mounted.current && active.current === session) setRequests(entries => retainJevDebugEntries([
          { id: requestId, startedAt, durationMs: Date.now() - startedAt, input,
            request: result.request, decision: result.decision, probabilities: result.probabilities, delegated: false }, ...entries,
        ]));
        return result.decision;
        } catch (error) {
          if (!signal.aborted && mounted.current && active.current === session) setRequests(entries => retainJevDebugEntries([
            { id: requestId, startedAt, durationMs: Date.now() - startedAt, input, delegated: false,
              error: error instanceof Error ? error.message : 'Jev evaluation failed.' }, ...entries,
          ]));
          throw error;
        }
      },
      send: async (transcript, signal) => {
        // Existing delivery settings handle work already running. Keep transcribing meanwhile.
        void runBackend(transcript, signal).catch(() => {
          if (!signal.aborted) update({ error: 'The delegated request could not complete. Check Companion before retrying it.' });
        });
      },
      report: (_transcript, decision) => {
        const requestId = latestRequestId;
        if (decision === 'send') setRequests(entries => entries.map(entry => entry.id === requestId ? { ...entry, delegated: true } : entry));
        decisionNotice = decision === 'send' ? 'Sent new transcript to Companion.' : 'Waiting — all transcript text is retained.';
        update({ error: '', captions: captions() });
      },
      onChange: () => update({ captions: captions(), queued: gate.busy ? 1 : 0 }),
      onError: error => update({ error, status: 'error' }),
    });
    const connection = new CompanionLiveConnection({
      mode: 'jev', onPlaybackBlocked() {},
      onReady: () => { update({ status: 'listening' }); gate.retry(); },
      onCapturing: () => update({ capturing: true }),
      onError: error => {
        if (active.current !== session) return;
        stop();
        if (mounted.current) setState(previous => ({ ...previous, error, status: 'error' }));
      },
      onEvent: event => {
        if (active.current !== session || typeof event.item_id !== 'string') return;
        if (typeof event.event_id === 'string') {
          if (eventIds.has(event.event_id)) return;
          eventIds.add(event.event_id);
        }
        const itemId = `${id}:${event.item_id}`;
        if (event.type === 'input_audio_buffer.committed') gate.register(itemId, typeof event.previous_item_id === 'string' ? `${id}:${event.previous_item_id}` : null);
        else if (event.type === 'conversation.item.input_audio_transcription.delta' && typeof event.delta === 'string') gate.append(event.delta, itemId);
        else if (event.type === 'conversation.item.input_audio_transcription.completed' && typeof event.transcript === 'string') gate.complete(event.transcript, itemId);
      },
    });
    session = { connection, gate, muted: false };
    active.current = session;
    session.displayTimer = setInterval(() => {
      if (!session.muted && gate.history.lastTranscriptAt !== undefined) update({ captions: captions() });
    }, 50);
    setState({ ...EMPTY, captions: captions(), hasStarted: true, status: 'connecting' });
    await cleanup.current;
    if (active.current === session) await connection.start();
  }, [stop]);

  const reset = React.useCallback(() => {
    stop(); history.current = createJevTranscriptHistory(); backend.current = null;
    setRequests([]);
    if (mounted.current) setState(EMPTY);
  }, [stop]);
  const toggleMute = React.useCallback(() => {
    const session = active.current;
    if (!session) { if (backend.current) void start(backend.current); return; }
    if (state.status === 'error') {
      session.muted = false;
      session.connection.mute(false);
      session.gate.retry();
      setState(previous => ({ ...previous, status: 'listening', error: '', muted: false }));
      return;
    }
    session.muted = !session.muted;
    session.connection.mute(session.muted);
    session.gate.pause(session.muted);
    setState(previous => ({ ...previous, muted: session.muted }));
  }, [start, state.status]);
  return { ...state, requests, start, stop, reset, toggleMute };
}
