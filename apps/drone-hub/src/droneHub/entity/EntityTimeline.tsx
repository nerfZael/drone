import * as React from 'react';
import type { EntityEvent, EntitySnapshot } from '@entity/core';
import { isEntityActor as isEntity, replayRuntime, snapshotLimbs } from '@entity/core/state';
import { seconds } from './bench-format';
import { requestJson } from '../http';

/**
 * Replay for the entity bench: load a recorded session (see apps/drone/src/hub/entity/entity-recorder.ts),
 * then scrub, step event by event, or play it back. The bench renders the chosen moment.
 */

export type SessionMeta = {
  id: string; status: 'live' | 'ended' | 'interrupted' | 'suspended'; startedAt: string; endedAt?: string; endReason?: string;
  config: Record<string, unknown>; events: number; frames: number; firstMessage?: string;
};
type SnapshotFrame = { seq: number; t: number; patch: Partial<EntitySnapshot> };
type Recording = { meta: SessionMeta; events: EntityEvent[]; frames: SnapshotFrame[] };

/** Frequent low-level events that "skip noise" steps over. */
const NOISE = new Set(['draft_changed', 'sensed', 'program_log', 'run_finished', 'entity_draft', 'timer', 'watch_fired', 'health']);
const SPEEDS = [0.25, 0.5, 1, 2, 4];
/** Longest wait between two events during playback: idle stretches are compressed. */
const MAX_GAP_MS = 1500;

/** Snapshots at every frame, built once: each is the previous one with that frame's changed sections. */
function buildStates(frames: SnapshotFrame[]): EntitySnapshot[] {
  const states: EntitySnapshot[] = [];
  let current = {} as EntitySnapshot;
  for (const frame of frames) {
    current = { ...current, ...frame.patch, t: frame.t } as EntitySnapshot;
    states.push(current);
  }
  return states;
}

/** Index of the last item whose key is <= target, or -1. */
function lastAtOrBefore<T>(list: readonly T[], target: number, key: (item: T) => number): number {
  let lo = 0; let hi = list.length - 1; let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(list[mid]) <= target) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

export type Replay = ReturnType<typeof useEntityReplay>;

