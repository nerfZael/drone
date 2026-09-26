import * as React from 'react';
import type { EntityEvent, EntitySnapshot } from '@entity/core';
import { EntityMessage, questionAnswer, type ChatOption, type ChatQuestion } from './EntityChat';

type Limb = EntitySnapshot['limbs'][number];

const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
const CHANNEL_OF: Record<string, string> = {
  chat_message: 'chat', draft_changed: 'chat', entity_draft: 'chat', key_down: 'keypad', key_up: 'keypad', file_written: 'workspace', command_ran: 'workspace',
};

/**
 * The side panel for one part of the entity, on the Work canvas and in the Brain: its name and state, a Thread tab
 * (what was said to and by it) and a Log tab (its setup, runs and recent events).
 */
export function LimbPanel({ title, titleHint, status, actions, thread, log, footer, onClose }: {
  title: string; titleHint?: string; status?: React.ReactNode; actions?: React.ReactNode;
  /** Omitted for parts that have no conversation (channels, senses): the panel shows only the log. */
  thread?: React.ReactNode; log: React.ReactNode; footer?: React.ReactNode; onClose(): void;
}) {
  const [tab, setTab] = React.useState<'thread' | 'log'>(thread ? 'thread' : 'log');
  const shown = thread ? tab : 'log';
  const tabClass = (on: boolean) => `rounded px-2 py-0.5 text-[12px] ${on ? 'bg-[var(--hover)] text-[var(--fg)]' : 'text-[var(--muted)] hover:text-[var(--fg)]'}`;
  return (
    <aside onClick={e => e.stopPropagation()} aria-label={`${title} details`}
      className="absolute inset-y-0 right-0 z-30 grid w-[420px] max-w-full grid-rows-[auto_minmax(0,1fr)_auto] border-l border-[var(--border)] bg-[var(--panel)] shadow-lg">
      <div className="grid gap-1.5 border-b border-[var(--border)] px-3 pb-1.5 pt-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-semibold" title={titleHint}>{title}</span>
          {status}
          <span className="ml-auto flex items-center gap-1.5">
            {actions}
            <button type="button" aria-label="Close" onClick={onClose} className="rounded px-1.5 text-[var(--muted)] hover:bg-[var(--hover)]">✕</button>
          </span>
        </div>
        {thread ? (
          <div role="tablist" aria-label={`${title} views`} className="flex gap-1">
            <button type="button" role="tab" aria-selected={shown === 'thread'} className={tabClass(shown === 'thread')} onClick={() => setTab('thread')}>Thread</button>
            <button type="button" role="tab" aria-selected={shown === 'log'} className={tabClass(shown === 'log')} onClick={() => setTab('log')}>Log</button>
          </div>
        ) : null}
      </div>
      <div className="min-h-0 overflow-y-auto">{shown === 'thread' ? thread : log}</div>
      {shown === 'thread' && footer ? footer : <span />}
    </aside>
  );
}

/** What a part of the entity said in the chat, in order: the Thread of the head, the voice or the reviewer. */
export function SaidThread({ id, events, snapshot, onOpenFile }: { id: string; events: EntityEvent[]; snapshot: EntitySnapshot; onOpenFile?(path: string): void }) {
  const said = events.filter(e => e.type === 'chat_message' && e.by === id);
  // A batch's progress line is updated in place, as in the chat.
  const updated = new Map<number, string>();
  for (const e of events) if (e.type === 'chat_message_updated') updated.set(Number(e.data.seq), String(e.data.text));
  return (
    <div className="dh-chat-transcript flex flex-col gap-4 px-4 py-3">
      {said.length ? said.map(e => (
        <EntityMessage key={e.seq} mine={id === 'user'} at={e.at} text={updated.get(e.seq) ?? String(e.data.text ?? '')}
          files={Array.isArray(e.data.files) ? e.data.files as string[] : undefined} onOpenFile={onOpenFile}
          // Questions show as asked and as answered; they are answered in the chat.
          options={Array.isArray(e.data.options) ? e.data.options as ChatOption[] : undefined}
          questions={Array.isArray(e.data.questions) ? e.data.questions as ChatQuestion[] : undefined}
          answer={Array.isArray(e.data.options) || Array.isArray(e.data.questions) ? questionAnswer(e, events, snapshot) : null} answerDisabled />
      )) : <div className="text-[12px] text-[var(--muted)]">Nothing said yet.</div>}
    </div>
  );
}

/** The log of one part of the entity: its setup and runs, then its most recent events. */
export function LimbLog({ id, snapshot, limb, events, now }: { id: string; snapshot: EntitySnapshot; limb?: Limb; events: EntityEvent[]; now: number }) {
  const channel = id.startsWith('ch:') ? id.slice(3) : null;
  const related = events.filter((e) =>
    id === 'you' ? e.by === 'user'
      : channel ? CHANNEL_OF[e.type] === channel && e.type !== 'draft_changed'
      : id === 'jev' ? e.type === 'judged' || e.type === 'jev_unavailable'
      : e.by === id || e.data.id === id || e.data.limb === id,
  ).slice(-40).reverse();
  const rows: [string, React.ReactNode][] = limb ? [
    ['kind', `${limb.kind} · ${limb.role}${limb.model ? ` · ${limb.model}` : ''}`],
    ['status', limb.status],
    ...(limb.parent ? [['parent', limb.parent] as [string, React.ReactNode]] : []),
    ...limb.runs.map((r): [string, React.ReactNode] => [`run ${r.id}`, `${seconds(now - r.startedAt)} · ${r.reason}`]),
    ...(limb.task ? [['task', limb.task] as [string, React.ReactNode]] : []),
    ...(limb.result ? [['result', limb.result] as [string, React.ReactNode]] : []),
    ...(limb.watch ? [['watch', <pre key="w" className="whitespace-pre-wrap">{JSON.stringify(limb.watch, null, 1)}</pre>] as [string, React.ReactNode]] : []),
    ...(limb.code ? [['code', <pre key="c" className="whitespace-pre-wrap">{limb.code}</pre>] as [string, React.ReactNode]] : []),
    ...(limb.fires ? [['fired', `${limb.fires}×`] as [string, React.ReactNode]] : []),
  ] : id === 'jev' ? snapshot.senses.map((s): [string, React.ReactNode] => [s.level.replace(/^sense\./, ''), `${s.value === undefined ? '–' : s.value.toFixed(2)} · ${s.question}`]) : [];
  return (
    <div className="px-3 py-2 font-mono text-[11px] leading-[1.45]">
      {rows.map(([key, value], i) => (
        <div key={`${key}-${i}`} className="flex gap-2"><span className="w-16 shrink-0 truncate text-[var(--muted)]">{key}</span><span className="min-w-0 flex-1 break-words text-[var(--fg-secondary,var(--fg))]">{value}</span></div>
      ))}
      <div className={`${rows.length ? 'mt-2' : ''} mb-0.5 font-sans text-[var(--muted)]`}>{related.length ? 'Recent events' : 'No events yet'}</div>
      {related.map((e) => (
        <div key={e.seq} className="truncate text-[var(--muted)]" title={JSON.stringify(e.data)}>
          <span className="opacity-70">{seconds(e.t)}</span> {e.by} <span className="text-[var(--accent)]">{e.type}</span> {JSON.stringify(e.data).slice(0, 200)}
        </div>
      ))}
    </div>
  );
}
