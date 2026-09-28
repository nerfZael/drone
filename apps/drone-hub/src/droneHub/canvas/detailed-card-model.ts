/**
 * What a detailed canvas card shows, like the Entity's Work cards: a state, its steps, how long it has been working
 * (or since it last did), and what it has cost. What is going on goes in the steps panel, not on the card. Pure, so the canvas derives it on render.
 */

/** `done`: it has worked and is waiting for you; `idle`: it has not worked yet. */
export type DetailedCardState = 'need' | 'working' | 'queued' | 'done' | 'idle' | 'starting';

/** The Entity's worker state with the same meaning, for its colours and step glyphs. */
export const WORKER_STATE_OF: Record<DetailedCardState, 'need' | 'think' | 'act' | 'wait' | 'done' | 'stop'> = {
  need: 'need', working: 'act', starting: 'think', queued: 'wait', done: 'done', idle: 'wait',
};

/** Cost and timing of one chat, from the Hub's usage records (`/api/usage/chats`). */
export type ChatActivity = {
  estimatedCost: number;
  tokens: number;
  unpriced: number;
  /** Of the cost, what summarizing its steps took. */
  stepsCost?: number;
  runningSince: string | null;
  lastEndedAt: string | null;
};

/** A chat's latest turn in short steps, from the Hub's step tracking (`/api/chats/steps`). */
export type ChatSteps = {
  turnId: string;
  done: string[];
  doing: string[];
  next: string[];
  blocker?: string;
  final: boolean;
  updatedAt: string;
};

export type DetailedCardInput = {
  busy: boolean;
  unread: boolean;
  approval: boolean;
  queued: boolean;
  statusOk: boolean;
  statusError: string | null;
  hubPhase?: string | null;
  hubMessage?: string | null;
  lastAgentSnippet: string | null;
  activity?: ChatActivity | null;
  steps?: ChatSteps | null;
  /** When this client first saw the chat working, for work the usage records have not reported yet. */
  busySeenAt?: number | null;
};

/** The sidebar's state for the same chat, so the card draws the same icon (spinner, clock, approval…). */
export type SidebarIconState = 'working' | 'queued' | 'approval' | 'starting' | 'blocked' | 'idle';

export type DetailedCard = {
  state: DetailedCardState;
  icon: SidebarIconState;
  label: string;
  /** Off on a drone card whose chats have their own cards: they say it. */
  showState: boolean;
  /** A reply this client has not read yet. */
  unread: boolean;
  text: string;
  /** "3m" while working, "14m ago" after; empty when nothing is known. */
  clock: string;
  /** Epoch ms the working clock counts from, while working. */
  workingSince: number | null;
  cost: string;
  costTitle: string;
  /** Step counts for the progress dots, when the chat has steps. */
  pips: { done: number; doing: number; next: number } | null;
  /** Every step, for the hover text. */
  stepsTitle: string;
  /** The steps themselves, for the steps panel. */
  steps: ChatSteps | null;
  /** Summarized while it worked, and it has stopped since without a final summary: only what was done still holds. */
  stepsStale: boolean;
};

/** The widest a detailed card gets; a longer name ends in an ellipsis. */
export const DETAILED_CARD_WIDTH_PX = 440;
const DETAILED_CARD_MIN_WIDTH_PX = 140;
/** Padding and border around a detailed card's content. */
const DETAILED_CARD_CHROME_PX = 26;
/** Room kept for the working time and cost ("2h25m", "$0.00"), so the card does not change width as they change. */
const DETAILED_FOOTER_TEXT_PX = 84;
const PIP_PX = 9;

/**
 * A detailed card as wide as its name (title text at 13px, beside its icons) or its footer needs, whichever is wider.
 * `titleWidthPx` is the name's width at the compact card's 12.5px.
 */
export function detailedCardWidthPx(titleWidthPx: number, opts: { pips: number; stateIcon: boolean; runtimeIcon: boolean }): number {
  const title = Math.ceil(titleWidthPx * 13 / 12.5) + (opts.stateIcon ? 18 : 0) + (opts.runtimeIcon ? 20 : 0);
  const footer = opts.pips * PIP_PX + (opts.pips ? 10 : 0) + DETAILED_FOOTER_TEXT_PX;
  return Math.max(DETAILED_CARD_MIN_WIDTH_PX, Math.min(DETAILED_CARD_WIDTH_PX, Math.max(title, footer) + DETAILED_CARD_CHROME_PX));
}
export const DETAILED_CARD_HEIGHT_PX = 50;
/**
 * Detailed cards are drawn at the stored positions spread apart by these factors, so the arrangement made
 * with compact cards holds without the bigger cards overlapping. Positions stay stored in compact space.
 */
export const DETAILED_CARD_SPREAD = { x: 2.25, y: 1.25 } as const;

const STATE_LABEL: Record<DetailedCardState, string> = {
  need: 'needs you', working: 'working', queued: 'queued', done: 'done', idle: 'idle', starting: 'starting',
};

