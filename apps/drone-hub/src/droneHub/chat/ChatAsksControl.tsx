import React from 'react';

import { IconSpinner } from './icons';
import {
  askStatusLabel,
  describeAskCost,
  formatAskCost,
  groupAsksByRun,
  isAskOutstanding,
  type AskKind,
  type ChatAsk,
  type ChatAsksState,
} from './chat-asks';

type Filter = 'all' | AskKind;
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'request', label: 'Requests' },
  { id: 'question', label: 'Questions' },
  { id: 'rule', label: 'Rules' },
];
const KIND_LABELS: Record<AskKind, string> = { request: 'Request', question: 'Question', rule: 'Rule' };

function statusTone(ask: ChatAsk): string {
  if (ask.kind === 'rule') return ask.status === 'open' ? 'text-[var(--info)]' : 'text-[var(--muted-dim)]';
  if (ask.inProgress) return 'text-[var(--accent)]';
  switch (ask.status) {
    case 'done': return 'text-[var(--green)]';
    case 'partial': return 'text-[var(--yellow)]';
    case 'not_done': return 'text-[var(--red)]';
    case 'open': return 'text-[var(--fg-secondary)]';
    default: return 'text-[var(--muted-dim)]';
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return date.toDateString() === new Date().toDateString()
    ? time
    : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

/** The nearest rendered copy of a chat message: the chat window holding this panel comes first. */
function findMessageElement(from: HTMLElement | null, messageId: string): HTMLElement | null {
  const selector = `[data-chat-message-id="${CSS.escape(messageId)}"]`;
  for (let node = from?.parentElement ?? null; node; node = node.parentElement) {
    const match = node.querySelector<HTMLElement>(selector);
    if (match) return match;
  }
  return null;
}

/** "Asks · 2 open" above the composer, opening the chat's list. Renders nothing until the chat has asks or tracks them. */
export function ChatAsksBadge({ state }: { state: ChatAsksState }) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const data = state.data;

  React.useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', dismissOnEscape);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', dismissOnEscape);
    };
  }, [open]);

  if (!state.featureOn || !data || (!data.tracking && data.asks.length === 0)) return null;
  const outstanding = data.asks.filter(isAskOutstanding).length;
  const busy = data.tracking && data.processing;
  const title = !data.tracking
    ? 'Asks are not tracked in this chat anymore. Open the list.'
    : `${outstanding} open ${outstanding === 1 ? 'ask' : 'asks'}${busy ? '; updating' : ''}. Open the list of what you asked in this chat.`;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        className={`inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-11 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${
          open
            ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)]'
            : 'border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[var(--fg-secondary)] hover:border-[var(--accent-muted)] hover:text-[var(--accent)]'
        }`}
      >
        {busy ? <IconSpinner className="h-3 w-3" /> : null}
        <span>Asks</span>
        {data.tracking ? (
          outstanding > 0 ? <span className="text-[var(--accent)]">{outstanding} open</span> : null
        ) : (
          <span className="text-[var(--muted-dim)]">off</span>
        )}
      </button>
      {open ? <ChatAsksPanel state={state} onClose={() => setOpen(false)} anchorRef={rootRef} /> : null}
    </div>
  );
}

