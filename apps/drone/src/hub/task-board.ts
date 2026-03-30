export type TaskBoardTaskType = {
  id: string;
  label: string;
  active: boolean;
};

export type TaskBoardScopeType = 'global' | 'repo' | 'group' | 'drone';

export type TaskBoardCard = {
  id: string;
  title: string;
  description: string;
  typeId: string;
  createdAt: string;
  updatedAt: string;
  scopeType?: TaskBoardScopeType;
  scopeValue?: string;
  repoPath?: string;
  droneId?: string;
  droneName?: string;
  playbookId?: string;
  playbookLabel?: string;
  chatName?: string;
  prompt?: string;
  promptId?: string;
  messageId?: string;
};

export type TaskBoardLane = {
  id: string;
  title: string;
  cards: TaskBoardCard[];
};

export type TaskBoardState = {
  taskTypes: TaskBoardTaskType[];
  lanes: TaskBoardLane[];
};

export type TaskBoardScopedTask = TaskBoardCard & {
  typeLabel: string;
  laneId: string;
  laneTitle: string;
};

const TASK_TITLE_MAX_CHARS = 240;
const DEFAULT_TASK_BOARD_LANES = ['To do', 'In progress', 'Review', 'Done'] as const;
const TASK_BOARD_SCOPE_TYPES = new Set<TaskBoardScopeType>(['global', 'repo', 'group', 'drone']);
const DEFAULT_TASK_BOARD_TYPES = [
  { id: 'bug', label: 'Bug', active: true },
  { id: 'feature', label: 'Feature', active: true },
  { id: 'idea', label: 'Idea', active: true },
] as const;

function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeTaskTypeId(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function normalizeTaskTitle(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const collapsed = (firstLine || text).replace(/\s+/g, ' ').trim();
  return collapsed.slice(0, TASK_TITLE_MAX_CHARS);
}

export function normalizeTaskBoardScopeType(raw: unknown): TaskBoardScopeType | null {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  return TASK_BOARD_SCOPE_TYPES.has(value as TaskBoardScopeType) ? (value as TaskBoardScopeType) : null;
}

function normalizeTaskBoardScopeValue(
  scopeType: TaskBoardScopeType,
  scopeValueRaw: unknown,
  fallbackRepoPathRaw?: unknown,
): string {
  if (scopeType === 'global') return '';
  const fallbackRepoPath = String(fallbackRepoPathRaw ?? '').trim();
  const value = String(scopeValueRaw ?? '').trim();
  if (scopeType === 'repo') return value || fallbackRepoPath;
  return value;
}

export function resolveTaskBoardCardScope(card: Pick<TaskBoardCard, 'scopeType' | 'scopeValue' | 'repoPath'>): {
  scopeType: TaskBoardScopeType;
  scopeValue: string;
} {
  const repoPath = String(card.repoPath ?? '').trim();
  const scopeType = normalizeTaskBoardScopeType(card.scopeType);
  if (!scopeType) {
    return repoPath ? { scopeType: 'repo', scopeValue: repoPath } : { scopeType: 'global', scopeValue: '' };
  }
  const scopeValue = normalizeTaskBoardScopeValue(scopeType, card.scopeValue, repoPath);
  if (!scopeValue && scopeType !== 'global') {
    return repoPath ? { scopeType: 'repo', scopeValue: repoPath } : { scopeType: 'global', scopeValue: '' };
  }
  return { scopeType, scopeValue };
}

export function createDefaultTaskBoardState(): TaskBoardState {
  return {
    taskTypes: DEFAULT_TASK_BOARD_TYPES.map((item) => ({ ...item })),
    lanes: DEFAULT_TASK_BOARD_LANES.map((title, index) => ({
      id: `lane-${index + 1}`,
      title,
      cards: [],
    })),
  };
}

function sanitizeTaskBoardTaskTypes(raw: unknown): TaskBoardTaskType[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: TaskBoardTaskType[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const label = String((item as any).label ?? '').trim();
    const id = normalizeTaskTypeId((item as any).id ?? label);
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label,
      active: (item as any).active !== false,
    });
  }
  return out.length > 0 ? out : createDefaultTaskBoardState().taskTypes;
}

