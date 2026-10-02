import * as React from 'react';
import type { EntityEvent, EntitySnapshot } from '@entity/core';
import { spend } from './EntityWork';

type Limb = EntitySnapshot['limbs'][number];
type Ask = EntitySnapshot['asks'][number];

/** What started a piece of work, in words: the user's messages, or what set the entity off. */
const CAUSE_TEXT: Record<string, string> = {
  session: 'when the session started', resume: 'after a resume', heartbeat: 'on its heartbeat', watch: 'when a watch fired',
  program: 'when a program woke it', timer: 'when a timer fired', stop: 'after an output stop', conflict: 'to settle a file conflict',
  handoff: 'on a handoff', batch: 'when a batch ended', review: 'during a review', task: 'from other work', steer: 'from a steer',
  continue: 'continuing other work', retry: 'on a retry', other: 'by itself',
};

/**
 * The plain record of a session: what the user asked and what became of it, and every piece of work with why it
 * exists and what it reported. A check on the data the runtime records, before any design is built on it.
 */
export function EntityRecord({ events, snapshot, onOpenWorker }: { events: EntityEvent[]; snapshot: EntitySnapshot; onOpenWorker(id: string): void }) {
  const messages = React.useMemo(() => new Map(events.filter((e) => e.by === 'user' && (e.type === 'chat_message' || e.type === 'steered')).map((e) => [e.seq, String(e.data.text ?? '')])), [events]);
  const workers = snapshot.limbs.filter((l) => l.role === 'task');
  const names = new Map(snapshot.limbs.map((l) => [l.id, l.name]));
  const asks = snapshot.asks ?? [];
  return (
    <section className="min-h-0 overflow-y-auto bg-[var(--panel)] p-4" aria-label="Record">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Asked</h3>
      {asks.length ? (
        <ul className="mb-6 flex flex-col gap-2">{asks.map((ask) => <AskRow key={ask.id} ask={ask} names={names} messages={messages} onOpenWorker={onOpenWorker} />)}</ul>
      ) : <p className="mb-6 text-[var(--muted)]">Nothing yet. With asks on, each message is split into what it asks for.</p>}
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Work</h3>
      {workers.length ? (
        <ul className="flex flex-col gap-3">{workers.map((w) => <WorkRow key={w.id} w={w} messages={messages} onOpen={() => onOpenWorker(w.id)} />)}</ul>
      ) : <p className="text-[var(--muted)]">No agents yet.</p>}
    </section>
  );
}

function AskRow({ ask, names, messages, onOpenWorker }: { ask: Ask; names: Map<string, string>; messages: Map<number, string>; onOpenWorker(id: string): void }) {
  const again = ask.status === 'open' && !!ask.resolved;
  const state = ask.kind === 'rule' && ask.status === 'open' ? 'rule' : again ? 'asked again' : ask.status === 'resolved' ? (ask.kind === 'question' ? 'answered' : 'done') : ask.status === 'replaced' ? 'replaced' : ask.workers.length ? 'taken' : 'open';
  const tone = state === 'done' || state === 'answered' ? 'var(--green, #3fb950)' : state === 'asked again' ? 'var(--yellow, #d29922)' : 'var(--muted)';
  return (
    <li className="rounded border border-[var(--border)] px-3 py-2" title={ask.seqs.map((s) => messages.get(s)).filter(Boolean).join('\n\n')}>
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] text-[var(--muted)]">{ask.kind}</span>
        <span className={`min-w-0 flex-1 ${ask.status === 'replaced' ? 'text-[var(--muted)] line-through' : ''}`}>{ask.text}</span>
        <span className="shrink-0 text-[12px]" style={{ color: tone }}>{state}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-[var(--muted)]">
        {ask.seqs.length > 1 ? <span style={{ color: again ? 'var(--yellow, #d29922)' : undefined }}>asked {ask.seqs.length}×</span> : null}
        {ask.workers.map((id) => <button key={id} type="button" className="text-[var(--fg-secondary)] hover:underline" onClick={() => onOpenWorker(id)}>→ {names.get(id) ?? id}</button>)}
        {ask.resolved ? <span>{again ? 'was ' : ''}resolved by {names.get(ask.resolved.by) ?? ask.resolved.by}{ask.resolved.note ? `: ${ask.resolved.note}` : ''}</span> : null}
      </div>
    </li>
  );
}

function WorkRow({ w, messages, onOpen }: { w: Limb; messages: Map<number, string>; onOpen(): void }) {
  const seqs = w.cause?.seqs ?? [];
  const cause = seqs.length
    ? `for your message${seqs.length > 1 ? 's' : ''}: ${seqs.map((s) => `“${(messages.get(s) ?? `#${s}`).slice(0, 90)}”`).join(', ')}`
    : w.cause ? `started by the entity ${CAUSE_TEXT[w.cause.kind] ?? CAUSE_TEXT.other}` : 'cause not recorded';
  const cost = w.usage ? spend(w.usage.cost, w.usage.input + w.usage.output + w.usage.cacheRead) : '';
  return (
    <li className="rounded border border-[var(--border)] px-3 py-2">
      <div className="flex items-baseline gap-2">
        <button type="button" className="font-medium hover:underline" onClick={onOpen}>{w.name}</button>
        <span className="text-[12px] text-[var(--muted)]">{w.status}{w.rounds ? ` · round ${w.rounds}` : ''}</span>
        <span className="ml-auto font-mono text-[11px] text-[var(--muted)]">{cost}</span>
      </div>
      <div className={`text-[12px] ${seqs.length ? 'text-[var(--muted)]' : 'text-[var(--yellow,#d29922)]'}`}>{cause}</div>
      {w.why ? <div className="text-[12px] text-[var(--muted)]">why: {w.why}</div> : null}
      {w.lastRound && w.status === 'running' ? <div className="mt-1">Round {w.rounds}: {w.lastRound}</div> : null}
      {w.result ? <div className="mt-1">{w.result}</div> : null}
      {w.points?.length ? (
        <ul className="mt-1 flex flex-col gap-0.5 pl-3 text-[12px]">
          {w.points.map((p, i) => <li key={i}><b>{p.label}</b> <span className="text-[var(--muted)]">{p.text}</span>{p.section ? <span className="text-[var(--muted)]"> · § {p.section}</span> : null}</li>)}
        </ul>
      ) : null}
    </li>
  );
}
