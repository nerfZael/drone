export type TaskBoardTaskType = {
  id: string;
  label: string;
  active: boolean;
};

export type TaskBoardCard = {
  id: string;
  title: string;
  description: string;
  typeId: string;
  createdAt: string;
  updatedAt: string;
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
      cards.push({
        id,
        title,
        description: String(card.description ?? ''),
        typeId: normalizeTaskTypeId(card.typeId) || fallbackType,
        createdAt,
        updatedAt,
        ...(typeof card.repoPath === 'string' && card.repoPath.trim() ? { repoPath: card.repoPath.trim() } : {}),
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

export function listScopedTasksForPlaybook(board: TaskBoardState, playbookIdRaw: unknown, repoPathRaw: unknown): TaskBoardScopedTask[] {
  const playbookId = String(playbookIdRaw ?? '').trim();
  const repoPath = String(repoPathRaw ?? '').trim();
  const out: TaskBoardScopedTask[] = [];
  for (const lane of board.lanes) {
    for (const card of lane.cards) {
      if (String(card.playbookId ?? '').trim() !== playbookId) continue;
      if (String(card.repoPath ?? '').trim() !== repoPath) continue;
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

export function appendTaskToBoard(board: TaskBoardState, card: TaskBoardCard): TaskBoardState {
  const lanes = board.lanes.length > 0 ? board.lanes.map((lane) => ({ ...lane, cards: lane.cards.slice() })) : createDefaultTaskBoardState().lanes;
  lanes[0].cards.unshift(card);
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
  if (!taskId || !playbookId || !repoPath) return { board, removed: false };
  let removed = false;
  const lanes = board.lanes.map((lane) => {
    const cards = lane.cards.filter((card) => {
      const matchesTask =
        card.id === taskId && String(card.playbookId ?? '').trim() === playbookId && String(card.repoPath ?? '').trim() === repoPath;
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
      cards: lane.cards.map((card) => ({
        id: card.id,
        title: card.title,
        description: card.description,
        typeId: card.typeId,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
        ...(card.repoPath ? { repoPath: card.repoPath } : {}),
        ...(card.droneId ? { droneId: card.droneId } : {}),
        ...(card.droneName ? { droneName: card.droneName } : {}),
        ...(card.playbookId ? { playbookId: card.playbookId } : {}),
        ...(card.playbookLabel ? { playbookLabel: card.playbookLabel } : {}),
        ...(card.chatName ? { chatName: card.chatName } : {}),
        ...(card.prompt ? { prompt: card.prompt } : {}),
        ...(card.promptId ? { promptId: card.promptId } : {}),
        ...(card.messageId ? { messageId: card.messageId } : {}),
      })),
    })),
    updatedAt: updatedAtRaw,
  };
}