export function useEntityReplay() {
  const [recording, setRecording] = React.useState<Recording | null>(null);
  const [index, setIndex] = React.useState(-1);
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState(1);
  const [skipNoise, setSkipNoise] = React.useState(true);
  const [sessions, setSessions] = React.useState<SessionMeta[]>([]);
  const [dir, setDir] = React.useState('');
  const [error, setError] = React.useState('');
  const states = React.useMemo(() => (recording ? buildStates(recording.frames) : []), [recording]);
  const events = recording?.events ?? [];

  const refreshSessions = React.useCallback(async () => {
    try {
      const body = await requestJson<{ sessions: SessionMeta[]; dir: string | null }>('/api/entity/sessions');
      setSessions(body.sessions);
      setDir(body.dir ?? '');
      return body.sessions;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return [];
    }
  }, []);

  /** Opens a session at a position: 'end', or the index to keep (clamped) when reloading. */
  const open = React.useCallback(async (id: string, at: 'end' | number = 'end') => {
    try {
      setError('');
      const body = await requestJson<Recording>(`/api/entity/sessions/${encodeURIComponent(id)}`);
      setRecording({ meta: body.meta, events: body.events, frames: body.frames });
      setIndex(at === 'end' ? body.events.length - 1 : Math.min(at, body.events.length - 1));
      setPlaying(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const close = React.useCallback(() => { setRecording(null); setPlaying(false); setIndex(-1); }, []);

  const visible = React.useCallback((i: number) => !skipNoise || !NOISE.has(events[i]?.type), [events, skipNoise]);
  const neighbour = React.useCallback((from: number, direction: 1 | -1) => {
    for (let i = from + direction; i >= 0 && i < events.length; i += direction) if (visible(i)) return i;
    return direction === -1 && from > -1 ? -1 : null;
  }, [events.length, visible]);
  const step = React.useCallback((direction: 1 | -1, count = 1) => {
    setPlaying(false);
    setIndex((current) => {
      let next = current;
      for (let n = 0; n < count; n++) { const i = neighbour(next, direction); if (i === null) break; next = i; }
      return next;
    });
  }, [neighbour]);
  const seek = React.useCallback((i: number) => setIndex(Math.max(-1, Math.min(events.length - 1, i))), [events.length]);
  const seekTime = React.useCallback((t: number) => seek(lastAtOrBefore(events, t, (e) => e.t)), [events, seek]);

  // Playback: wait the recorded gap (scaled, idle compressed), then advance to the next shown event.
  React.useEffect(() => {
    if (!playing) return;
    const next = neighbour(index, 1);
    if (next === null || next < 0) { setPlaying(false); return; }
    const gap = (events[next].t - (events[index]?.t ?? 0)) / speed;
    const timer = setTimeout(() => setIndex(next), Math.max(0, Math.min(MAX_GAP_MS, gap)));
    return () => clearTimeout(timer);
  }, [playing, index, speed, events, neighbour]);

  const togglePlay = React.useCallback(() => {
    // Playing from the end starts over.
    if (!playing && index >= events.length - 1) setIndex(-1);
    setPlaying(!playing);
  }, [playing, index, events.length]);

  /** Recordings whose log carries its setup rebuild the runtime state from the log; older ones read it from frames. */
  const fromLog = React.useMemo(() => events.some((e) => e.type === 'session_started' && e.data.setup), [events]);

  /** The bench at the current position: events so far and the snapshot after the current event. */
  const view = React.useMemo(() => {
    if (!recording || !states.length) return null;
    const event = events[index];
    const frame = event ? Math.max(0, lastAtOrBefore(recording.frames, event.seq, (f) => f.seq)) : 0;
    const shown = events.slice(0, index + 1);
    let snapshot = { ...states[frame], t: event?.t ?? 0 } as EntitySnapshot;
    if (fromLog) {
      // Frames carry the channels' world, levels and senses; limbs, stops, notes, health and usage are the log's.
      const runtime = replayRuntime(shown, events.find((e) => e.type === 'session_started')?.data.setup as never);
      snapshot = {
        ...snapshot, limbs: snapshotLimbs(runtime), stops: runtime.stops, self: { notes: runtime.notes }, health: runtime.health,
        usage: runtime.usage, usageBy: runtime.usageBy,
      };
    }
    return { events: shown, snapshot, event };
  }, [recording, states, events, index, fromLog]);

  return {
    recording, index, playing, speed, skipNoise, sessions, dir, error, view,
    open, close, refreshSessions, step, seek, seekTime, togglePlay, setSpeed, setSkipNoise,
    setPlaying,
  };
}

/** Arrow keys step, Shift jumps 10, Space plays, Home and End go to the ends; not while typing. */
export function useReplayKeys(replay: Replay) {
  const active = !!replay.recording;
  const ref = React.useRef(replay);
  ref.current = replay;
  React.useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const r = ref.current;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') r.step(e.key === 'ArrowRight' ? 1 : -1, e.shiftKey ? 10 : 1);
      else if (e.key === ' ') r.togglePlay();
      else if (e.key === 'Home') { r.setPlaying(false); r.seek(-1); }
      else if (e.key === 'End') { r.setPlaying(false); r.seek(Number.MAX_SAFE_INTEGER); }
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}

/** The bar under the bench: Live, or a replay's transport, scrubber and current event. */
export function EntityTimeline({ replay, liveSessionId, liveLastSeq }: { replay: Replay; liveSessionId: string | null; liveLastSeq: number }) {
  const { recording } = replay;
  const enter = async () => {
    const sessions = await replay.refreshSessions();
    const id = liveSessionId ?? sessions[0]?.id;
    if (id) await replay.open(id);
  };
  if (!recording) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border)] bg-[var(--panel-alt)] px-3 py-1.5 text-[12px] text-[var(--muted)]">
        <span className="flex items-center gap-1.5 font-medium text-[var(--fg)]"><span className="inline-block h-2 w-2 rounded-full bg-[var(--red)] animate-pulse-dot" />Live</span>
        <span>{liveSessionId ? `recording ${liveSessionId}` : 'recording starts with Start'}</span>
        <button type="button" className="ml-auto rounded border border-[var(--border)] px-2 py-0.5 text-[var(--fg)] hover:bg-[var(--hover)]" onClick={() => void enter()}
          title="Scrub, step and play back this session or an earlier one">
          ⏮ Replay
        </button>
        {replay.error ? <span className="text-[var(--red)]">{replay.error}</span> : null}
      </div>
    );
  }
  const { events } = recording;
  const current = replay.view?.event;
  const newer = recording.meta.id === liveSessionId ? liveLastSeq - (events[events.length - 1]?.seq ?? 0) : 0;
  const button = 'rounded px-1.5 py-0.5 text-[var(--fg)] hover:bg-[var(--hover)] disabled:opacity-40';
  return (
    <div className="flex shrink-0 flex-col gap-1 border-t border-[var(--border)] bg-[var(--panel-alt)] px-3 py-1.5 text-[12px] text-[var(--muted)]" data-entity-timeline="">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button type="button" className="flex items-center gap-1.5 rounded border border-[var(--border)] px-2 py-0.5 hover:bg-[var(--hover)]" onClick={replay.close} title="Back to the live session">
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--muted-dim)]" />Live
        </button>
        <select className="max-w-[260px] rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-0.5 text-[var(--fg)]" value={recording.meta.id}
          onFocus={() => void replay.refreshSessions()} onChange={(e) => void replay.open(e.target.value)} title={replay.dir ? `Recorded in ${replay.dir}` : undefined}>
          {(replay.sessions.some((s) => s.id === recording.meta.id) ? replay.sessions : [recording.meta, ...replay.sessions]).map((s) => (
            <option key={s.id} value={s.id}>{sessionLabel(s)}</option>
          ))}
        </select>
        <div className="flex items-center" role="group" aria-label="Transport">
          <button type="button" className={button} onClick={() => { replay.setPlaying(false); replay.seek(-1); }} title="Start (Home)" aria-label="Go to start">⏮</button>
          <button type="button" className={button} onClick={() => replay.step(-1)} disabled={replay.index < 0} title="Previous event (←, Shift+← for 10)" aria-label="Previous event">◀</button>
          <button type="button" className={`${button} w-7`} onClick={replay.togglePlay} title="Play or pause (Space)" aria-label={replay.playing ? 'Pause' : 'Play'}>{replay.playing ? '❚❚' : '▶'}</button>
          <button type="button" className={button} onClick={() => replay.step(1)} disabled={replay.index >= events.length - 1} title="Next event (→, Shift+→ for 10)" aria-label="Next event">▶︎|</button>
          <button type="button" className={button} onClick={() => { replay.setPlaying(false); replay.seek(events.length - 1); }} title="End (End)" aria-label="Go to end">⏭</button>
        </div>
        <select className="rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-0.5 text-[var(--fg)]" value={replay.speed} onChange={(e) => replay.setSpeed(Number(e.target.value))} title="Playback speed">
          {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
        <label className="flex items-center gap-1" title="Step and play over drafts, sense updates, program logs and run ends">
          <input type="checkbox" checked={replay.skipNoise} onChange={(e) => replay.setSkipNoise(e.target.checked)} /> skip noise
        </label>
        {newer > 0 ? (
          <button type="button" className="rounded border border-[var(--accent)] px-1.5 py-0.5 text-[var(--accent)] hover:bg-[var(--hover)]" onClick={() => void replay.open(recording.meta.id, replay.index)}>
            ↻ {newer} new
          </button>
        ) : null}
        <span className="ml-auto font-mono text-[11px]">{replay.index + 1} / {events.length} · {seconds(current?.t ?? 0)}</span>
      </div>
      <Scrubber events={events} index={replay.index} onSeekTime={(t) => { replay.setPlaying(false); replay.seekTime(t); }} />
      <div className="truncate font-mono text-[11px]" title={current ? JSON.stringify(current.data) : undefined}>
        {current ? (
          <>
            <span className="text-[var(--muted-dim)]">#{current.seq}</span>{' '}
            <span style={{ color: actorColor(current.by) }}>{current.by}</span>{' '}
            <span className="text-[var(--accent)]">{current.type}</span>{' '}
            <span>{JSON.stringify(current.data)}</span>
          </>
        ) : <span>before the first event</span>}
        {replay.error ? <span className="ml-2 text-[var(--red)]">{replay.error}</span> : null}
      </div>
    </div>
  );
}

