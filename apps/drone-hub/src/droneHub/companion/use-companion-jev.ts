import React from 'react';
import { CompanionReflexSession, companionReflexTable, createCompanionTranscriptHistory, type CompanionAutonomy, type CompanionReflexInsight, type CompanionSenseSources, type CompanionTranscriptHistory } from '@drone/assistant-chat';
import type { ReflexBrainOutput, ReflexCompileInput, ReflexTable } from '@drone/reflex';
import { CompanionLiveConnection } from './CompanionLiveConnection';
import { retainJevDebugEntries, type JevDebugEntry } from './jev-debug';

type Backend = (prompt: string, signal: AbortSignal) => Promise<string>;
type CancelBackend = () => Promise<void>;
type Session = { connection: CompanionLiveConnection; reflex: CompanionReflexSession; muted: boolean; displayTimer?: ReturnType<typeof setInterval> };
const EMPTY = { captions: '', error: '', hasStarted: false, queued: 0, status: 'idle' as 'idle' | 'connecting' | 'listening' | 'error', capturing: false, muted: false, compiling: false };

async function postJson<T>(path: string, body: unknown, signal: AbortSignal, failure: string): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(path.endsWith('compile') ? 90_000 : 20_000)]) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || failure);
  return result as T;
}

export type CompanionJevOptions = { autonomy: CompanionAutonomy; brain: boolean };

