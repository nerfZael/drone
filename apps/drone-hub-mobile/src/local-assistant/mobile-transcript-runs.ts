import {
  messageImageParts,
  messageVisibleText,
  toolActivityIsSettled,
  type AssistantMessage,
  type AssistantRenderItem,
  type AssistantToolRenderItem,
} from '@drone/assistant-chat';

export type MobileAgentPlanItem = {
  id?: string;
  text: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
};

export type MobileAgentPlan = {
  items: MobileAgentPlanItem[];
  updatedAt?: string;
  source?: string;
};

export type MobileTranscriptRunMetadata = {
  id?: string;
  startedAt?: string | number;
  completedAt?: string | number;
  plan?: MobileAgentPlan;
};

export type MobileTranscriptRun = {
  type: 'run';
  key: string;
  user: Extract<AssistantRenderItem, { type: 'message' }>;
  items: AssistantRenderItem[];
  toolCallCount: number;
  durationMs?: number;
  startedAt?: string | number;
  completedAt?: string | number;
  plan?: MobileAgentPlan;
  active: boolean;
};

export type MobileTranscriptGroup =
  | MobileTranscriptRun
  | { type: 'standalone'; key: string; item: AssistantRenderItem };

export const AUTO_EXPANDED_MOBILE_TOOL_CALL_LIMIT = 5;

const PLAN_STATUSES = new Set(['pending', 'in_progress', 'completed', 'cancelled']);

export function normalizeMobileAgentPlan(value: unknown): MobileAgentPlan | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.items) && !Array.isArray(source.plan)) return undefined;
  const rawItems: unknown[] = Array.isArray(source.items)
    ? source.items
    : (source.plan as unknown[]);
  const items = rawItems.flatMap((raw): MobileAgentPlanItem[] => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const item = raw as Record<string, unknown>;
    const text = String(item.text ?? item.step ?? '').trim();
    const status = String(item.status ?? 'pending').trim();
    if (!text || !PLAN_STATUSES.has(status)) return [];
    const id = String(item.id ?? '').trim();
    return [{ ...(id ? { id } : {}), text, status: status as MobileAgentPlanItem['status'] }];
  });
  if (items.length === 0) return undefined;
  const updatedAt = String(source.updatedAt ?? '').trim();
  const planSource = String(source.source ?? '').trim();
  return {
    items,
    ...(updatedAt ? { updatedAt } : {}),
    ...(planSource ? { source: planSource } : {}),
  };
}

export function mobileRunDetails(metadata: MobileTranscriptRunMetadata): Record<string, unknown> {
  return { mobileRun: metadata };
}

function metadataFromMessage(message: AssistantMessage): MobileTranscriptRunMetadata | undefined {
  const details = message.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;
  const value = (details as Record<string, unknown>).mobileRun;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const run = value as Record<string, unknown>;
  return {
    id: String(run.id ?? '').trim() || undefined,
    startedAt:
      typeof run.startedAt === 'string' || typeof run.startedAt === 'number'
        ? run.startedAt
        : undefined,
    completedAt:
      typeof run.completedAt === 'string' || typeof run.completedAt === 'number'
        ? run.completedAt
        : undefined,
    plan: normalizeMobileAgentPlan(run.plan),
  };
}

function itemTimestamp(item: AssistantRenderItem): string | number | undefined {
  if (item.type === 'message') return item.message.createdAt ?? item.message.timestamp;
  if (item.type === 'runSummary') return item.fileChanges.capturedAt;
  if (item.type === 'compaction') return item.timestamp;
  if (item.type === 'tool') {
    return item.result?.createdAt ?? item.result?.timestamp;
  }
  for (let index = item.items.length - 1; index >= 0; index -= 1) {
    const timestamp = itemTimestamp(item.items[index]!);
    if (timestamp !== undefined) return timestamp;
  }
  return undefined;
}

export function mobileTranscriptGroupStartedAt(
  group: MobileTranscriptGroup,
): string | number | undefined {
  return group.type === 'run' ? group.startedAt : itemTimestamp(group.item);
}

export function sortMobileTranscriptTimeline<T extends { atMs: number; order: number }>(
  entries: readonly T[],
): T[] {
  return [...entries].sort((left, right) => {
    const leftHasTime = Number.isFinite(left.atMs);
    const rightHasTime = Number.isFinite(right.atMs);
    if (leftHasTime && rightHasTime && left.atMs !== right.atMs) return left.atMs - right.atMs;
    if (leftHasTime !== rightHasTime) return leftHasTime ? -1 : 1;
    return left.order - right.order;
  });
}

function toolCount(item: AssistantRenderItem): number {
  if (item.type === 'tool') return 1;
  return item.type === 'toolGroup' ? item.items.length : 0;
}

function planFromTool(item: AssistantToolRenderItem): MobileAgentPlan | undefined {
  if (String(item.call?.name ?? item.result?.toolName ?? '') !== 'update_plan') return undefined;
  return normalizeMobileAgentPlan(item.call?.args);
}

function planFromRunItems(items: AssistantRenderItem[]): MobileAgentPlan | undefined {
  let plan: MobileAgentPlan | undefined;
  for (const item of items) {
    if (item.type === 'message') {
      plan = metadataFromMessage(item.message)?.plan ?? plan;
    } else if (item.type === 'tool') {
      plan = planFromTool(item) ?? plan;
    } else if (item.type === 'toolGroup') {
      for (const tool of item.items) plan = planFromTool(tool) ?? plan;
    }
  }
  return plan;
}

