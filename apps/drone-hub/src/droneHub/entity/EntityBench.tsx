import * as React from 'react';
import type { EntityEvent, EntitySnapshot } from '@entity/core';
import { UiButton } from '../../ui/components/Button';
import { EntityBrain } from './EntityBrain';
import { EntityWork } from './EntityWork';
import { MarkdownMessage } from '../chat/MarkdownMessage';
import type { WorkLink } from './EntityWorkCanvas';
import { EntityTimeline, useEntityReplay, useReplayKeys } from './EntityTimeline';
import { useEntitySession, type EntityConfig } from './use-entity-session';
import type { FolderWorkspaceTarget } from '../files/FolderWorkspaceFiles';

// The explorer and editor are heavy; load them the first time the Files view opens.
const FolderWorkspaceFiles = React.lazy(() => import('../files/FolderWorkspaceFiles').then(m => ({ default: m.FolderWorkspaceFiles })));
/** The Hub serves the entity workspace through the drone file routes under this id (see folder-workspaces.ts). */
const ENTITY_WORKSPACE_ID = 'entity-workspace';
type BenchView = 'brain' | 'work' | 'inspector' | 'files';

const MODELS = ['openai-codex/gpt-6-luna', 'openai-codex/gpt-6-sol', 'cerebras/qwen-3.8-27b'];
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const isEntity = (by: string) => by !== 'user' && by !== 'host' && by !== 'system';
const seconds = (t: number) => `${(t / 1000).toFixed(2)}s`;

/** The entity test bench: chat, keypad and inspector over the Hub's live entity session. */
export function EntityBench() {
  const session = useEntitySession(true);
  const [view, setView] = React.useState<BenchView>('brain');
  const [target, setTarget] = React.useState<(FolderWorkspaceTarget & { sequence: number }) | null>(null);
  const openFile = React.useCallback((path: string) => { setTarget(t => ({ path, sequence: (t?.sequence ?? 0) + 1 })); setView('files'); }, []);
  const replay = useEntityReplay();
  // The chat and the Work canvas highlight each other, and a worker's reply in the chat opens it on the canvas.
  const [link, setLink] = React.useState<WorkLink>(null);
  const [openWorker, setOpenWorker] = React.useState<{ id: string; n: number } | null>(null);
  const showWorker = React.useCallback((id: string) => { setView('work'); setOpenWorker(o => ({ id, n: (o?.n ?? 0) + 1 })); }, []);
  useReplayKeys(replay);
  const { state } = session;
  if (!state) {
    return <div className="flex h-full items-center justify-center text-[var(--muted)]">{session.error || 'Connecting to the entity…'}</div>;
  }
  const { config } = state;
  // Replaying: every pane shows the chosen moment of the recording; the header still drives the live session.
  const replaying = replay.view;
  const snapshot = replaying ? replaying.snapshot : state.snapshot;
  const events = replaying ? replaying.events : state.events;
  const locked = !!replaying || state.snapshot.status === 'idle';
  const brain = view === 'brain';
  return (
    <div className="flex h-full min-h-0 flex-col text-[13px]" data-entity-bench="">
      <BenchHeader snapshot={state.snapshot} config={config} connected={session.connected} error={session.error}
        onControl={session.control} onConfigure={session.configure} view={view} onView={setView} />
      {view === 'files' ? (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,0.8fr)_minmax(420px,2fr)] gap-px bg-[var(--border)]">
          <ChatPane events={events} snapshot={snapshot} disabled={locked} replaying={!!replaying} onInput={session.input} />
          <div className="min-h-0 bg-[var(--panel)]">
            <React.Suspense fallback={<div className="p-3 text-[var(--muted)]">Loading files…</div>}>
              {/* Keyed by folder: changing the workspace setting starts a fresh explorer. */}
              <FolderWorkspaceFiles key={config.workspace} workspaceId={ENTITY_WORKSPACE_ID} name="Entity workspace" target={target} className="h-full" />
            </React.Suspense>
          </div>
        </div>
      ) : (
        <div className={`grid min-h-0 flex-1 gap-px bg-[var(--border)] ${brain || view === 'work' ? 'grid-cols-[minmax(240px,0.9fr)_200px_minmax(440px,2fr)]' : 'grid-cols-[minmax(260px,1.1fr)_220px_minmax(300px,1.2fr)]'}`}>
          <ChatPane events={events} snapshot={snapshot} disabled={locked} replaying={!!replaying} onInput={session.input}
            link={view === 'work' ? link : null} onLink={setLink} onOpenWorker={showWorker} />
          <KeypadPane events={events} snapshot={snapshot} disabled={locked} onInput={session.input} />
          {brain ? <EntityBrain events={events} snapshot={snapshot} live={!replaying} />
            : view === 'work' ? <EntityWork events={events} snapshot={snapshot} live={!replaying} onWorker={session.worker} link={link} onLink={l => setLink(l && { ...l, from: 'canvas' })} openWorker={openWorker} onReroute={session.reroute} />
            : <Inspector events={events} snapshot={snapshot} onOpenFile={openFile} />}
        </div>
      )}
      <EntityTimeline replay={replay} liveSessionId={state.sessionId} liveLastSeq={state.events[state.events.length - 1]?.seq ?? 0} />
    </div>
  );
}

