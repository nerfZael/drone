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
  startedAt?: string | number;
  completedAt?: string | number;
  plan?: MobileAgentPlan;
  active: boolean;
};

export type MobileTranscriptGroup =
  | MobileTranscriptRun
  | { type: 'standalone'; key: string; item: AssistantRenderItem };

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
  if (item.type === 'tool') {
    return item.result?.createdAt ?? item.result?.timestamp;
  }
  for (let index = item.items.length - 1; index >= 0; index -= 1) {
    const timestamp = itemTimestamp(item.items[index]!);
    if (timestamp !== undefined) return timestamp;
  }
  return undefined;
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
    } else {
      for (const tool of item.items) plan = planFromTool(tool) ?? plan;
    }
  }
  return plan;
}

function finishRun(
  run: Omit<MobileTranscriptRun, 'toolCallCount' | 'startedAt' | 'completedAt' | 'plan' | 'active'>,
  active: boolean,
): MobileTranscriptRun {
  let metadata: MobileTranscriptRunMetadata | undefined;
  for (const item of run.items) {
    if (item.type !== 'message') continue;
    metadata = metadataFromMessage(item.message) ?? metadata;
  }
  return {
    ...run,
    toolCallCount: run.items.reduce((total, item) => total + toolCount(item), 0),
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
    'toolCallCount' | 'startedAt' | 'completedAt' | 'plan' | 'active'
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

export function mobileRunIsThinking(
  run: Pick<MobileTranscriptRun, 'active' | 'items'>,
): boolean {
  if (!run.active) return false;
  const lastItem = run.items.at(-1);
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