/** Hosts Companion's reflex loop: the transcript stream in, Hub evaluation and compilation out, code-owned actions in between. */
export function useCompanionJev(decisionIntervalMs = 250, seedInstructions = '', options: CompanionJevOptions = { autonomy: 'off', brain: false }) {
  const intervalRef = React.useRef(decisionIntervalMs);
  intervalRef.current = decisionIntervalMs;
  const seedRef = React.useRef(seedInstructions);
  seedRef.current = seedInstructions;
  const optionsRef = React.useRef(options);
  optionsRef.current = options;
  const history = React.useRef<CompanionTranscriptHistory>(createCompanionTranscriptHistory());
  const tableRef = React.useRef<{ table: ReflexTable; seed: string; autonomy: CompanionAutonomy } | null>(null);
  const active = React.useRef<Session | null>(null);
  const backend = React.useRef<{ run: Backend; cancel?: CancelBackend; senses?: CompanionSenseSources } | null>(null);
  const cleanup = React.useRef<Promise<void>>(Promise.resolve());
  const mounted = React.useRef(true);
  const [state, setState] = React.useState(EMPTY);
  const [requests, setRequests] = React.useState<JevDebugEntry[]>([]);
  const [table, setTable] = React.useState<ReflexTable | null>(null);
  const [insight, setInsight] = React.useState<CompanionReflexInsight | null>(null);
  React.useEffect(() => { active.current?.reflex.setIntervalMs(decisionIntervalMs); }, [decisionIntervalMs]);
  const stop = React.useCallback(() => {
    const session = active.current;
    active.current = null;
    session?.reflex.stop();
    clearInterval(session?.displayTimer);
    if (session) cleanup.current = Promise.all([cleanup.current, session.connection.close()]).then(() => {});
    if (mounted.current) setState(previous => ({ ...previous, status: 'idle', capturing: false, queued: 0, muted: false, compiling: false }));
    return cleanup.current;
  }, []);
  React.useEffect(() => {
    mounted.current = true;
    window.addEventListener('pagehide', stop);
    return () => { mounted.current = false; window.removeEventListener('pagehide', stop); stop(); };
  }, [stop]);

  const start = React.useCallback(async (runBackend: Backend, cancelBackend?: CancelBackend, senses?: CompanionSenseSources, initiallyMuted = false) => {
    if (active.current) return;
    backend.current = { run: runBackend, cancel: cancelBackend, senses };
    const { autonomy, brain } = optionsRef.current;
    const id = crypto.randomUUID();
    const eventIds = new Set<string>();
    let session: Session;
    let decisionNotice = '';
    let working = 0;
    let lastReply = '';
    // Brain revisions survive stop/start; a changed seed rebuilds only an unrevised default table, and a changed
    // autonomy level always rebuilds because the rule set and facts differ per level.
    const seed = seedRef.current;
    if (!tableRef.current || tableRef.current.autonomy !== autonomy || (tableRef.current.table.source === 'default' && tableRef.current.seed !== seed)) {
      tableRef.current = { table: companionReflexTable(seed, { autonomy }), seed, autonomy };
    }
    const update = (patch: Partial<typeof state>) => {
      if (mounted.current && active.current === session) setState(previous => ({ ...previous, ...patch }));
    };
    const captions = () => [reflex.displayTranscript, reflex.history.lastTranscriptAt !== undefined ? `Silence: ${(reflex.silenceMs / 1000).toFixed(2)} s` : '', decisionNotice].filter(Boolean).join('\n\n');
    const record = (entry: JevDebugEntry) => { if (mounted.current && active.current === session) setRequests(entries => retainJevDebugEntries([entry, ...entries])); };
    const refreshInsight = () => { if (mounted.current && active.current === session) setInsight(reflex.insight()); };
    const reflex = new CompanionReflexSession({
      history: history.current, table: tableRef.current.table, intervalMs: intervalRef.current, seedInstructions: seed,
      autonomy, senses,
      evaluate: async (evaluationState, questions, signal) => (await postJson<{ answers: import('@drone/reflex').ReflexAnswers }>('/api/reflex/evaluate', { state: evaluationState, questions }, signal, 'Reflex evaluation failed.')).answers,
      ...(brain ? { compile: async (input: ReflexCompileInput, signal) => (await postJson<{ output: ReflexBrainOutput }>('/api/reflex/compile', input, signal, 'The brain could not compile a table.')).output } : {}),
      backend: () => ({ status: working > 0 ? 'working' : 'idle', ...(lastReply ? { lastReply } : {}) }),
      send: async (transcript, signal) => {
        // Existing delivery settings handle work already running, including nudges. Keep transcribing meanwhile.
        working += 1;
        void runBackend(transcript, signal).then(reply => { lastReply = reply; }).catch(() => {
          if (!signal.aborted && active.current === session) update({ error: 'The delegated request could not complete. Check Companion before retrying it.' });
        }).finally(() => { working = Math.max(0, working - 1); });
      },
      cancel: async () => { await backend.current?.cancel?.(); working = 0; },
      onDecision: decision => {
        record({ kind: 'decision', ...decision });
        refreshInsight();
        if (decision.stale || decision.error) return;
        decisionNotice = decision.action === 'send' && decision.applied ? 'Sent new transcript to Companion.'
          : decision.action === 'cancel' && decision.applied ? 'Cancelled running Companion work.'
            : decision.action === 'skip' && decision.applied ? 'Skipped speech not meant for Companion.'
              : decision.action === 'nudge' && decision.applied ? 'Nudged the backend for a status check.'
                : decision.action === 'notify' && decision.applied ? 'Showed a note on screen.'
                  : decision.dryRun ? `Would ${decision.action} (autonomy is observe).`
                    : 'Waiting — all transcript text is retained.';
        update({ error: '', captions: captions() });
      },
      onWake: wake => {
        record({ kind: 'wake', id: crypto.randomUUID(), startedAt: Date.now() - wake.durationMs, ...wake });
        if (wake.table) { tableRef.current = { table: wake.table, seed, autonomy }; if (mounted.current) setTable(wake.table); }
        update({ compiling: false });
        refreshInsight();
      },
      onChange: () => { update({ captions: captions(), queued: reflex.busy ? 1 : 0, compiling: reflex.isCompiling }); refreshInsight(); },
      onError: error => update({ error, status: 'error' }),
    });
    const connection = new CompanionLiveConnection({
      mode: 'jev', onPlaybackBlocked() {},
      onReady: () => { update({ status: 'listening' }); reflex.retry(); },
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
        if (event.type === 'input_audio_buffer.committed') reflex.register(itemId, typeof event.previous_item_id === 'string' ? `${id}:${event.previous_item_id}` : null);
        else if (event.type === 'conversation.item.input_audio_transcription.delta' && typeof event.delta === 'string') reflex.append(event.delta, itemId);
        else if (event.type === 'conversation.item.input_audio_transcription.completed' && typeof event.transcript === 'string') reflex.complete(event.transcript, itemId);
      },
    });
    session = { connection, reflex, muted: initiallyMuted };
    if (initiallyMuted) { connection.mute(true); reflex.pause(true); }
    active.current = session;
    if (mounted.current) { setTable(reflex.table); setInsight(reflex.insight()); }
    session.displayTimer = setInterval(() => {
      if (!session.muted && reflex.history.lastTranscriptAt !== undefined) { update({ captions: captions() }); refreshInsight(); }
    }, 50);
    setState({ ...EMPTY, captions: captions(), hasStarted: true, muted: initiallyMuted, status: 'connecting' });
    await cleanup.current;
    if (active.current === session) await connection.start();
  }, [stop]);

  /** Discard brain revisions and return to the default table for the current settings. */
  const resetTable = React.useCallback(() => {
    const { autonomy } = optionsRef.current;
    const table = companionReflexTable(seedRef.current, { autonomy });
    tableRef.current = { table, seed: seedRef.current, autonomy };
    active.current?.reflex.setTable(table);
    if (mounted.current) { setTable(table); setInsight(active.current?.reflex.insight() ?? null); }
  }, []);
  const reset = React.useCallback(() => {
    stop(); history.current = createCompanionTranscriptHistory(); backend.current = null; tableRef.current = null;
    setRequests([]); setTable(null); setInsight(null);
    if (mounted.current) setState(EMPTY);
  }, [stop]);
  const toggleMute = React.useCallback(() => {
    const session = active.current;
    if (!session) { if (backend.current) void start(backend.current.run, backend.current.cancel, backend.current.senses); return; }
    if (state.status === 'error') {
      session.muted = false;
      session.connection.mute(false);
      session.reflex.retry();
      setState(previous => ({ ...previous, status: 'listening', error: '', muted: false }));
      return;
    }
    session.muted = !session.muted;
    session.connection.mute(session.muted);
    session.reflex.pause(session.muted);
    setState(previous => ({ ...previous, muted: session.muted }));
  }, [start, state.status]);
  return { ...state, requests, table, insight, start, stop, reset, resetTable, toggleMute };
}