export function fallbackTaskTypeId(taskTypes: TaskBoardTaskType[]): string {
  return taskTypes.find((item) => item.active !== false)?.id ?? taskTypes[0]?.id ?? 'idea';
}

export function sanitizeTaskBoardState(raw: unknown): TaskBoardState {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const taskTypes = sanitizeTaskBoardTaskTypes(source.taskTypes);
  const fallbackType = fallbackTaskTypeId(taskTypes);
  const lanesRaw = Array.isArray(source.lanes) ? source.lanes : [];
  const lanes: TaskBoardLane[] = [];
  for (let index = 0; index < lanesRaw.length; index += 1) {
    const laneRaw = lanesRaw[index];
    if (!laneRaw || typeof laneRaw !== 'object' || Array.isArray(laneRaw)) continue;
    const lane = laneRaw as Record<string, unknown>;
    const cardsRaw = Array.isArray(lane.cards) ? lane.cards : [];
    const cards: TaskBoardCard[] = [];
    for (const cardRaw of cardsRaw) {
      if (!cardRaw || typeof cardRaw !== 'object' || Array.isArray(cardRaw)) continue;
      const card = cardRaw as Record<string, unknown>;
      const id = String(card.id ?? '').trim();
      const title = normalizeTaskTitle(card.title ?? '');
      if (!id || !title) continue;
      const createdAt = typeof card.createdAt === 'string' && card.createdAt.trim() ? card.createdAt.trim() : nowIso();
      const updatedAt = typeof card.updatedAt === 'string' && card.updatedAt.trim() ? card.updatedAt.trim() : createdAt;
      const repoPath = typeof card.repoPath === 'string' && card.repoPath.trim() ? card.repoPath.trim() : '';
      const scope = resolveTaskBoardCardScope({
        scopeType: card.scopeType as TaskBoardScopeType | undefined,
        scopeValue: typeof card.scopeValue === 'string' ? card.scopeValue : undefined,
        repoPath,
      });
      cards.push({
        id,
        title,
        description: String(card.description ?? ''),
        typeId: normalizeTaskTypeId(card.typeId) || fallbackType,
        createdAt,
        updatedAt,
        scopeType: scope.scopeType,
        ...(scope.scopeValue ? { scopeValue: scope.scopeValue } : {}),
        ...(scope.scopeType === 'repo' && scope.scopeValue ? { repoPath: scope.scopeValue } : repoPath ? { repoPath } : {}),
        ...(typeof card.droneId === 'string' && card.droneId.trim() ? { droneId: card.droneId.trim() } : {}),
        ...(typeof card.droneName === 'string' && card.droneName.trim() ? { droneName: card.droneName.trim() } : {}),
        ...(typeof card.playbookId === 'string' && card.playbookId.trim() ? { playbookId: card.playbookId.trim() } : {}),
        ...(typeof card.playbookLabel === 'string' && card.playbookLabel.trim() ? { playbookLabel: card.playbookLabel.trim() } : {}),
        ...(typeof card.chatName === 'string' && card.chatName.trim() ? { chatName: card.chatName.trim() || 'default' } : {}),
        ...(typeof card.prompt === 'string' && card.prompt ? { prompt: String(card.prompt) } : {}),
        ...(typeof card.promptId === 'string' && card.promptId.trim() ? { promptId: card.promptId.trim() } : {}),
        ...(typeof card.messageId === 'string' && card.messageId.trim() ? { messageId: card.messageId.trim() } : {}),
      });
    }
    lanes.push({
      id: String(lane.id ?? '').trim() || `lane-${index + 1}`,
      title: String(lane.title ?? '').trim() || DEFAULT_TASK_BOARD_LANES[index] || `Lane ${index + 1}`,
      cards,
    });
  }
  return lanes.length > 0 ? { taskTypes, lanes } : createDefaultTaskBoardState();
}

export function getTaskBoardStateFromRegistry(regAny: any): TaskBoardState {
  return sanitizeTaskBoardState(regAny?.settings?.kanbanBoard ?? null);
}

