import * as React from 'react';
import type { EntityEvent, EntitySnapshot } from '@entity/core';
import { ChatInput } from '../chat/ChatInput';
import { ChatMessageFrame } from '../chat/ChatMessageFrame';
import { ChatMessageBody } from '../chat/ChatMessageBody';
import { ChatMessageCopyAction } from '../chat/ChatMessageCopyAction';
import { seconds } from './bench-format';
import type { WorkLink } from './EntityWorkCanvas';

/** Sends a message; resolves false when it was not delivered, so the composer keeps the text. */
export type SendText = (text: string) => Promise<boolean> | boolean | void;

export type ChatOption = { label: string; recommended?: boolean };

/** A question from the entity or a worker that is still waiting for the user. */
export type OpenQuestion = { seq: number; by: string; name: string; text: string; options?: ChatOption[]; worker: boolean; inThread: boolean };

const asksSomething = (e: EntityEvent) => e.data.question === true || Array.isArray(e.data.options) || /\?\s*$/.test(String(e.data.text ?? ''));

/**
 * Questions still waiting for the user, from the log, wherever they were asked (a worker's thread too). The entity's own
 * question is answered by any later message from the user; a worker's by a message to that worker (or a click). A
 * worker's question counts only when it asked with ask, or when it was the last thing it said: a mid-task aside is not
 * waiting for anyone.
 */
export function openQuestions(events: EntityEvent[], snapshot: EntitySnapshot): OpenQuestion[] {
  const open: OpenQuestion[] = [];
  const chats = events.filter(e => e.type === 'chat_message');
  for (const q of chats) {
    if (q.by === 'user' || !asksSomething(q)) continue;
    const worker = snapshot.limbs.find(l => l.id === q.by && l.role === 'task');
    if (worker) {
      if (worker.asking !== q.seq) {
        if (q.data.question === true) continue; // it asked, and is no longer waiting: answered
        if (chats.some(e => e.by === q.by && e.seq > q.seq)) continue; // it went on talking
      }
      if (events.some(e => e.type === 'steered' && e.data.id === q.by && e.seq > q.seq && (e.by === 'user' || e.data.answers === q.seq))) continue;
      if (worker.asking !== q.seq && events.some(e => e.type === 'steered' && e.data.id === q.by && e.seq > q.seq)) continue;
    } else if (chats.some(e => e.by === 'user' && e.seq > q.seq)) continue;
    open.push({
      seq: q.seq, by: q.by, name: worker?.name ?? (q.by === 'head' || q.by === 'voice' ? 'Entity' : q.by), text: String(q.data.text ?? ''),
      options: Array.isArray(q.data.options) ? q.data.options as ChatOption[] : undefined, worker: !!worker, inThread: q.data.thread === true,
    });
  }
  return open;
}

/**
 * Worker messages that arrive together (within a few seconds, nothing from the user between) are shown as one digest.
 * Questions and anything with options stay on their own, so they are never folded away.
 */
export const DIGEST_WINDOW_MS = 10_000;
export function digestGroups(messages: EntityEvent[], isWorker: (by: string) => boolean): EntityEvent[][] {
  const groups: EntityEvent[][] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    const joinable = isWorker(m.by) && !asksSomething(m);
    const prev = last?.[last.length - 1];
    if (joinable && prev && isWorker(prev.by) && !asksSomething(prev) && m.t - prev.t <= DIGEST_WINDOW_MS) last.push(m);
    else groups.push([m]);
  }
  return groups;
}