function sessionLabel(s: SessionMeta): string {
  const started = new Date(s.startedAt);
  const when = `${started.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${started.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  const status = s.status === 'live' ? ' · live' : s.status === 'interrupted' ? ' · interrupted' : s.status === 'suspended' ? ' · suspended' : '';
  return `${when} · ${s.events} ev${status}${s.firstMessage ? ` · ${s.firstMessage.slice(0, 40)}` : ''}`;
}

const actorColor = (by: string) => by === 'user' ? 'var(--accent)' : isEntity(by) ? 'var(--green, #3fb950)' : 'var(--muted)';

const BUCKETS = 360;

/** Event density along the session's time axis, a playhead, and click-or-drag to seek. */
function Scrubber({ events, index, onSeekTime }: { events: EntityEvent[]; index: number; onSeekTime(t: number): void }) {
  const track = React.useRef<HTMLDivElement | null>(null);
  const end = Math.max(1, events[events.length - 1]?.t ?? 1);
  // Each bucket shows its most telling actor: the user over the entity over the runtime.
  const buckets = React.useMemo(() => {
    const out: (string | null)[] = new Array(BUCKETS).fill(null);
    const rank = (by: string) => (by === 'user' ? 3 : isEntity(by) ? 2 : 1);
    for (const e of events) {
      const i = Math.min(BUCKETS - 1, Math.floor((e.t / end) * BUCKETS));
      if (!out[i] || rank(e.by) > rank(out[i]!)) out[i] = e.by;
    }
    return out;
  }, [events, end]);
  const at = index >= 0 ? (events[index]?.t ?? 0) / end : 0;
  const seekFrom = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect) return;
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onSeekTime(fraction * end);
  };
  return (
    <div ref={track} className="relative h-5 cursor-pointer select-none rounded bg-[var(--panel)]" role="slider" aria-label="Session timeline"
      aria-valuemin={0} aria-valuemax={events.length} aria-valuenow={index + 1}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); seekFrom(e.clientX); }}
      onPointerMove={(e) => { if (e.buttons & 1) seekFrom(e.clientX); }}>
      {buckets.map((by, i) => by ? (
        <span key={i} className="absolute top-1 bottom-1 w-px" style={{ left: `${(i / BUCKETS) * 100}%`, background: actorColor(by), opacity: by === 'system' ? 0.5 : 0.85 }} />
      ) : null)}
      <span className="pointer-events-none absolute inset-y-0 left-0 rounded-l bg-[var(--accent)] opacity-10" style={{ width: `${at * 100}%` }} />
      <span className="pointer-events-none absolute -top-0.5 -bottom-0.5 w-0.5 -translate-x-1/2 rounded bg-[var(--fg-strong,#fff)] shadow" style={{ left: `${at * 100}%` }} />
    </div>
  );
}