function BenchHeader({ snapshot, config, connected, error, onControl, onConfigure, view, onView }: {
  snapshot: EntitySnapshot; config: EntityConfig; connected: boolean; error: string;
  onControl(action: 'start' | 'pause' | 'resume' | 'reset'): void; onConfigure(update: Partial<EntityConfig>): void;
  view: BenchView; onView(view: BenchView): void;
}) {
  const idle = snapshot.status === 'idle';
  const statusColor = snapshot.status === 'running' ? 'var(--green, #3fb950)' : snapshot.status === 'paused' ? 'var(--yellow, #d29922)' : 'var(--muted)';
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--panel-alt)] px-3 py-2">
      <span className="flex items-center gap-1.5 font-medium">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: statusColor }} />
        Entity · {snapshot.status}
      </span>
      {!connected ? <span className="text-[var(--red)]">disconnected</span> : null}
      <div className="flex gap-1.5">
        {idle ? <UiButton size="small" variant="primary" onClick={() => onControl('start')}>Start</UiButton> : null}
        {snapshot.status === 'running' ? <UiButton size="small" variant="secondary" onClick={() => onControl('pause')}>Pause</UiButton> : null}
        {snapshot.status === 'paused' ? <UiButton size="small" variant="primary" onClick={() => onControl('resume')}>Resume</UiButton> : null}
        {!idle ? <UiButton size="small" variant="danger" onClick={() => onControl('reset')}>Reset</UiButton> : null}
      </div>
      <div className="flex rounded border border-[var(--border)] p-px" role="tablist" aria-label="Right pane">
        {(['brain', 'work', 'inspector', 'files'] as const).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={view === id}
            className={`rounded-sm px-2 py-0.5 capitalize ${view === id ? 'bg-[var(--hover)] text-[var(--fg)]' : 'text-[var(--muted)]'}`}
            onClick={() => onView(id)}>{id}</button>
        ))}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2 text-[var(--muted)]">
        <ModelSelect label="Voice" value={config.voiceModel} disabled={!idle} onChange={(voiceModel) => onConfigure({ voiceModel })} allowNone
          title="A fast model that answers first and hands off to the head. Off: the head is the voice." />
        <ModelSelect label="Head" value={config.headModel} disabled={!idle} onChange={(headModel) => onConfigure({ headModel })} />
        <ModelSelect label="Tasks" value={config.taskModel} disabled={!idle} onChange={(taskModel) => onConfigure({ taskModel })} />
        <label className="flex items-center gap-1" title="Second looks at the fast answers: a separate reviewer on the head's model (the head stays free), the head itself, or none. Wrong answers are struck through and corrected below.">
          Review
          <select className="rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-0.5 text-[var(--fg)]" value={config.review ?? 'separate'} disabled={!idle}
            onChange={(e) => onConfigure({ review: e.target.value as EntityConfig['review'] })}>
            <option value="separate">reviewer</option>
            <option value="head">head</option>
            <option value="off">off</option>
          </select>
        </label>
        <label className="flex items-center gap-1" title="What backs judge() and sense(). Jev is billed per call through the AI Gateway; qwen is a small fast LLM on Cerebras.">
          Senses
          <select className="rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-0.5 text-[var(--fg)]" value={config.evaluator} disabled={!idle}
            onChange={(e) => onConfigure({ evaluator: e.target.value as EntityConfig['evaluator'] })}>
            <option value="off">off</option>
            <option value="jev">Jev</option>
            <option value="qwen">qwen (Cerebras)</option>
          </select>
        </label>
        <span title="judge/sense calls this session">{snapshot.jev.available ? `${snapshot.jev.calls} calls` : ''}</span>
      </div>
      <SettingsRow config={config} idle={idle} onConfigure={onConfigure} />
      {error ? <div role="alert" className="w-full text-[var(--red)]">{error}</div> : null}
    </div>
  );
}

