import { WORKER_STATE_OF, type DetailedCard } from './detailed-card-model';
import { Dot, STATE_COLOR, Steps } from '../entity/EntityWork';

/** One card in full at the canvas's bottom left: every step, its last reply, time and cost. */
export const CANVAS_STEPS_PANEL_WIDTH_PX = 320;

export function CanvasStepsPanel({ title, card, bottomPx }: { title: string; card: DetailedCard; bottomPx: number }) {
  // Nothing spent yet reads as no line, not a dash.
  const cost = card.cost === '—' ? '' : card.cost;
  // The line under the steps is the last reply; while working it is the current step, already listed above.
  const listed = card.steps ? [...card.steps.done, ...card.steps.doing, ...card.steps.next, card.steps.blocker].includes(card.text)
    || card.text === `Blocked: ${card.steps.blocker}` : false;
  return (
    <div data-canvas-steps-panel="" aria-live="polite" style={{ bottom: bottomPx, width: `min(${CANVAS_STEPS_PANEL_WIDTH_PX}px, calc(100% - 1rem))` }}
      className="dh-canvas-work work-card pointer-events-none absolute left-2 z-10 grid gap-1.5 rounded-[9px] border border-[var(--border)] bg-[var(--panel)] py-2 pl-3.5 pr-2.5 text-[12px] text-[var(--fg)]">
      <span className="absolute -left-px bottom-2.5 top-2.5 w-[3px] rounded-r" style={{ background: detailTone(card) }} />
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate text-[13px] font-semibold">{title}</span>
        <span className="ml-auto inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap" style={{ color: detailTone(card) }}>
          <Dot pulse={card.state === 'working'} />{card.label}
        </span>
      </div>
      {card.clock || cost ? (
        <div className="flex gap-1.5 font-mono text-[11px] tabular-nums text-[var(--muted)]" data-canvas-steps-panel-usage>
          {card.clock ? <span title={card.workingSince !== null ? 'How long it has been working' : 'Since it last stopped'}>{card.clock}</span> : null}
          {card.clock && cost ? <span aria-hidden="true">·</span> : null}
          {cost ? <span title={card.costTitle}>{cost}</span> : null}
        </div>
      ) : null}
      {card.steps ? <Steps w={{ steps: card.steps, state: WORKER_STATE_OF[card.state] }} /> : null}
      {card.stepsStale ? <div className="text-[11px] text-[var(--muted)]">Summarized while it was working; it stopped before a final summary.</div> : null}
      {card.text && !listed ? (
        <div className={`line-clamp-4 break-words ${card.steps ? 'border-t border-[var(--border)] pt-1.5 text-[var(--muted)]' : 'text-[var(--fg-secondary)]'}`}>{card.text}</div>
      ) : null}
    </div>
  );
}

/** The Entity's colour for the same state; working and thinking are one colour, as on its canvas. */
function detailTone(detail: DetailedCard): string {
  const state = WORKER_STATE_OF[detail.state];
  return STATE_COLOR[state === 'think' ? 'act' : state];
}
