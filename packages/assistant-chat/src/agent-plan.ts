export type AgentPlanItemStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type AgentPlanProviderSource = 'cursor' | 'codex' | 'claude' | 'opencode';

export type AgentPlanSource = AgentPlanProviderSource;

export type AgentPlanItem = {
  id?: string;
  text: string;
  status: AgentPlanItemStatus;
};

export type AgentPlan = {
  items: AgentPlanItem[];
  updatedAt: string;
  source: AgentPlanProviderSource;
};

const DEFAULT_AGENT_PLAN_SOURCE: AgentPlanProviderSource = 'codex';
const MAX_AGENT_PLAN_ITEMS = 50;
const MAX_AGENT_PLAN_ITEM_TEXT_LENGTH = 1_000;

export function normalizeAgentPlan(
  raw: unknown,
  source?: AgentPlanProviderSource,
  updatedAt?: string,
): AgentPlan | undefined {
  const record = objectRecord(raw);
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(record?.items)
      ? record.items
      : Array.isArray(record?.todos)
        ? record.todos
        : Array.isArray(record?.plan)
          ? record.plan
          : [];
  const items = list
    .map(normalizeAgentPlanItem)
    .filter((item): item is AgentPlanItem => item !== undefined)
    .slice(0, MAX_AGENT_PLAN_ITEMS);
  if (items.length === 0) return undefined;

  const planSource =
    source ?? normalizeAgentPlanSource(record?.source) ?? DEFAULT_AGENT_PLAN_SOURCE;
  const timestampCandidate =
    updatedAt ??
    (source === undefined ? String(record?.updatedAt ?? '') : new Date().toISOString());
  const timestamp = Number.isFinite(Date.parse(timestampCandidate))
    ? timestampCandidate
    : new Date().toISOString();
  return { items, updatedAt: timestamp, source: planSource };
}

export function sameAgentPlan(left: unknown, right: unknown): boolean {
  const comparable = (value: unknown) => {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    return { source: record.source, items: Array.isArray(record.items) ? record.items : [] };
  };
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

function normalizeAgentPlanItem(raw: unknown): AgentPlanItem | undefined {
  if (typeof raw === 'string') {
    const text = raw.trim();
    return text ? { text, status: 'pending' } : undefined;
  }
  const item = objectRecord(raw);
  if (!item) return undefined;
  const text = String(
    item.text ?? item.content ?? item.title ?? item.task ?? item.step ?? '',
  ).trim();
  if (!text) return undefined;
  const id = String(item.id ?? item.todoId ?? item.todo_id ?? '').trim();
  return {
    ...(id ? { id } : {}),
    text: text.slice(0, MAX_AGENT_PLAN_ITEM_TEXT_LENGTH),
    status: normalizeAgentPlanItemStatus(item.status, item.completed),
  };
}

function normalizeAgentPlanItemStatus(raw: unknown, completedRaw: unknown): AgentPlanItemStatus {
  if (completedRaw === true) return 'completed';
  const status = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (status === 'completed' || status === 'complete' || status === 'done') return 'completed';
  if (
    status === 'in_progress' ||
    status === 'inprogress' ||
    status === 'active' ||
    status === 'running'
  ) {
    return 'in_progress';
  }
  if (status === 'cancelled' || status === 'canceled' || status === 'skipped') {
    return 'cancelled';
  }
  return 'pending';
}

function normalizeAgentPlanSource(raw: unknown): AgentPlanProviderSource | undefined {
  const source = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (source === 'cursor' || source === 'codex' || source === 'claude' || source === 'opencode') {
    return source;
  }
  return undefined;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