export function taskTypeLabel(board: TaskBoardState, typeIdRaw: unknown): string {
  const typeId = normalizeTaskTypeId(typeIdRaw);
  return board.taskTypes.find((item) => item.id === typeId)?.label ?? (typeId || 'Task');
}

export function listScopedTasksForDroneScope(board: TaskBoardState, repoPathRaw: unknown, playbookIdRaw?: unknown): TaskBoardScopedTask[] {
  const repoPath = String(repoPathRaw ?? '').trim();
  const playbookId = String(playbookIdRaw ?? '').trim();
  const out: TaskBoardScopedTask[] = [];
  for (const lane of board.lanes) {
    for (const card of lane.cards) {
      const scope = resolveTaskBoardCardScope(card);
      if (repoPath) {
        if (scope.scopeType !== 'repo' || scope.scopeValue !== repoPath) continue;
      } else if (scope.scopeType !== 'global') {
        continue;
      }
      if (playbookId && String(card.playbookId ?? '').trim() !== playbookId) continue;
      out.push({
        ...card,
        typeLabel: taskTypeLabel(board, card.typeId),
        laneId: lane.id,
        laneTitle: lane.title,
      });
    }
  }
  return out.sort((a, b) => {
    const aMs = Date.parse(a.updatedAt || a.createdAt);
    const bMs = Date.parse(b.updatedAt || b.createdAt);
    return (Number.isFinite(bMs) ? bMs : 0) - (Number.isFinite(aMs) ? aMs : 0);
  });
}

export function listScopedTasksForPlaybook(board: TaskBoardState, playbookIdRaw: unknown, repoPathRaw: unknown): TaskBoardScopedTask[] {
  return listScopedTasksForDroneScope(board, repoPathRaw, playbookIdRaw);
}

export function findScopedTaskById(board: TaskBoardState, taskIdRaw: unknown): TaskBoardScopedTask | null {
  const taskId = String(taskIdRaw ?? '').trim();
  if (!taskId) return null;
  for (const lane of board.lanes) {
    for (const card of lane.cards) {
      if (card.id !== taskId) continue;
      return {
        ...card,
        typeLabel: taskTypeLabel(board, card.typeId),
        laneId: lane.id,
        laneTitle: lane.title,
      };
    }
  }
  return null;
}

export function removeTasksForScope(
  board: TaskBoardState,
  scopeTypeRaw: unknown,
  scopeValueRaw?: unknown,
): { board: TaskBoardState; removedCount: number } {
  const scopeType = normalizeTaskBoardScopeType(scopeTypeRaw);
  const scopeValue = normalizeTaskBoardScopeValue(scopeType ?? 'global', scopeValueRaw);
  if (!scopeType) return { board, removedCount: 0 };
  let removedCount = 0;
  const lanes = board.lanes.map((lane) => {
    const cards = lane.cards.filter((card) => {
      const scope = resolveTaskBoardCardScope(card);
      const matches = scope.scopeType === scopeType && scope.scopeValue === scopeValue;
      if (matches) removedCount += 1;
      return !matches;
    });
    return cards.length === lane.cards.length ? lane : { ...lane, cards };
  });
  return removedCount > 0
    ? {
        board: {
          taskTypes: board.taskTypes.slice(),
          lanes,
        },
        removedCount,
      }
    : { board, removedCount: 0 };
}

export function renameTasksForScope(
  board: TaskBoardState,
  scopeTypeRaw: unknown,
  oldScopeValueRaw: unknown,
  newScopeValueRaw: unknown,
): { board: TaskBoardState; renamedCount: number } {
  const scopeType = normalizeTaskBoardScopeType(scopeTypeRaw);
  if (!scopeType || scopeType === 'global') return { board, renamedCount: 0 };
  const oldScopeValue = normalizeTaskBoardScopeValue(scopeType, oldScopeValueRaw);
  const newScopeValue = normalizeTaskBoardScopeValue(scopeType, newScopeValueRaw);
  if (!oldScopeValue || !newScopeValue || oldScopeValue === newScopeValue) return { board, renamedCount: 0 };
  let renamedCount = 0;
  const lanes = board.lanes.map((lane) => ({
    ...lane,
    cards: lane.cards.map((card) => {
      const scope = resolveTaskBoardCardScope(card);
      if (scope.scopeType !== scopeType || scope.scopeValue !== oldScopeValue) return card;
      renamedCount += 1;
      const nextCard: TaskBoardCard = {
        ...card,
        scopeType,
        scopeValue: newScopeValue,
      };
      if (scopeType === 'repo') nextCard.repoPath = newScopeValue;
      return nextCard;
    }),
  }));
  return renamedCount > 0
    ? {
        board: {
          taskTypes: board.taskTypes.slice(),
          lanes,
        },
        renamedCount,
      }
    : { board, renamedCount: 0 };
}