function SettingsRow({ config, idle, onConfigure }: { config: EntityConfig; idle: boolean; onConfigure(update: Partial<EntityConfig>): void }) {
  const [workspace, setWorkspace] = React.useState(config.workspace);
  React.useEffect(() => setWorkspace(config.workspace), [config.workspace]);
  return (
    <div className="flex w-full flex-wrap items-center gap-3 text-[var(--muted)]" title={idle ? undefined : 'Reset the session to change settings'}>
      <label className="flex min-w-0 flex-1 items-center gap-1" title="Folder the workspace tools are confined to. Empty: a scratch folder in the Hub's data directory.">
        Workspace
        <input className="min-w-[200px] flex-1 rounded border border-[var(--border)] bg-[var(--panel)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--fg)]"
          placeholder="scratch folder (absolute path to use a repo)" value={workspace} disabled={!idle}
          onChange={(e) => setWorkspace(e.target.value)}
          onBlur={() => { if (workspace !== config.workspace) onConfigure({ workspace }); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      </label>
      <label className="flex items-center gap-1" title="Let workers run shell commands (tests, builds) in the workspace. These are LLM-written commands running on this machine.">
        <input type="checkbox" checked={config.allowCommands} disabled={!idle} onChange={(e) => onConfigure({ allowCommands: e.target.checked })} />
        Allow commands
      </label>
    </div>
  );
}

function ModelSelect({ label, value, disabled, onChange, allowNone, title }: {
  label: string; value: string; disabled: boolean; onChange(value: string): void; allowNone?: boolean; title?: string;
}) {
  return (
    <label className="flex items-center gap-1" title={disabled ? 'Reset the session to change models' : title}>
      {label}
      <select className="rounded border border-[var(--border)] bg-[var(--panel)] px-1 py-0.5 text-[var(--fg)]" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {allowNone ? <option value="">off (head)</option> : null}
        {MODELS.map((model) => <option key={model} value={model}>{model.split('/')[1]}</option>)}
      </select>
    </label>
  );
}

function ChatPane({ events, snapshot, disabled, replaying, onInput, link, onLink, onOpenWorker }: {
  events: EntityEvent[]; snapshot: EntitySnapshot; disabled: boolean; replaying?: boolean; onInput(type: string, data: Record<string, unknown>): void;
  /** Highlighted together with the Work canvas. */
  link?: WorkLink;
  onLink?(link: WorkLink): void;
  onOpenWorker?(id: string): void;
}) {
  const [text, setText] = React.useState('');
  const draftTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottom = React.useRef<HTMLDivElement | null>(null);
  // Thread replies (workers in a batch) live in the worker's thread on the Work canvas, not here.
  const messages = events.filter((e) => e.type === 'chat_message' && !e.data.thread);
  // A batch's progress line is one message whose text is updated in place.
  const updated = new Map<number, string>();
  for (const e of events) if (e.type === 'chat_message_updated') updated.set(Number(e.data.seq), String(e.data.text));
  // Second looks at fast answers: checking, then confirmed, corrected (struck through, the correction below) or expanded.
  const review = new Map<number, { state: string; by?: number }>();
  for (const e of events) {
    if (e.type === 'review_queued') review.set(Number(e.data.seq), { state: 'checking' });
    if (e.type === 'message_reviewed') review.set(Number(e.data.seq), { state: String(e.data.verdict), by: typeof e.data.by === 'number' ? e.data.by : undefined });
  }
  const jump = (seq: number) => list.current?.querySelector(`[data-seq="${seq}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const chat = snapshot.world.chat as { entityDraft?: { text: string } | null } | undefined;
  React.useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [messages.length, chat?.entityDraft?.text]);
  const workerOf = (id: string) => snapshot.limbs.find(l => l.id === id && l.role === 'task');
  const linkedTo = (m: EntityEvent) => !!link && (link.message === m.seq || (!!link.worker && (m.by === link.worker || workerOf(link.worker)?.replyTo === m.seq)));
  const list = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    // Only a highlight that came from the canvas scrolls the chat; hovering here must not move what you point at.
    if (!link || link.from === 'chat') return;
    list.current?.querySelector('[data-linked="true"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [link]);
  const sendDraft = (value: string) => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => onInput('draft_changed', { text: value }), 120);
  };
  const send = () => {
    const value = text.trim();
    if (!value) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    onInput('chat_message', { text: value });
    setText('');
  };
  return (
    <section className="flex min-h-0 flex-col bg-[var(--panel)]" aria-label="Chat">
      <div ref={list} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
        {messages.length === 0 ? <div className="text-[var(--muted)]">{disabled ? 'Press Start to wake the entity.' : 'Say something, or press keys.'}</div> : null}
        {messages.map((m) => {
          const mine = m.by === 'user';
          const replyTo = typeof m.data.reply_to === 'number' ? messages.find((x) => x.seq === m.data.reply_to) : undefined;
          const worker = workerOf(m.by);
          const label = !mine && m.by !== 'head' ? (worker ? worker.name : m.by) : null;
          const linked = linkedTo(m);
          const reviewed = review.get(m.seq);
          const amends = typeof m.data.corrects === 'number' ? { seq: m.data.corrects, kind: 'Correction to' } : typeof m.data.expands === 'number' ? { seq: m.data.expands, kind: 'Adds to' } : undefined;
          const amended = amends ? messages.find(x => x.seq === amends.seq) : undefined;
          return (
            <div key={m.seq} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div data-linked={linked} data-seq={m.seq} className={`max-w-[85%] rounded-lg px-2.5 py-1.5 transition-colors ${mine ? 'whitespace-pre-wrap' : ''} ${linked ? (mine ? 'bg-[color-mix(in_srgb,var(--accent)_30%,var(--panel-alt))]' : 'bg-[color-mix(in_srgb,var(--accent)_16%,var(--panel-alt))]') : mine ? 'bg-[var(--accent-subtle,var(--hover))]' : 'bg-[var(--panel-alt)]'} ${worker ? 'cursor-pointer' : ''}`}
                title={`#${m.seq} ${m.by} at ${seconds(m.t)}${worker ? ' · click to open it on the Work canvas' : ''}`}
                onMouseEnter={() => onLink?.(worker ? { worker: m.by, from: 'chat' } : mine ? { message: m.seq, from: 'chat' } : null)}
                onMouseLeave={() => onLink?.(null)}
                onClick={() => { if (worker) onOpenWorker?.(m.by); }}>
                {label || replyTo || reviewed || amends ? (
                  <div className="mb-0.5 flex flex-wrap gap-x-1.5 text-[11px] text-[var(--muted)]">
                    {amends ? (
                      <button type="button" className="font-medium text-[var(--accent)] hover:underline" onClick={e => { e.stopPropagation(); jump(amends.seq); }}>
                        {amends.kind} “{String(amended?.data.text ?? '').slice(0, 40)}{String(amended?.data.text ?? '').length > 40 ? '…' : ''}”
                      </button>
                    ) : <span>{label}{replyTo ? `${label ? ' · ' : ''}↳ “${String(replyTo.data.text).slice(0, 48)}${String(replyTo.data.text).length > 48 ? '…' : ''}”` : ''}</span>}
                    {reviewed?.state === 'checking' ? <span className="italic opacity-80" title="A stronger model is taking a second look">checking…</span> : null}
                    {reviewed?.state === 'confirmed' ? <span title="Checked by the reviewer" style={{ color: 'var(--green, #3fb950)' }}>✓</span> : null}
                    {reviewed?.state === 'corrected' && reviewed.by !== undefined ? (
                      <button type="button" className="font-medium hover:underline" style={{ color: 'var(--orange, #e8773a)' }} onClick={e => { e.stopPropagation(); jump(reviewed.by!); }}>corrected below ↓</button>
                    ) : null}
                    {reviewed?.state === 'expanded' && reviewed.by !== undefined ? (
                      <button type="button" className="hover:underline" onClick={e => { e.stopPropagation(); jump(reviewed.by!); }}>more below ↓</button>
                    ) : null}
                  </div>
                ) : null}
                <div className={reviewed?.state === 'corrected' ? 'text-[var(--muted)] line-through' : undefined}>
                  {mine ? (updated.get(m.seq) ?? String(m.data.text)) : <MarkdownMessage text={updated.get(m.seq) ?? String(m.data.text)} className="dh-markdown--agent entity-md" />}
                </div>
              </div>
            </div>
          );
        })}
        {chat?.entityDraft?.text ? (
          <div className="flex justify-start"><div className="max-w-[85%] rounded-lg border border-dashed border-[var(--border)] px-2.5 py-1.5 italic text-[var(--muted)]">{chat.entityDraft.text}</div></div>
        ) : null}
        <div ref={bottom} />
      </div>
      <div className="border-t border-[var(--border)] p-2">
        <textarea
          className="h-16 w-full resize-none rounded border border-[var(--border)] bg-[var(--panel-alt)] p-2 text-[var(--fg)] outline-none"
          placeholder={replaying ? 'Replaying: go Live to talk to the entity' : disabled ? 'Start the session first' : 'Type… the entity sees your draft as you type (Enter sends)'}
          disabled={disabled}
          value={text}
          onChange={(e) => { setText(e.target.value); sendDraft(e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
      </div>
    </section>
  );
}

function KeypadPane({ events, snapshot, disabled, onInput }: {
  events: EntityEvent[]; snapshot: EntitySnapshot; disabled: boolean; onInput(type: string, data: Record<string, unknown>): void;
}) {
  const held = ((snapshot.world.keypad as { held?: Record<string, { by: string }> } | undefined)?.held) ?? {};
  const userDown = React.useRef(new Set<string>());
  const [flash, setFlash] = React.useState<Record<string, number>>({});
  const lastSeq = React.useRef(0);
  const flashTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Entity taps are down+up in the same instant, so they flash briefly. The clearing timer is
  // owned by a ref, not the effect: unrelated events arriving must not cancel it.
  React.useEffect(() => {
    const fresh = events.filter((e) => e.seq > lastSeq.current && e.type === 'key_down' && isEntity(e.by));
    if (events.length) lastSeq.current = events[events.length - 1].seq;
    if (!fresh.length) return;
    setFlash((current) => ({ ...current, ...Object.fromEntries(fresh.map((e) => [String(e.data.key), Date.now()])) }));
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => { flashTimer.current = null; setFlash({}); }, 260);
  }, [events]);
  React.useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);
  const down = (key: string) => { if (disabled || userDown.current.has(key)) return; userDown.current.add(key); onInput('key_down', { key }); };
  const up = (key: string) => { if (!userDown.current.delete(key)) return; onInput('key_up', { key }); };
  const recent = events.filter((e) => e.type === 'key_down').slice(-12);
  return (
    <section className="flex min-h-0 flex-col items-center gap-3 bg-[var(--panel)] p-3" aria-label="Keypad">
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((key) => {
          const holder = held[key]?.by;
          const entityActive = (holder && isEntity(holder)) || flash[key];
          const userActive = holder === 'user';
          return (
            <button key={key} type="button" disabled={disabled}
              className={`h-14 w-14 select-none rounded-lg border text-lg font-medium transition-colors ${key === '0' ? 'col-start-2' : ''}`}
              style={{
                borderColor: entityActive ? 'var(--green, #3fb950)' : userActive ? 'var(--accent)' : 'var(--border)',
                background: entityActive ? 'color-mix(in srgb, var(--green, #3fb950) 30%, var(--panel-alt))' : userActive ? 'color-mix(in srgb, var(--accent) 30%, var(--panel-alt))' : 'var(--panel-alt)',
              }}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); down(key); }}
              onPointerUp={() => up(key)}
              onPointerCancel={() => up(key)}
              aria-label={`Key ${key}${holder ? `, held by ${holder}` : ''}`}>
              {key}
            </button>
          );
        })}
      </div>
      <div className="flex gap-3 text-[11px] text-[var(--muted)]">
        <span><span style={{ color: 'var(--accent)' }}>■</span> you</span>
        <span><span style={{ color: 'var(--green, #3fb950)' }}>■</span> entity</span>
      </div>
      <div className="w-full min-h-0 flex-1 overflow-y-auto text-[11px] text-[var(--muted)]">
        {recent.slice().reverse().map((e) => <div key={e.seq}>{seconds(e.t)} {e.by} ↓{String(e.data.key)}</div>)}
      </div>
    </section>
  );
}