function ChatAsksPanel({ state, onClose, anchorRef }: {
  state: ChatAsksState;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
}) {
  const data = state.data!;
  const [filter, setFilter] = React.useState<Filter>('all');
  const [targets, setTargets] = React.useState<Set<string>>(new Set());
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const counts = {
    all: data.asks.length,
    request: data.asks.filter((ask) => ask.kind === 'request').length,
    question: data.asks.filter((ask) => ask.kind === 'question').length,
    rule: data.asks.filter((ask) => ask.kind === 'rule').length,
  };
  const shown = filter === 'all' ? data.asks : data.asks.filter((ask) => ask.kind === filter);
  const groups = groupAsksByRun(shown);
  const outstanding = data.asks.filter(isAskOutstanding).length;
  const settled = data.asks.filter((ask) => ask.kind !== 'rule' && (ask.status === 'done' || ask.status === 'dismissed')).length;
  const statusError = state.status.error?.message ?? state.tracking.error?.message ?? null;

  // Only messages still rendered in this chat window can be jumped to.
  React.useEffect(() => {
    const ids = new Set<string>();
    for (const ask of data.asks) {
      const id = ask.messageIds[0];
      if (id && findMessageElement(anchorRef.current, id)) ids.add(id);
    }
    setTargets(ids);
  }, [anchorRef, data.asks]);

  React.useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [filter]);

  const jump = (messageId: string) => {
    const element = findMessageElement(anchorRef.current, messageId);
    if (!element) return;
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    element.animate?.(
      [{ boxShadow: '0 0 0 2px var(--accent-muted)' }, { boxShadow: '0 0 0 2px transparent' }],
      { duration: 1600, easing: 'ease-out' },
    );
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-label="Asks in this chat"
      className="absolute bottom-full left-0 z-40 mb-2 flex max-h-[min(32rem,60vh)] w-[min(30rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-[var(--radius-large)] border border-[var(--border)] bg-[var(--panel-alt)] shadow-[0_18px_55px_var(--shadow-color)]"
    >
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-12 font-[var(--weight-semibold)] text-[var(--fg)]">Asks</div>
          <div className="truncate text-10 text-[var(--muted)]">
            {outstanding} open · {settled} settled
            {data.tracking ? null : ' · not tracking'}
          </div>
        </div>
        <span
          className="shrink-0 rounded-full border border-[var(--border-subtle)] px-2 py-0.5 font-mono text-10 text-[var(--muted)]"
          title={describeAskCost(data.cost, 'in this chat')}
        >
          {formatAskCost(data.cost)}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close asks"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
        >
          ×
        </button>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-[var(--border-subtle)] px-3 py-1.5" role="tablist" aria-label="Ask kinds">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            onClick={() => setFilter(item.id)}
            className={`rounded-full px-2 py-0.5 text-10 transition-colors ${
              filter === item.id
                ? 'bg-[var(--selected)] text-[var(--fg)]'
                : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
            }`}
          >
            {item.label} <span className="text-[var(--muted-dim)]">{counts[item.id]}</span>
          </button>
        ))}
      </div>

      {!data.tracking ? (
        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2 text-11 text-[var(--muted)]">
          <span className="min-w-0 flex-1">This chat isn't tracked anymore, so the list is not updated.</span>
          <button
            type="button"
            disabled={state.tracking.isPending}
            onClick={() => state.tracking.mutate(true)}
            className="shrink-0 rounded border border-[var(--border-subtle)] px-2 py-0.5 text-11 text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-50"
          >
            Track again
          </button>
        </div>
      ) : data.processing ? (
        <div role="status" className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-1.5 text-11 text-[var(--muted)]">
          <IconSpinner className="h-3 w-3" />
          {data.asks.length === 0 ? 'Reading the chat so far…' : 'Updating…'}
        </div>
      ) : null}
      {data.tracking && data.error ? (
        <div role="alert" className="truncate border-b border-[var(--border-subtle)] px-3 py-1.5 text-11 text-[var(--red)]" title={data.error}>
          {data.error} · retrying shortly
        </div>
      ) : null}
      {statusError ? (
        <div role="alert" className="truncate border-b border-[var(--border-subtle)] px-3 py-1.5 text-11 text-[var(--red)]" title={statusError}>{statusError}</div>
      ) : null}

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        {groups.length === 0 ? (
          <div className="px-2 py-6 text-center text-11 text-[var(--muted)]">
            {data.processing ? 'Nothing recorded yet.' : filter === 'all' ? 'No asks yet. They appear as you send messages.' : `No ${FILTERS.find((item) => item.id === filter)!.label.toLowerCase()} yet.`}
          </div>
        ) : groups.map((group) => (
          <section key={group.runId} className="mb-1.5 last:mb-0">
            <div className="px-2 pb-0.5 pt-1 text-10 text-[var(--muted-dim)]">{formatTime(group.at)}</div>
            <ul>
              {group.asks.map((ask) => (
                <AskRow
                  key={ask.id}
                  ask={ask}
                  canJump={targets.has(ask.messageIds[0] ?? '')}
                  onJump={() => jump(ask.messageIds[0]!)}
                  busy={state.status.isPending}
                  onStatus={(status) => state.status.mutate({ askId: ask.id, status })}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function AskRow({ ask, canJump, onJump, busy, onStatus }: {
  ask: ChatAsk;
  canJump: boolean;
  onJump: () => void;
  busy: boolean;
  onStatus: (status: 'open' | 'done' | 'dismissed') => void;
}) {
  const retired = ask.status === 'replaced' || ask.status === 'dismissed';
  const detail = ask.note
    ?? (ask.previous ? `Asked again${ask.reopenedAt ? ` at ${formatTime(ask.reopenedAt)}` : ''}; was ${askStatusLabel({ ...ask, status: ask.previous.status, inProgress: false }).toLowerCase()}${ask.previous.note ? `: ${ask.previous.note}` : ''}` : '');
  const quote = <>“{ask.text}”</>;
  const actionClass = 'rounded px-1.5 py-0.5 text-10 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)] disabled:opacity-40';
  return (
    <li className="group/ask rounded-[var(--radius-medium)] px-2 py-1 hover:bg-[var(--hover)]">
      <div className="flex items-start gap-2">
        {canJump ? (
          <button
            type="button"
            onClick={onJump}
            title="Show this message in the chat"
            className={`min-w-0 flex-1 text-left text-12 leading-snug line-clamp-2 hover:underline ${retired ? 'text-[var(--muted)] line-through' : 'text-[var(--fg)]'}`}
          >
            {quote}
          </button>
        ) : (
          <span className={`min-w-0 flex-1 text-12 leading-snug line-clamp-2 ${retired ? 'text-[var(--muted)] line-through' : 'text-[var(--fg)]'}`}>{quote}</span>
        )}
        <span className={`inline-flex shrink-0 items-center gap-1 pt-px text-10 ${statusTone(ask)}`}>
          {ask.inProgress ? <IconSpinner className="h-2.5 w-2.5" /> : null}
          {askStatusLabel(ask)}
          {ask.manual ? <span className="text-[var(--muted-dim)]" title="Set by you">·you</span> : null}
        </span>
      </div>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 text-11 leading-snug text-[var(--muted)] line-clamp-2" title={detail || undefined}>
          <span className="text-[var(--muted-dim)]">{KIND_LABELS[ask.kind]}</span>
          {detail ? <> · {detail}</> : null}
        </div>
        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/ask:opacity-100">
          {ask.kind !== 'rule' && ask.status !== 'done' && !retired ? (
            <button type="button" disabled={busy} onClick={() => onStatus('done')} className={actionClass}>Mark done</button>
          ) : null}
          {!retired ? (
            <button type="button" disabled={busy} onClick={() => onStatus('dismissed')} className={actionClass}>Dismiss</button>
          ) : null}
          {ask.manual || ask.status === 'done' || ask.status === 'dismissed' ? (
            <button type="button" disabled={busy} onClick={() => onStatus('open')} className={actionClass}>Reopen</button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