/** What the entity did with one user message, from the log: which workers it started, steered or queued. */
export function routingNotes(message: EntityEvent, events: EntityEvent[], nameOf: (id: string) => string): { text: string; worker?: string }[] {
  const next = events.find(e => e.type === 'chat_message' && e.by === 'user' && e.seq > message.seq && !e.data.reply_to);
  const within = (e: EntityEvent) => e.seq > message.seq && (!next || e.seq < next.seq);
  const notes: { text: string; worker?: string }[] = [];
  const batches = new Set<string>();
  for (const e of events) {
    if (e.type === 'group_started' && e.data.reply_to === message.seq) { batches.add(String(e.data.id)); notes.push({ text: `started batch "${e.data.title}" (${e.data.count})` }); }
    if (e.type === 'group_extended' && e.data.reply_to === message.seq) { batches.add(String(e.data.id)); notes.push({ text: `added ${e.data.count} to the batch` }); }
    if (e.type === 'limb_spawned' && e.data.reply_to === message.seq && !batches.has(String(e.data.group))) {
      const id = String(e.data.id);
      const text = e.data.fork_of ? `forked ${nameOf(String(e.data.fork_of))} as ${nameOf(id)}`
        : e.data.after ? `queued ${nameOf(id)} after ${nameOf(String(e.data.after))}` : `started ${nameOf(id)}`;
      notes.push({ text, worker: id });
    }
    if (e.type === 'steered' && e.by !== 'user' && within(e)) {
      const id = String(e.data.id);
      notes.push({ text: e.data.when === 'after' ? `queued for ${nameOf(id)}` : `sent to ${nameOf(id)}`, worker: id });
    }
  }
  return notes;
}

/**
 * A question's answer, if it has one: for a worker's question the click that answered it (or just that the worker
 * stopped waiting), for the entity's own question the user's message in reply to it.
 */
export function questionAnswer(question: EntityEvent, events: EntityEvent[], snapshot: EntitySnapshot): { text?: string } | null {
  const worker = snapshot.limbs.find(l => l.id === question.by && l.role === 'task');
  if (worker) {
    const click = events.find(e => e.type === 'steered' && e.data.id === worker.id && e.data.answers === question.seq);
    if (click) return { text: String(click.data.text) };
    return worker.asking === question.seq ? null : question.data.question ? {} : null;
  }
  const reply = events.find(e => e.type === 'chat_message' && e.by === 'user' && e.data.reply_to === question.seq);
  return reply ? { text: String(reply.data.text) } : null;
}

/** Answers to click: soft rows, the recommended one tagged, the chosen one filled and checked, the rest faded once answered. */
function Options({ options, answer, disabled, onChoose }: { options: ChatOption[]; answer: { text?: string } | null; disabled?: boolean; onChoose?(label: string): void }) {
  const locked = disabled || !!answer || !onChoose;
  return (
    <div role="radiogroup" aria-label="Answers" className="mt-2.5 grid gap-1">
      {options.map(o => {
        const chosen = answer?.text === o.label;
        return (
          <button key={o.label} type="button" role="radio" aria-checked={chosen} disabled={locked}
            onClick={e => { e.stopPropagation(); onChoose?.(o.label); }}
            className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
              chosen ? 'bg-[var(--surface-strong)] text-[var(--fg)]'
                : answer ? 'text-[var(--muted)] opacity-60'
                : 'bg-[var(--surface-softest)] text-[var(--fg)] hover:bg-[var(--hover)] disabled:cursor-default disabled:hover:bg-[var(--surface-softest)]'}`}>
            <span aria-hidden="true" className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] ${chosen ? 'bg-[var(--fg)] text-[var(--panel)]' : 'ring-1 ring-inset ring-[var(--muted-dim)]'}`}>{chosen ? '✓' : ''}</span>
            <span className="min-w-0 flex-1">{o.label}</span>
            {o.recommended ? <span className="flex-shrink-0 text-[11px] text-[var(--muted)]">Recommended</span> : null}
          </button>
        );
      })}
      {answer && answer.text !== undefined && !options.some(o => o.label === answer.text) ? (
        <div className="px-1 text-[12px] text-[var(--muted)]">You answered: {answer.text}</div>
      ) : null}
    </div>
  );
}

/**
 * A message in the agent chat's design: the user's on the right, everyone else's on the left with markdown. `label`
 * names who said it when that isn't the entity itself, and `meta` carries replies, reviews and the like.
 */