type InspectorTab = 'limbs' | 'events' | 'state' | 'latency';

function Inspector({ events, snapshot, onOpenFile }: { events: EntityEvent[]; snapshot: EntitySnapshot; onOpenFile(path: string): void }) {
  const [tab, setTab] = React.useState<InspectorTab>('limbs');
  return (
    <section className="flex min-h-0 flex-col bg-[var(--panel)]" aria-label="Inspector">
      <div className="flex shrink-0 gap-1 border-b border-[var(--border)] px-2 py-1" role="tablist">
        {(['limbs', 'events', 'state', 'latency'] as const).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id}
            className={`rounded px-2 py-0.5 capitalize ${tab === id ? 'bg-[var(--hover)] text-[var(--fg)]' : 'text-[var(--muted)]'}`}
            onClick={() => setTab(id)}>{id}</button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 font-mono text-[11px] leading-[1.45]">
        {tab === 'limbs' ? <LimbsView snapshot={snapshot} /> : null}
        {tab === 'events' ? <EventsView events={events} onOpenFile={onOpenFile} /> : null}
        {tab === 'state' ? <StateView snapshot={snapshot} /> : null}
        {tab === 'latency' ? <LatencyView events={events} /> : null}
      </div>
    </section>
  );
}

function LimbsView({ snapshot }: { snapshot: EntitySnapshot }) {
  const byParent = new Map<string | undefined, EntitySnapshot['limbs']>();
  for (const limb of snapshot.limbs) byParent.set(limb.parent, [...(byParent.get(limb.parent) ?? []), limb]);
  const render = (parent: string | undefined, depth: number): React.ReactNode =>
    (byParent.get(parent) ?? []).map((limb) => (
      <div key={limb.id} style={{ marginLeft: depth * 12 }} className="mb-1.5">
        <div>
          <span className={limb.status === 'running' || limb.runs.length ? 'text-[var(--fg)]' : 'text-[var(--muted)]'}>{limb.id}</span>
          <span className="text-[var(--muted)]"> {limb.role} “{limb.name}” · {limb.runs.length ? `thinking (${limb.runs.map((r) => r.reason).join('; ')})` : limb.status}</span>
          {limb.model ? <span className="text-[var(--muted)]"> · {limb.model.split('/')[1]}</span> : null}
          {limb.fires ? <span className="text-[var(--muted)]"> · fired {limb.fires}×</span> : null}
        </div>
        {limb.task ? <div className="text-[var(--muted)]">task: {limb.task}</div> : null}
        {limb.result ? <div className="text-[var(--muted)]">result: {limb.result}</div> : null}
        {limb.watch ? <div className="text-[var(--muted)]">on {JSON.stringify(limb.watch.on)} → {JSON.stringify(limb.watch.do).slice(0, 200)}</div> : null}
        {limb.code ? <details><summary className="cursor-pointer text-[var(--muted)]">code</summary><pre className="whitespace-pre-wrap">{limb.code}</pre></details> : null}
        {render(limb.id, depth + 1)}
      </div>
    ));
  return <div>{render(undefined, 0)}</div>;
}