/** 30s under a minute, 32m under an hour, then 2h25m, then 3d4h. */
export function durationText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h${m % 60}m` : `${h}h`;
  return h % 24 ? `${Math.floor(h / 24)}d${h % 24}h` : `${Math.floor(h / 24)}d`;
}

/** An estimated cost; without a price, a dash rather than a token count. */
export function costText(activity: Pick<ChatActivity, 'estimatedCost'> | null | undefined): string {
  const cost = activity?.estimatedCost ?? 0;
  if (!(cost > 0)) return '—';
  return cost < 0.005 ? '<$0.01' : `$${cost < 10 ? cost.toFixed(2) : cost.toFixed(0)}`;
}

const time = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

export function deriveDetailedCard(input: DetailedCardInput, now: number): DetailedCard {
  const starting = input.hubPhase === 'creating' || input.hubPhase === 'starting' || input.hubPhase === 'seeding';
  const failed = input.hubPhase === 'error' || (!input.statusOk && Boolean(input.statusError) && !starting);
  const state: DetailedCardState = input.approval || failed
    ? 'need'
    : starting ? 'starting'
      : input.busy ? 'working'
        : input.queued ? 'queued'
          : input.unread || input.activity?.lastEndedAt || input.lastAgentSnippet || input.steps ? 'done'
            : 'idle';
  const snippet = String(input.lastAgentSnippet ?? '').replace(/\s+/g, ' ').trim();
  // What it was doing and planned when last summarized is not true once it has stopped.
  const stepsStale = Boolean(input.steps && !input.steps.final && !input.busy);
  const steps = input.steps && stepsStale ? { ...input.steps, doing: [], next: [], blocker: undefined } : input.steps ?? null;
  // While it works, its steps say what it is doing now; its last reply is from the turn before.
  const current = input.busy && steps && !steps.final
    ? steps.blocker ? `Blocked: ${steps.blocker}` : steps.doing[0] ?? steps.done[steps.done.length - 1] ?? ''
    : '';
  const text = input.approval
    ? 'Waiting for your approval'
    : failed
      ? String(input.hubMessage || input.statusError || 'Something went wrong')
      : starting
        ? String(input.hubMessage || 'Starting…')
        : input.queued && !input.busy
          ? 'Queued behind the current message'
          : current || snippet || (input.busy ? 'Working on it…' : 'No replies yet');
  const workingSince = input.busy ? time(input.activity?.runningSince) ?? input.busySeenAt ?? null : null;
  const endedAt = time(input.activity?.lastEndedAt);
  const clock = workingSince !== null
    ? durationText(now - workingSince)
    : !input.busy && endedAt !== null ? `${durationText(now - endedAt)} ago` : '';
  const activity = input.activity;
  const costTitle = activity
    ? `Estimated token cost at list prices: ${costText(activity)}${activity.unpriced ? ` (${activity.unpriced} usage record${activity.unpriced === 1 ? '' : 's'} not priced)` : ''}. Not a subscription charge.`
    : 'No usage recorded for this chat yet';
  const stepsCost = activity?.stepsCost ? ` Of it, step summaries: ${costText({ estimatedCost: activity.stepsCost })}.` : '';
  const unpricedOnly = activity && !(activity.estimatedCost > 0) && activity.tokens > 0
    ? `${activity.tokens.toLocaleString()} tokens, no price known for their model.` : '';
  const icon: SidebarIconState = input.approval ? 'approval' : failed ? 'blocked' : starting ? 'starting'
    : input.busy ? 'working' : input.queued ? 'queued' : 'idle';
  return {
    state, icon, label: STATE_LABEL[state], showState: true, unread: input.unread, text, clock, workingSince, cost: costText(activity),
    costTitle: unpricedOnly || costTitle + stepsCost,
    pips: steps ? { done: steps.done.length, doing: steps.doing.length, next: steps.next.length } : null,
    stepsTitle: steps ? stepsText(steps) : '',
    steps,
    stepsStale,
  };
}

/** Every step as lines: ✓ done, ● doing, ○ next, ! blocker. */
export function stepsText(steps: ChatSteps): string {
  return [
    ...steps.done.map((step) => `✓ ${step}`),
    ...steps.doing.map((step) => `● ${step}`),
    ...steps.next.map((step) => `○ ${step}`),
    ...(steps.blocker ? [`! ${steps.blocker}`] : []),
  ].join('\n');
}

const STATE_RANK: Record<DetailedCardState, number> = { need: 0, working: 1, starting: 2, queued: 3, done: 4, idle: 5 };

/** A drone card sums its chats: the most urgent state, the earliest running work, the latest end, the total cost. */
export function combineDetailedCards(cards: DetailedCard[], activities: Array<ChatActivity | null | undefined>, now: number, chatCount: number): DetailedCard {
  const lead = cards.slice().sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state])[0];
  const state = lead?.state ?? 'idle';
  const working = cards.filter((card) => card.state === 'working').length;
  const need = cards.filter((card) => card.state === 'need').length;
  const since = cards.map((card) => card.workingSince).filter((t): t is number => t !== null);
  const workingSince = since.length ? Math.min(...since) : null;
  const ended = activities.map((a) => time(a?.lastEndedAt)).filter((t): t is number => t !== null);
  const known = activities.filter((a): a is ChatActivity => Boolean(a));
  const total = known.length ? { estimatedCost: known.reduce((sum, a) => sum + a.estimatedCost, 0) } : null;
  const parts = [`${chatCount} chat${chatCount === 1 ? '' : 's'}`];
  if (need) parts.push(`${need} need${need === 1 ? 's' : ''} you`);
  if (working) parts.push(`${working} working`);
  return {
    state,
    icon: lead?.icon ?? 'idle',
    label: STATE_LABEL[state],
    showState: true,
    unread: cards.some((card) => card.unread),
    text: state === 'need' || state === 'starting' ? `${lead.text} · ${parts.join(' · ')}` : parts.join(' · '),
    clock: workingSince !== null ? durationText(now - workingSince) : ended.length ? `${durationText(now - Math.max(...ended))} ago` : '',
    workingSince,
    cost: costText(total),
    costTitle: total ? `Estimated token cost of all its chats at list prices: ${costText(total)}. Not a subscription charge.` : 'No usage recorded for this drone yet',
    pips: null,
    stepsTitle: '',
    steps: null,
    stepsStale: false,
  };
}