function finishRun(
  run: Omit<
    MobileTranscriptRun,
    'toolCallCount' | 'durationMs' | 'startedAt' | 'completedAt' | 'plan' | 'active'
  >,
  active: boolean,
): MobileTranscriptRun {
  let metadata: MobileTranscriptRunMetadata | undefined;
  let durationMs = 0;
  let hasDuration = false;
  let projectedDurationMs: number | undefined;
  for (const item of run.items) {
    if (item.type === 'runSummary' && Number.isFinite(item.durationMs)) {
      durationMs += Math.max(0, Number(item.durationMs));
      hasDuration = true;
      continue;
    }
    if (item.type !== 'message') continue;
    metadata = metadataFromMessage(item.message) ?? metadata;
    if (item.message.role === 'assistant') {
      const details = item.message.details;
      const projected = Number(
        details && typeof details === 'object' && !Array.isArray(details)
          ? (details as Record<string, unknown>).runDurationMs
          : Number.NaN,
      );
      if (Number.isFinite(projected) && projected >= 0) projectedDurationMs = projected;
    }
  }
  return {
    ...run,
    toolCallCount: run.items.reduce((total, item) => total + toolCount(item), 0),
    ...(projectedDurationMs !== undefined
      ? { durationMs: projectedDurationMs }
      : hasDuration
        ? { durationMs }
        : {}),
    startedAt: metadata?.startedAt ?? itemTimestamp(run.user),
    completedAt:
      metadata?.completedAt ??
      (active
        ? undefined
        : [...run.items]
            .reverse()
            .map(itemTimestamp)
            .find((value) => value !== undefined)),
    plan: metadata?.plan ?? planFromRunItems(run.items),
    active,
  };
}

export function groupMobileTranscriptRuns(
  items: AssistantRenderItem[],
  options: { running?: boolean; hasSeparateActivePrompt?: boolean } = {},
): MobileTranscriptGroup[] {
  const groups: MobileTranscriptGroup[] = [];
  let current: Omit<
    MobileTranscriptRun,
    'toolCallCount' | 'durationMs' | 'startedAt' | 'completedAt' | 'plan' | 'active'
  > | null = null;

  const flush = () => {
    if (!current) return;
    groups.push(finishRun(current, false));
    current = null;
  };

  for (const item of items) {
    if (item.type === 'message' && item.message.role === 'user') {
      flush();
      current = { type: 'run', key: `run:${item.key}`, user: item, items: [] };
    } else if (current) {
      current.items.push(item);
    } else {
      groups.push({ type: 'standalone', key: `standalone:${item.key}`, item });
    }
  }
  flush();

  if (options.running && !options.hasSeparateActivePrompt) {
    const last = groups.at(-1);
    if (last?.type === 'run') groups[groups.length - 1] = finishRun(last, true);
  }
  return groups;
}

export function workingDurationLabel(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(Number(durationMs) / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function mobileRunIsThinking(run: Pick<MobileTranscriptRun, 'active' | 'items'>): boolean {
  if (!run.active) return false;
  const lastItem = [...run.items].reverse().find((item) => item.type !== 'runSummary');
  if (!lastItem) return false;
  if (
    lastItem.type === 'message' &&
    lastItem.message.role === 'assistant' &&
    (messageVisibleText(lastItem.message).trim() ||
      messageImageParts(lastItem.message).length > 0 ||
      lastItem.message.errorMessage)
  ) {
    return false;
  }
  const tools = run.items.flatMap((item) =>
    item.type === 'tool' ? [item] : item.type === 'toolGroup' ? item.items : [],
  );
  return tools.length > 0 && tools.every(toolActivityIsSettled);
}

export function partitionMobileRunItems(run: Pick<MobileTranscriptRun, 'active' | 'items'>): {
  activityItems: AssistantRenderItem[];
  trailingItems: AssistantRenderItem[];
} {
  let finalResponseIndex = -1;
  if (!run.active) {
    for (let index = run.items.length - 1; index >= 0; index -= 1) {
      const item = run.items[index];
      if (
        item?.type === 'message' &&
        item.message.role === 'assistant' &&
        (messageVisibleText(item.message).trim() ||
          messageImageParts(item.message).length > 0 ||
          item.message.errorMessage)
      ) {
        finalResponseIndex = index;
        break;
      }
    }
  }
  return {
    activityItems: run.items.filter(
      (item, index) =>
        index !== finalResponseIndex && item.type !== 'runSummary' && item.type !== 'compaction',
    ),
    trailingItems: run.items.filter(
      (item, index) =>
        index === finalResponseIndex || item.type === 'runSummary' || item.type === 'compaction',
    ),
  };
}

export function limitMobileRunToolItems(
  items: AssistantRenderItem[],
  limit = AUTO_EXPANDED_MOBILE_TOOL_CALL_LIMIT,
): AssistantRenderItem[] {
  let remainingTools = Math.max(0, Math.floor(limit));
  const visible: AssistantRenderItem[] = [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (item.type === 'tool') {
      if (remainingTools > 0) {
        visible.push(item);
        remainingTools -= 1;
      }
      continue;
    }
    if (item.type === 'toolGroup') {
      if (remainingTools <= 0) continue;
      const groupItems = item.items.slice(-remainingTools);
      remainingTools -= groupItems.length;
      visible.push({ ...item, items: groupItems });
      continue;
    }
    visible.push(item);
  }
  return visible.reverse();
}