const NOISE = new Set(['draft_changed', 'sensed', 'run_finished', 'program_log']);

function EventsView({ events, onOpenFile }: { events: EntityEvent[]; onOpenFile(path: string): void }) {
  const [all, setAll] = React.useState(false);
  const shown = events.filter((e) => all || !NOISE.has(e.type)).slice(-400).reverse();
  return (
    <div>
      <label className="mb-1 flex items-center gap-1 font-sans text-[var(--muted)]"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> include drafts, senses, logs</label>
      {shown.map((e) => (
        <div key={e.seq} className="border-b border-[var(--border-subtle,var(--border))] py-0.5">
          <span className="text-[var(--muted)]">{seconds(e.t)} #{e.seq}</span> <span>{e.by}</span> <span className="text-[var(--accent)]">{e.type}</span>{' '}
          {e.type === 'file_written' ? <button type="button" className="mr-1 underline" onClick={() => onOpenFile(String(e.data.path))}>{String(e.data.path)}</button> : null}
          <span className="break-all text-[var(--muted)]">{JSON.stringify(e.data).slice(0, 300)}</span>
        </div>
      ))}
    </div>
  );
}

function StateView({ snapshot }: { snapshot: EntitySnapshot }) {
  const sections: [string, unknown][] = [
    ['levels', snapshot.levels], ['output stops', snapshot.stops], ['senses', snapshot.senses],
    ['notes', snapshot.self.notes], ['health', snapshot.health], ['world', snapshot.world], ['jev', snapshot.jev],
  ];
  return <div>{sections.map(([title, value]) => (
    <div key={title} className="mb-2"><div className="font-sans font-medium text-[var(--fg)]">{title}</div><pre className="whitespace-pre-wrap text-[var(--muted)]">{JSON.stringify(value, null, 1)}</pre></div>
  ))}</div>;
}

