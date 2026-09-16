import { LIVE_TIMING_STAGES, type LiveTimingEvent, type LiveTimingFields } from '@drone/assistant-chat';
import { applyHubDatabaseMigrations, type HubDatabase } from '../../host/hub-database';
import type { CompanionRunTelemetryRecord } from './companion-telemetry';

type StoredEvent = LiveTimingEvent & { source: 'client' | 'hub'; receivedAt: string };
const stages = new Set<string>(LIVE_TIMING_STAGES);
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_.:-]{1,200}$/.test(v);
const numeric = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 604_800_000;

/** Explicit allowlist: never store audio, transcript text, credentials, or arbitrary provider payloads. */
export function validateLiveTiming(value: unknown, sessionId: string): LiveTimingEvent | undefined {
  if (!value || typeof value !== 'object' || !id(sessionId)) return;
  const v = value as Record<string, unknown>;
  if (v.sessionId !== sessionId || !Number.isInteger(v.sequence) || Number(v.sequence) < 1 || Number(v.sequence) > 2_000 ||
    typeof v.stage !== 'string' || !stages.has(v.stage) || !numeric(v.elapsedMs) || !Number.isInteger(v.resultSequence) ||
    Number(v.resultSequence) < 0 || Number(v.resultSequence) > 2_000) return;
  const event: LiveTimingEvent = { sessionId, sequence: Number(v.sequence), stage: v.stage,
    elapsedMs: v.elapsedMs, resultSequence: Number(v.resultSequence) };
  for (const key of ['dispatchMs', 'queueMs', 'durationMs', 'startMs', 'endMs'] as const) if (numeric(v[key])) event[key] = v[key];
  for (const key of ['eventId', 'delegationId'] as const) if (id(v[key])) event[key] = v[key];
  if (v.delegationId === null) event.delegationId = null;
  if (typeof v.eventType === 'string' && /^session\.(thinking|commentary|instructions)\.append(ed)?$/.test(v.eventType)) event.eventType = v.eventType;
  return event;
}