export function appendTaskToBoard(board: TaskBoardState, card: TaskBoardCard): TaskBoardState {
  const lanes = board.lanes.length > 0 ? board.lanes.map((lane) => ({ ...lane, cards: lane.cards.slice() })) : createDefaultTaskBoardState().lanes;
  const scope = resolveTaskBoardCardScope(card);
  const nextCard: TaskBoardCard = {
    ...card,
    scopeType: scope.scopeType,
    ...(scope.scopeValue ? { scopeValue: scope.scopeValue } : {}),
    ...(scope.scopeType === 'repo' && scope.scopeValue ? { repoPath: scope.scopeValue } : {}),
  };
  lanes[0].cards.unshift(nextCard);
  return {
    taskTypes: board.taskTypes.slice(),
    lanes,
  };
}

export function removeScopedTaskFromBoard(
  board: TaskBoardState,
  taskIdRaw: unknown,
  playbookIdRaw: unknown,
  repoPathRaw: unknown,
): { board: TaskBoardState; removed: boolean } {
  const taskId = String(taskIdRaw ?? '').trim();
  const playbookId = String(playbookIdRaw ?? '').trim();
  const repoPath = String(repoPathRaw ?? '').trim();
  if (!taskId) return { board, removed: false };
  let removed = false;
  const lanes = board.lanes.map((lane) => {
    const cards = lane.cards.filter((card) => {
      const matchesTask =
        card.id === taskId &&
        String(card.repoPath ?? '').trim() === repoPath &&
        (!playbookId || String(card.playbookId ?? '').trim() === playbookId);
      if (matchesTask) removed = true;
      return !matchesTask;
    });
    return cards.length === lane.cards.length ? lane : { ...lane, cards };
  });
  return removed
    ? {
        board: {
          taskTypes: board.taskTypes.slice(),
          lanes,
        },
        removed: true,
      }
    : { board, removed: false };
}

export function persistTaskBoardState(regAny: any, board: TaskBoardState, updatedAtRaw: string = nowIso()): void {
  regAny.settings = regAny.settings ?? {};
  regAny.settings.kanbanBoard = {
    taskTypes: board.taskTypes.map((item) => ({
      id: item.id,
      label: item.label,
      active: item.active,
    })),
    lanes: board.lanes.map((lane) => ({
      id: lane.id,
      title: lane.title,
      cards: lane.cards.map((card) => {
        const scope = resolveTaskBoardCardScope(card);
        return {
          id: card.id,
          title: card.title,
          description: card.description,
          typeId: card.typeId,
          createdAt: card.createdAt,
          updatedAt: card.updatedAt,
          scopeType: scope.scopeType,
          ...(scope.scopeValue ? { scopeValue: scope.scopeValue } : {}),
          ...(scope.scopeType === 'repo' && scope.scopeValue ? { repoPath: scope.scopeValue } : card.repoPath ? { repoPath: card.repoPath } : {}),
          ...(card.droneId ? { droneId: card.droneId } : {}),
          ...(card.droneName ? { droneName: card.droneName } : {}),
          ...(card.playbookId ? { playbookId: card.playbookId } : {}),
          ...(card.playbookLabel ? { playbookLabel: card.playbookLabel } : {}),
          ...(card.chatName ? { chatName: card.chatName } : {}),
          ...(card.prompt ? { prompt: card.prompt } : {}),
          ...(card.promptId ? { promptId: card.promptId } : {}),
          ...(card.messageId ? { messageId: card.messageId } : {}),
        };
      }),
    })),
    updatedAt: updatedAtRaw,
  };
}