/** Latency from a user action to the entity's first visible response, plus mind run durations. */
function LatencyView({ events }: { events: EntityEvent[] }) {
  const rows: { what: string; ms: number; via: string }[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.by !== 'user' || (e.type !== 'chat_message' && e.type !== 'key_down')) continue;
    const response = events.slice(i + 1).find((r) => isEntity(r.by) && (r.type === 'chat_message' || r.type === 'key_down'));
    if (!response || response.t - e.t > 60_000) continue;
    const next = events.slice(i + 1).find((r) => r.by === 'user' && (r.type === 'chat_message' || r.type === 'key_down'));
    if (next && next.seq < response.seq) continue;
    rows.push({ what: e.type === 'chat_message' ? `message “${String(e.data.text).slice(0, 30)}”` : `key ${String(e.data.key)}`, ms: response.t - e.t, via: `${response.by} ${response.type}` });
  }
  const runs = events.filter((e) => e.type === 'run_finished' && typeof e.data.ms === 'number');
  return (
    <div className="font-sans">
      <div className="mb-1 font-medium text-[var(--fg)]">User action → first entity response</div>
      {rows.slice(-20).reverse().map((row, i) => (
        <div key={i} className="flex gap-2"><span className="w-20 text-right font-mono">{row.ms < 10 ? row.ms.toFixed(2) : Math.round(row.ms)} ms</span><span>{row.what}</span><span className="text-[var(--muted)]">via {row.via}</span></div>
      ))}
      <div className="mb-1 mt-3 font-medium text-[var(--fg)]">Mind runs</div>
      {runs.slice(-15).reverse().map((e) => (
        <div key={e.seq} className="flex gap-2"><span className="w-20 text-right font-mono">{(Number(e.data.ms) / 1000).toFixed(1)} s</span><span>{e.by}</span><span className="text-[var(--muted)]">{e.data.aborted ? 'aborted' : ''}</span></div>
      ))}
    </div>
  );
}
