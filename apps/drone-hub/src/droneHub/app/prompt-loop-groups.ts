import type { PendingPrompt, TranscriptItem } from '../types';
import { parseIsoMs } from './selected-drone-workspace-utils';

export type TranscriptRenderBlock =
  | { kind: 'turn'; key: string; item: TranscriptItem }
  | { kind: 'prompt-loop-group'; key: string; identity: string; runs: TranscriptItem[] };

export type TranscriptTimelineBlock = TranscriptRenderBlock | { kind: 'pending-prompt'; key: string; item: PendingPrompt };

export type PendingPromptLoopGroup = {
  key: string;
  identity: string;
  pendingRuns: PendingPrompt[];
};

function isPromptLoopAutomation(meta: TranscriptItem['automation'] | PendingPrompt['automation'] | undefined): boolean {
  const kind = String(meta?.kind ?? '').trim().toLowerCase();
  return kind === 'prompt-loop';
}

function promptLoopGroupIdentityFromMeta(
  meta: TranscriptItem['automation'] | PendingPrompt['automation'],
  promptSeedRaw: string,
): string {
  const jobKey = String(meta?.jobKey ?? '').trim();
  if (jobKey) return `job:${jobKey}`;
  const automationId = String(meta?.automationId ?? '').trim();
  const runsTotal = Number(meta?.runsTotal);
  const runsTotalToken = Number.isFinite(runsTotal) && runsTotal > 0 ? String(Math.floor(runsTotal)) : '';
  const preview = String(meta?.promptPreview ?? '').trim();
  const promptSeed = preview || promptSeedRaw;
  return `fallback:${automationId}:${runsTotalToken}:${promptSeed.slice(0, 120)}`;
}

function promptLoopGroupIdentity(item: TranscriptItem): string {
  return promptLoopGroupIdentityFromMeta(item.automation, String(item.prompt ?? '').trim());
}

function pendingPromptLoopGroupIdentity(item: PendingPrompt): string {
  return promptLoopGroupIdentityFromMeta(item.automation, String(item.prompt ?? '').trim());
}

export function buildTranscriptRenderBlocks(items: TranscriptItem[]): TranscriptRenderBlock[] {
  const blocks: TranscriptRenderBlock[] = [];
  for (let idx = 0; idx < items.length; ) {
    const item = items[idx];
    if (!isPromptLoopAutomation(item.automation)) {
      blocks.push({
        kind: 'turn',
        key: `turn:${item.turn}:${item.at}:${idx}`,
        item,
      });
      idx += 1;
      continue;
    }

    const groupIdentity = promptLoopGroupIdentity(item);
    const runs: TranscriptItem[] = [item];
    idx += 1;
    while (idx < items.length) {
      const next = items[idx];
      if (!isPromptLoopAutomation(next.automation)) break;
      if (promptLoopGroupIdentity(next) !== groupIdentity) break;
      runs.push(next);
      idx += 1;
    }
    const first = runs[0];
    blocks.push({
      kind: 'prompt-loop-group',
      key: `prompt-loop:${groupIdentity}:${first.turn}:${runs.length}`,
      identity: groupIdentity,
      runs,
    });
  }
  return blocks;
}

export function pendingPromptTimelineSortMs(item: PendingPrompt): number {
  const queuedMs = parseIsoMs(item.at);
  const activeMs = parseIsoMs(item.updatedAt ?? item.at);
  if (item.state === 'sending' || item.state === 'sent') {
    return activeMs || queuedMs;
  }
  return queuedMs || activeMs;
}

export function transcriptTimelineSortMs(block: TranscriptTimelineBlock): number {
  if (block.kind === 'pending-prompt') return pendingPromptTimelineSortMs(block.item);
  if (block.kind === 'turn') {
    return parseIsoMs(block.item.promptAt ?? block.item.at);
  }
  const first = block.runs[0];
  return parseIsoMs(first?.promptAt ?? first?.at);
}

function isActivePendingPrompt(item: PendingPrompt): boolean {
  return item.state === 'sending' || item.state === 'sent';
}

function comparePendingPromptTimelineBlocks(
  a: TranscriptTimelineBlock,
  b: TranscriptTimelineBlock,
): number | null {
  if (a.kind !== 'pending-prompt' || b.kind !== 'pending-prompt') return null;
  const aActive = isActivePendingPrompt(a.item);
  const bActive = isActivePendingPrompt(b.item);
  if (aActive && b.item.state === 'queued') return -1;
  if (a.item.state === 'queued' && bActive) return 1;
  const aSubmittedMs = parseIsoMs(a.item.at);
  const bSubmittedMs = parseIsoMs(b.item.at);
  if (aSubmittedMs !== bSubmittedMs) return aSubmittedMs - bSubmittedMs;
  return 0;
}

export function buildTranscriptTimelineBlocks(opts: {
  transcriptRenderBlocks: TranscriptRenderBlock[];
  pendingPlainPrompts: PendingPrompt[];
}): TranscriptTimelineBlock[] {
  const items: Array<(TranscriptTimelineBlock & { sortMs: number; order: number })> = [];
  let order = 0;

  for (const block of opts.transcriptRenderBlocks) {
    items.push({
      ...block,
      sortMs: transcriptTimelineSortMs(block),
      order: order++,
    });
  }

  for (const item of opts.pendingPlainPrompts) {
    items.push({
      kind: 'pending-prompt',
      key: `pending-prompt:${item.id}`,
      item,
      sortMs: transcriptTimelineSortMs({ kind: 'pending-prompt', key: `pending-prompt:${item.id}`, item }),
      order: order++,
    });
  }

  items.sort((a, b) => {
    const pendingOrder = comparePendingPromptTimelineBlocks(a, b);
    if (pendingOrder !== null) return pendingOrder || (a.order - b.order);
    if (a.sortMs !== b.sortMs) return a.sortMs - b.sortMs;
    return a.order - b.order;
  });

  return items.map(({ sortMs: _sortMs, order: _order, ...item }) => item);
}

export function buildPendingPromptLoopGroups(items: PendingPrompt[]): {
  groups: PendingPromptLoopGroup[];
  plainPendingPrompts: PendingPrompt[];
} {
  const grouped = new Map<string, PendingPrompt[]>();
  const plainPendingPrompts: PendingPrompt[] = [];
  for (const item of items) {
    if (!isPromptLoopAutomation(item.automation)) {
      plainPendingPrompts.push(item);
      continue;
    }
    const identity = pendingPromptLoopGroupIdentity(item);
    const existing = grouped.get(identity);
    if (existing) {
      existing.push(item);
      continue;
    }
    grouped.set(identity, [item]);
  }
  const groups = Array.from(grouped.entries()).map(([identity, pendingRuns], idx) => ({
    key: `pending-prompt-loop:${identity}:${idx}`,
    identity,
    pendingRuns,
  }));
  return { groups, plainPendingPrompts };
}