export function EntityMessage({ mine, at, label, meta, text, struck, linked, title, onClick, seq, options, answer, answerDisabled, onChoose, files, onOpenFile, notes, onOpenWorker }: {
  mine: boolean; at?: number; label?: string | null; meta?: React.ReactNode; text: string; struck?: boolean; linked?: boolean;
  title?: string; onClick?(): void; seq?: number;
  /** Files the message links, in the entity's home folder. */
  files?: string[]; onOpenFile?(path: string): void;
  /** Under a user message: what the entity did with it. */
  notes?: { text: string; worker?: string }[]; onOpenWorker?(id: string): void;
  /** Clickable answers to this message's question. */
  options?: ChatOption[]; answer?: { text?: string } | null; answerDisabled?: boolean; onChoose?(label: string): void;
}) {
  const header = label || meta ? (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11px] text-[var(--muted)]">
      {label ? <span className="font-medium text-[var(--fg-secondary,var(--fg))]">{label}</span> : null}
      {meta}
    </span>
  ) : undefined;
  return (
    <div data-seq={seq} data-linked={linked || undefined} title={title}
      className={`-mx-2 rounded-[var(--radius-xlarge,12px)] px-2 transition-colors ${linked ? 'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]' : ''} ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}>
      <ChatMessageFrame role={mine ? 'user' : 'assistant'} at={at ? new Date(at).toISOString() : undefined} showRoleLabel={false}
        headerEnd={header} hoverActions={<ChatMessageCopyAction text={text} position="inline" />}>
        <div className={struck ? 'text-[var(--muted)] line-through' : undefined}>
          <ChatMessageBody role={mine ? 'user' : 'assistant'} text={text} />
        </div>
        {options?.length ? <Options options={options} answer={answer ?? null} disabled={answerDisabled} onChoose={onChoose} /> : null}
        {files?.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {files.map(f => (
              <button key={f} type="button" title={`Open ${f}`} onClick={e => { e.stopPropagation(); onOpenFile?.(f); }}
                className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-[var(--surface-softest)] px-2 py-1 text-[12px] hover:bg-[var(--hover)]">
                <span aria-hidden="true" className="text-[var(--muted)]">▤</span>
                <span className="truncate">{f.split('/').pop()}</span>
              </button>
            ))}
          </div>
        ) : null}
      </ChatMessageFrame>
      {notes?.length ? (
        <div className="-mt-2 mb-1 flex flex-wrap justify-end gap-x-2 text-[11px] text-[var(--muted)]">
          {notes.map((n, i) => n.worker && onOpenWorker
            ? <button key={i} type="button" className="hover:text-[var(--fg)] hover:underline" onClick={e => { e.stopPropagation(); onOpenWorker(n.worker!); }}>→ {n.text}</button>
            : <span key={i}>→ {n.text}</span>)}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The chat composer the agent chat uses: the full editor (Ctrl+E), recording with pause (q, w, e), and `s` to send
 * from anywhere in the window. No attachments or continuous voice steering: the entity takes text.
 */
export function EntityComposer({ id, label, placeholder, disabled, onSend, onDraft }: {
  id: string; label: string; placeholder: string; disabled?: boolean; onSend: SendText;
  /** Called as the draft changes, for the entity to see what is being typed. */
  onDraft?(text: string): void;
}) {
  const [draft, setDraft] = React.useState('');
  // The composer clears itself after a send; that empty draft is not news to the entity.
  const sent = React.useRef(false);
  return (
    <div className="dh-entity-composer">
    <ChatInput resetKey={id} droneName={label} placeholder={placeholder} focusTargetId={`entity:${id}`}
      draftValue={draft}
      onDraftValueChange={(next) => {
        setDraft(next);
        if (sent.current && !next) { sent.current = false; return; }
        onDraft?.(next);
      }}
      promptError={null} waiting={false} disabled={disabled} attachmentsEnabled={false} continuousVoiceEnabled={false}
      onSend={async ({ prompt }) => {
        const text = prompt.trim();
        if (!text) return false;
        const ok = (await onSend(text)) !== false;
        if (ok) sent.current = true;
        return ok;
      }} />
    </div>
  );
}

/** Questions dismissed from the tray, remembered per recording on this device. */
function useDismissed(sessionId: string | null): [ReadonlySet<number>, (seq: number) => void] {
  const key = `entity-dismissed:${sessionId ?? 'live'}`;
  const read = () => { try { return new Set<number>(JSON.parse(localStorage.getItem(key) ?? '[]')); } catch { return new Set<number>(); } };
  const [dismissed, setDismissed] = React.useState<ReadonlySet<number>>(read);
  React.useEffect(() => { setDismissed(read()); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [dismissed, seq => setDismissed(prev => {
    const next = new Set(prev).add(seq);
    try { localStorage.setItem(key, JSON.stringify([...next])); } catch { /* a per-device convenience only */ }
    return next;
  })];
}

/** Questions waiting for the user, above the composer: answer with an option or a short reply, jump to one, or dismiss it. */
function NeedsYou({ questions, disabled, onAnswer, onShow, onDismiss }: {
  questions: OpenQuestion[]; disabled: boolean;
  onAnswer(q: OpenQuestion, text: string): void; onShow(q: OpenQuestion): void; onDismiss(q: OpenQuestion): void;
}) {
  const [all, setAll] = React.useState(false);
  const [replying, setReplying] = React.useState<{ seq: number; text: string } | null>(null);
  if (!questions.length) return null;
  const shown = all ? questions : questions.slice(-2);
  return (
    <div aria-label="Questions waiting for you" className="mx-2 mb-1.5 rounded-[var(--radius-large,10px)] bg-[var(--surface-softest)] px-3 py-2">
      <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        Needs you · {questions.length}
        {questions.length > shown.length ? <button type="button" className="ml-auto normal-case tracking-normal hover:text-[var(--fg)]" onClick={() => setAll(true)}>Show all</button> : null}
        {all && questions.length > 2 ? <button type="button" className="ml-auto normal-case tracking-normal hover:text-[var(--fg)]" onClick={() => setAll(false)}>Show fewer</button> : null}
      </div>
      <div className="grid max-h-[40vh] gap-2 overflow-y-auto">
        {shown.map(q => (
          <div key={q.seq} className="grid gap-1">
            <div className="flex items-start gap-2 text-[13px]">
              <button type="button" onClick={() => onShow(q)} title={q.inThread ? 'Open its thread' : 'Show it in the chat'} className="min-w-0 flex-1 text-left">
                <span className="block text-[11px] text-[var(--muted)]">{q.name}</span>
                <span className="line-clamp-2">{q.text}</span>
              </button>
              <button type="button" aria-label="Dismiss" title="Dismiss" onClick={() => onDismiss(q)} className="flex-shrink-0 rounded px-1 text-[var(--muted)] hover:bg-[var(--hover)]">✕</button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {q.options?.map(o => (
                <button key={o.label} type="button" disabled={disabled} onClick={() => onAnswer(q, o.label)}
                  className="rounded-md bg-[var(--surface-strong)] px-2 py-0.5 text-[12px] hover:bg-[var(--hover)] disabled:opacity-50">
                  {o.label}{o.recommended ? <span className="ml-1 text-[var(--muted)]">· recommended</span> : null}
                </button>
              ))}
              {replying?.seq === q.seq ? (
                <form className="flex min-w-[12rem] flex-1 gap-1.5" onSubmit={e => { e.preventDefault(); if (replying.text.trim()) { onAnswer(q, replying.text.trim()); setReplying(null); } }}>
                  <input autoFocus aria-label={`Reply to ${q.name}`} value={replying.text} onChange={e => setReplying({ seq: q.seq, text: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setReplying(null); } }}
                    className="min-w-0 flex-1 rounded-md bg-[var(--panel)] px-2 py-0.5 text-[12px] outline-none" placeholder="Your answer" />
                </form>
              ) : (
                <button type="button" disabled={disabled} onClick={() => setReplying({ seq: q.seq, text: '' })}
                  className="rounded-md px-2 py-0.5 text-[12px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)] disabled:opacity-50">Reply…</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Several worker messages that arrived together: one line each (name, first line, files), expanding in place. */
function Digest({ items, nameOf, linked, onOpenFile, onOpenWorker }: {
  items: EntityEvent[]; nameOf(id: string): string; linked(m: EntityEvent): boolean;
  onOpenFile?(path: string): void; onOpenWorker?(id: string): void;
}) {
  const [open, setOpen] = React.useState<ReadonlySet<number>>(() => new Set());
  const at = new Date(items[items.length - 1].at);
  return (
    <div aria-label={`${items.length} updates`} className="rounded-[var(--radius-xlarge,12px)] bg-[var(--surface-softest)] px-3 py-2">
      <div className="mb-1 text-[11px] text-[var(--muted)]">{items.length} updates · {at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      <div className="grid gap-0.5">
        {items.map(m => {
          const text = String(m.data.text ?? '');
          const files = Array.isArray(m.data.files) ? m.data.files as string[] : [];
          const expanded = open.has(m.seq);
          return (
            <div key={m.seq} data-seq={m.seq} data-linked={linked(m) || undefined}
              className={`rounded-md px-1.5 py-1 ${linked(m) ? 'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]' : ''}`}>
              <div className="flex min-w-0 items-baseline gap-2 text-[13px]">
                <button type="button" className="flex-shrink-0 font-medium hover:underline" title="Open it on the Work canvas" onClick={() => onOpenWorker?.(m.by)}>{nameOf(m.by)}</button>
                <button type="button" aria-expanded={expanded} className={`min-w-0 flex-1 text-left text-[var(--fg-secondary,var(--fg))] ${expanded ? '' : 'truncate'}`}
                  onClick={() => setOpen(prev => { const next = new Set(prev); if (next.has(m.seq)) next.delete(m.seq); else next.add(m.seq); return next; })}>
                  {expanded ? null : text.split('\n')[0]}
                </button>
                {files.map(f => (
                  <button key={f} type="button" title={`Open ${f}`} onClick={() => onOpenFile?.(f)}
                    className="flex-shrink-0 rounded bg-[var(--surface-strong)] px-1.5 text-[11px] hover:bg-[var(--hover)]">{f.split('/').pop()}</button>
                ))}
              </div>
              {expanded ? <div className="mt-1"><ChatMessageBody role="assistant" text={text} /></div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The conversation with the entity: its messages, workers' replies, second looks at fast answers, and the composer. */
export function ChatPane({ events, snapshot, disabled, replaying, onInput, onWorker, link, onOpenWorker, onOpenFile, sessionId }: {
  events: EntityEvent[]; snapshot: EntitySnapshot; disabled: boolean; replaying?: boolean;
  onInput(type: string, data: Record<string, unknown>): Promise<boolean> | void;
  /** Answers a worker's question directly (a clicked option). */
  onWorker?(id: string, action: 'message', text: string, answers: number): Promise<boolean> | void;
  /** Opens a linked file of the entity's home folder. */
  onOpenFile?(path: string): void;
  /** A worker chosen on the Work canvas: its messages are marked here. */
  link?: WorkLink;
  onOpenWorker?(id: string): void;
  /** The recording, so dismissed questions are remembered for it on this device. */
  sessionId?: string | null;
}) {
  const [dismissed, setDismissed] = useDismissed(sessionId ?? null);
  const draftTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottom = React.useRef<HTMLDivElement | null>(null);
  const list = React.useRef<HTMLDivElement | null>(null);
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
  React.useEffect(() => {
    // Only a highlight that came from the canvas scrolls the chat; hovering here must not move what you point at.
    if (!link || link.from === 'chat') return;
    list.current?.querySelector('[data-linked="true"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [link]);
  // The tray holds questions you might miss: not the one the chat already ends with.
  const lastInChat = messages[messages.length - 1];
  const waiting = openQuestions(events, snapshot).filter(q => !dismissed.has(q.seq) && !(q.seq === lastInChat?.seq && !q.inThread));
  const quote = (text: unknown, max: number) => { const s = String(text ?? ''); return `“${s.slice(0, max)}${s.length > max ? '…' : ''}”`; };
  const renderMessage = (m: EntityEvent) => {
    const mine = m.by === 'user';
    const replyTo = typeof m.data.reply_to === 'number' ? messages.find((x) => x.seq === m.data.reply_to) : undefined;
    const worker = workerOf(m.by);
    const label = !mine && m.by !== 'head' ? (worker ? worker.name : m.by) : null;
    const reviewed = review.get(m.seq);
    const amends = typeof m.data.corrects === 'number' ? { seq: m.data.corrects, kind: 'Correction to' } : typeof m.data.expands === 'number' ? { seq: m.data.expands, kind: 'Adds to' } : undefined;
    const amended = amends ? messages.find(x => x.seq === amends.seq) : undefined;
    const meta = replyTo || reviewed || amends ? (
      <>
        {amends ? (
          <button type="button" className="font-medium text-[var(--accent)] hover:underline" onClick={e => { e.stopPropagation(); jump(amends.seq); }}>
            {amends.kind} {quote(amended?.data.text, 40)}
          </button>
        ) : replyTo ? <span>↳ {quote(replyTo.data.text, 48)}</span> : null}
        {reviewed?.state === 'checking' ? <span className="italic opacity-80" title="A stronger model is taking a second look">checking…</span> : null}
        {reviewed?.state === 'withdrawn' ? <span className="italic opacity-80" title="The reviewer found this correction was itself wrong; the message it corrected stands">withdrawn</span> : null}
        {reviewed?.state === 'unchecked' ? <span className="italic opacity-80" title="The review did not complete, so this answer was not checked">not checked</span> : null}
        {reviewed?.state === 'confirmed' ? <span title="Checked by the reviewer" style={{ color: 'var(--green, #3fb950)' }}>✓</span> : null}
        {reviewed?.state === 'corrected' && reviewed.by !== undefined ? (
          <button type="button" className="font-medium hover:underline" style={{ color: 'var(--orange, #e8773a)' }} onClick={e => { e.stopPropagation(); jump(reviewed.by!); }}>corrected below ↓</button>
        ) : null}
        {reviewed?.state === 'expanded' && reviewed.by !== undefined ? (
          <button type="button" className="hover:underline" onClick={e => { e.stopPropagation(); jump(reviewed.by!); }}>more below ↓</button>
        ) : null}
      </>
    ) : null;
    return (
      <EntityMessage key={m.seq} seq={m.seq} mine={mine} at={m.at} label={label} meta={meta}
        files={Array.isArray(m.data.files) ? m.data.files as string[] : undefined} onOpenFile={onOpenFile}
        notes={mine ? routingNotes(m, events, id => snapshot.limbs.find(l => l.id === id)?.name ?? id) : undefined} onOpenWorker={onOpenWorker}
        options={Array.isArray(m.data.options) ? m.data.options as ChatOption[] : undefined}
        answer={Array.isArray(m.data.options) ? questionAnswer(m, events, snapshot) : null} answerDisabled={disabled}
        onChoose={choice => { void (worker ? onWorker?.(m.by, 'message', choice, m.seq) : onInput('chat_message', { text: choice, reply_to: m.seq })); }}
        text={updated.get(m.seq) ?? String(m.data.text)} linked={linkedTo(m)}
        struck={reviewed?.state === 'corrected' || reviewed?.state === 'withdrawn'}
        title={`#${m.seq} ${m.by} at ${seconds(m.t)}${worker ? ' · click to open it on the Work canvas' : ''}`}
        onClick={worker ? () => onOpenWorker?.(m.by) : undefined} />
    );
  };
  return (
    <section className="flex min-h-0 flex-col bg-[var(--panel)]" aria-label="Chat">
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto">
        <div className="dh-chat-transcript flex flex-col gap-4 px-4 py-4">
          {messages.length === 0 ? <div className="text-[var(--muted)]">{disabled ? 'Press Start to wake the entity.' : 'Say something, or press keys.'}</div> : null}
          {digestGroups(messages, by => !!workerOf(by)).map(group => group.length > 1 ? (
            <Digest key={group[0].seq} items={group} nameOf={id => workerOf(id)?.name ?? id} linked={linkedTo} onOpenFile={onOpenFile} onOpenWorker={onOpenWorker} />
          ) : renderMessage(group[0]))}
          {chat?.entityDraft?.text ? (
            <ChatMessageFrame role="assistant" showRoleLabel={false} className="border-dashed italic text-[var(--muted)]">
              {chat.entityDraft.text}
            </ChatMessageFrame>
          ) : null}
          <div ref={bottom} />
        </div>
      </div>
      <div>
        <NeedsYou questions={waiting} disabled={disabled}
          onAnswer={(q, text) => { void (q.worker ? onWorker?.(q.by, 'message', text, q.seq) : onInput('chat_message', { text, reply_to: q.seq })); }}
          onShow={q => { if (q.inThread) onOpenWorker?.(q.by); else jump(q.seq); }}
          onDismiss={q => setDismissed(q.seq)} />
        <EntityComposer id="entity-chat" label="the entity" disabled={disabled}
          placeholder={replaying ? 'Replaying: go Live to talk to the entity' : disabled ? 'Start the session first' : 'Message the entity'}
          onDraft={(text) => {
            if (draftTimer.current) clearTimeout(draftTimer.current);
            draftTimer.current = setTimeout(() => void onInput('draft_changed', { text }), 120);
          }}
          onSend={(text) => {
            if (draftTimer.current) clearTimeout(draftTimer.current);
            return onInput('chat_message', { text });
          }} />
      </div>
    </section>
  );
}