export class CompanionLiveTelemetry {
  private memory = new Map<string, StoredEvent[]>();
  constructor(private readonly database?: HubDatabase | null) {
    database?.read(connection => applyHubDatabaseMigrations(connection, [{ version: 1, name: 'persistent Live timing', migrate(db) {
      db.exec(`CREATE TABLE companion_live_sessions (
        session_id TEXT NOT NULL PRIMARY KEY, first_received_at TEXT NOT NULL, last_received_at TEXT NOT NULL);
        CREATE TABLE companion_live_timing (
        session_id TEXT NOT NULL, source TEXT NOT NULL, sequence INTEGER NOT NULL,
        received_at TEXT NOT NULL, payload_json TEXT NOT NULL,
        PRIMARY KEY(session_id, source, sequence));
        CREATE INDEX companion_live_timing_recent ON companion_live_timing(received_at DESC);`);
    } }], 'companion-live-timing'));
  }
  async record(sessionId: string, source: StoredEvent['source'], values: unknown): Promise<void> {
    if (!id(sessionId) || !Array.isArray(values)) return;
    const receivedAt = new Date().toISOString();
    const events = values.slice(0, 100).flatMap(v => { const e = validateLiveTiming(v, sessionId); return e && (source === 'hub' || (!e.stage.startsWith('hub_') && !e.stage.startsWith('provider_'))) ? [{ ...e, source, receivedAt }] : []; });
    if (!events.length) return;
    if (this.database) {
      await this.database.writeTransaction('record Live timing', db => {
        const created = db.prepare('INSERT OR IGNORE INTO companion_live_sessions VALUES (?, ?, ?)').run(sessionId, receivedAt, receivedAt).changes;
        db.prepare('UPDATE companion_live_sessions SET last_received_at = ? WHERE session_id = ?').run(receivedAt, sessionId);
        const insert = db.prepare('INSERT OR IGNORE INTO companion_live_timing VALUES (?, ?, ?, ?, ?)');
        for (const e of events) insert.run(sessionId, source, e.sequence, receivedAt, JSON.stringify(e));
        // Retain at most 100 sessions and 4,000 events per session (2,000 per clock).
        // Prune only on a new session, using the small session index rather than scanning the event log.
        if (created) db.exec(`DELETE FROM companion_live_timing WHERE session_id IN (
          SELECT session_id FROM companion_live_sessions ORDER BY last_received_at DESC, rowid DESC LIMIT -1 OFFSET 100);
          DELETE FROM companion_live_sessions WHERE session_id IN (
          SELECT session_id FROM companion_live_sessions ORDER BY last_received_at DESC, rowid DESC LIMIT -1 OFFSET 100)`);
      });
    } else {
      const current = this.memory.get(sessionId) ?? [];
      for (const e of events) if (!current.some(v => v.source === source && v.sequence === e.sequence)) current.push(e);
      this.memory.set(sessionId, current);
      if (this.memory.size > 100) this.memory.delete(this.memory.keys().next().value!);
    }
  }
  events(sessionId?: string): StoredEvent[] {
    if (this.database) return this.database.read(db => {
      const selected = sessionId ?? (db.prepare('SELECT session_id FROM companion_live_sessions ORDER BY first_received_at DESC, rowid DESC LIMIT 1').get() as { session_id?: string } | undefined)?.session_id;
      if (!selected) return [];
      return (db.prepare('SELECT payload_json FROM companion_live_timing WHERE session_id = ? ORDER BY source, sequence').all(selected) as { payload_json: string }[]).map(row => JSON.parse(row.payload_json));
    });
    return this.memory.get(sessionId ?? [...this.memory.keys()].at(-1) ?? '')?.slice() ?? [];
  }
  report(runs: CompanionRunTelemetryRecord[], sessionId?: string) {
    const events = this.events(sessionId);
    const selected = sessionId ?? events[0]?.sessionId;
    const linked = selected ? runs.filter(r => r.client?.liveSessionId === selected) : [];
    const client = events.filter(e => e.source === 'client').sort((a,b) => a.sequence - b.sequence);
    const hub = events.filter(e => e.source === 'hub').sort((a,b) => a.sequence - b.sequence);
    const gap = (a?: StoredEvent, b?: StoredEvent) => a && b && b.elapsedMs >= a.elapsedMs ? b.elapsedMs - a.elapsedMs : null;
    const first = (list: StoredEvent[], stage: string) => list.find(e => e.stage === stage);
    const intervals = linked.map(r => [Date.parse(r.startedAt), Date.parse(r.finishedAt)]).sort((a,b) => a[0]! - b[0]!);
    let activeMs = 0, end = -Infinity;
    for (const [start, finish] of intervals) { activeMs += Math.max(0, finish! - Math.max(start!, end)); end = Math.max(end, finish!); }
    return {
      sessionId: selected ?? null,
      storage: this.database ? 'database' : 'memory',
      clientSessionDurationMs: gap(first(client, 'session_started'), first(client, 'session_closed')),
      coverage: { clientEvents: client.length, hubEvents: hub.length, clientClosed: client.some(e => e.stage === 'session_closed'),
        providerClosed: hub.some(e => e.stage === 'provider_session_closed'), truncated: events.some(e => e.sequence === 2_000),
        missingHubSequences: hub.length ? hub.at(-1)!.sequence - hub.length : null,
        missingClientSequences: client.length ? client.at(-1)!.sequence - client.length : null },
      startupMs: gap(first(client, 'session_started'), first(client, 'live_ready')),
      captureToFirstSendMs: gap(first(client, 'capture_started'), first(client, 'first_input_audio_sent')),
      providerConnectionMs: gap(first(hub, 'provider_connect_started'), first(hub, 'provider_socket_open')),
      providerSessionStartMs: gap(first(hub, 'provider_socket_open'), first(hub, 'provider_session_started')),
      backend: { runCount: linked.length, activeWallMs: activeMs, runDurationSumMs: linked.reduce((s,r) => s + r.durationMs, 0),
        nonToolWallSumMs: linked.reduce((s,r) => s + (r.modelTiming?.blip?.nonToolWallMs ?? 0), 0),
        toolWallSumMs: linked.reduce((s,r) => s + (r.modelTiming?.blip?.toolCallWallMs ?? 0), 0), runs: linked },
      delegations: client.filter(e => e.stage === 'backend_dispatched').map(dispatch => {
        const result = client.find(e => (e.stage === 'backend_result' || e.stage === 'backend_error') && e.delegationId === dispatch.delegationId && e.sequence > dispatch.sequence);
        const audio = result && client.find(e => e.stage === 'first_audio_received' && e.resultSequence === result.resultSequence);
        const playback = audio && client.find(e => e.stage === 'first_playback_started' && e.resultSequence === audio.resultSequence);
        const matchingRuns = linked.filter(r => r.client?.liveDelegationId === dispatch.delegationId);
        const roundTrip = gap(dispatch, result);
        const outsideBackend = roundTrip !== null && matchingRuns.length === 1 ? roundTrip - matchingRuns[0]!.durationMs : null;
        return { delegationId: dispatch.delegationId,
          status: result ? result.stage === 'backend_error' ? 'error' : 'completed' : 'pending',
          clientAdapterAndTransportMs: outsideBackend !== null && outsideBackend >= 0 ? outsideBackend : null, dispatchWaitMs: dispatch.dispatchMs,
          backendRoundTripMs: gap(dispatch, result), resultToNextAudioMs: gap(result, audio), audioToPlaybackObservedMs: gap(audio, playback) };
      }),
      appends: hub.filter(e => e.stage === 'hub_append_forwarded').map(sent => {
        const received = sent.eventId ? hub.find(e => e.stage === 'hub_append_received' && e.eventId === sent.eventId) : undefined;
        const ack = sent.eventId ? hub.find(e => e.stage === 'provider_append_acknowledged' && e.eventId === sent.eventId) : undefined;
        const submit = sent.eventId ? client.find(e => e.stage === 'append_submitted' && e.eventId === sent.eventId) : undefined;
        const clientAck = sent.eventId ? client.find(e => e.stage === 'append_acknowledged' && e.eventId === sent.eventId) : undefined;
        return { eventId: sent.eventId, delegationId: sent.delegationId, hubForwardMs: gap(received, sent),
          providerAcknowledgmentMs: gap(sent, ack), clientAcknowledgmentMs: gap(submit, clientAck) };
      }),
      limitations: ['Client and Hub elapsed clocks are separate; no one-way network time is inferred.',
        'Provider waits include network and provider processing, not pure model compute.',
        'Next audio is chronological, not proof the result was spoken. Transcript intervals are not turn boundaries.',
        'Playback uses output/render clock observations, not sound arrival at the ear.',
        'Telemetry is bounded and best effort; missing milestones remain null. Backend sums may overlap.'],
      events,
    };
  }
  begin(sessionId: unknown): HubLiveTiming | undefined { return id(sessionId) ? new HubLiveTiming(this, sessionId) : undefined; }
}

export class HubLiveTiming {
  private readonly start = performance.now();
  private sequence = 0;
  private seen = new Set<string>();
  constructor(private readonly store: CompanionLiveTelemetry, readonly sessionId: string) {}
  mark(stage: string, fields: LiveTimingFields = {}) {
    if (this.sequence >= 2_000) return;
    void this.store.record(this.sessionId, 'hub', [{ sessionId: this.sessionId, sequence: ++this.sequence,
      stage, elapsedMs: performance.now() - this.start, resultSequence: 0, ...fields }]).catch(() => undefined);
  }
  once(stage: string) { if (!this.seen.has(stage)) { this.seen.add(stage); this.mark(stage); } }
  client(events: unknown) { void this.store.record(this.sessionId, 'client', events).catch(() => undefined); }
}
