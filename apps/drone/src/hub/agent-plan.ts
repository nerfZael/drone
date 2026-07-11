export type AgentPlanItemStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type AgentPlan = {
  items: Array<{
    id?: string;
    text: string;
    status: AgentPlanItemStatus;
  }>;
  updatedAt: string;
  source: 'cursor' | 'codex' | 'claude' | 'opencode';
};

function normalizeStatus(raw: unknown, completedRaw: unknown): AgentPlanItemStatus {
  if (completedRaw === true) return 'completed';
  const status = String(raw ?? '').trim().toLowerCase().replace(/-/g, '_');
  if (status === 'completed' || status === 'complete' || status === 'done') return 'completed';
  if (status === 'in_progress' || status === 'inprogress' || status === 'active' || status === 'running') return 'in_progress';
  if (status === 'cancelled' || status === 'canceled' || status === 'skipped') return 'cancelled';
  return 'pending';
}

export function normalizeAgentPlan(
  raw: unknown,
  source: AgentPlan['source'],
  updatedAt = new Date().toISOString(),
): AgentPlan | undefined {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as any).items)
      ? (raw as any).items
      : raw && typeof raw === 'object' && Array.isArray((raw as any).todos)
        ? (raw as any).todos
        : [];
  const items = list
    .map((item: any, index: number) => {
      if (typeof item === 'string') {
        const text = item.trim();
        return text ? { text, status: 'pending' as const } : null;
      }
      if (!item || typeof item !== 'object') return null;
      const text = String(item.text ?? item.content ?? item.title ?? item.task ?? '').trim();
      if (!text) return null;
      const id = String(item.id ?? item.todoId ?? item.todo_id ?? '').trim();
      return {
        ...(id ? { id } : {}),
        text: text.slice(0, 1000),
        status: normalizeStatus(item.status, item.completed),
        order: index,
      };
    })
    .filter(Boolean)
    .slice(0, 50)
    .map(({ order: _order, ...item }: any) => item);
  if (items.length === 0) return undefined;
  const timestamp = Number.isFinite(Date.parse(updatedAt)) ? updatedAt : new Date().toISOString();
  return { items, updatedAt: timestamp, source };
}

export function sameAgentPlan(left: unknown, right: unknown): boolean {
  const comparable = (value: any) =>
    value && typeof value === 'object'
      ? { source: value.source, items: Array.isArray(value.items) ? value.items : [] }
      : null;
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}
