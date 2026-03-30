export type KanbanTaskType = {
  id: string;
  label: string;
  active: boolean;
};

export type KanbanTaskScopeType = 'global' | 'repo' | 'group' | 'drone';

export type KanbanCard = {
  id: string;
  title: string;
  description: string;
  typeId: string;
  createdAt?: string;
  updatedAt?: string;
  scopeType?: KanbanTaskScopeType;
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

export type KanbanLane = {
  id: string;
  title: string;
  cards: KanbanCard[];
};

export type KanbanBoardState = {
  taskTypes: KanbanTaskType[];
  lanes: KanbanLane[];
};

export type MoveKanbanCardInput = {
  cardId: string;
  fromLaneId: string;
  toLaneId: string;
  toIndex: number;
};

export type ResolveKanbanCardDropTargetInput = {
  activeCardId: string;
  overId: string;
  overType?: string;
  overLaneId?: string;
  activeRectTop?: number | null;
  activeRectHeight?: number | null;
  overRectTop?: number | null;
  overRectHeight?: number | null;
};

const DEFAULT_KANBAN_LANE_TITLES = ['To do', 'In progress', 'Review', 'Done'] as const;
const DEFAULT_TASK_TYPES = [
  { id: 'bug', label: 'Bug', active: true },
  { id: 'feature', label: 'Feature', active: true },
  { id: 'idea', label: 'Idea', active: true },
] as const;
const KANBAN_TASK_SCOPE_TYPES = new Set<KanbanTaskScopeType>(['global', 'repo', 'group', 'drone']);
const PASTED_TEXT_INLINE_TITLE_MAX_CHARS = 24;

function defaultKanbanLaneTitle(index: number): string {
  return DEFAULT_KANBAN_LANE_TITLES[index] ?? `Lane ${index + 1}`;
}

function createKanbanId(prefix: 'lane' | 'card' | 'type'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeTaskTypeId(value: unknown): string {
  const cleaned = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return cleaned;
}

export function normalizeKanbanTaskScopeType(value: unknown): KanbanTaskScopeType | null {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  return KANBAN_TASK_SCOPE_TYPES.has(normalized as KanbanTaskScopeType) ? (normalized as KanbanTaskScopeType) : null;
}

function normalizeKanbanTaskScopeValue(
  scopeType: KanbanTaskScopeType,
  scopeValueRaw: unknown,
  fallbackRepoPathRaw?: unknown,
): string {
  if (scopeType === 'global') return '';
  const fallbackRepoPath = String(fallbackRepoPathRaw ?? '').trim();
  const value = String(scopeValueRaw ?? '').trim();
  if (scopeType === 'repo') return value || fallbackRepoPath;
  return value;
}

export function resolveKanbanCardScope(card: Pick<KanbanCard, 'scopeType' | 'scopeValue' | 'repoPath'>): {
  scopeType: KanbanTaskScopeType;
  scopeValue: string;
} {
  const repoPath = String(card.repoPath ?? '').trim();
  const scopeType = normalizeKanbanTaskScopeType(card.scopeType);
  if (!scopeType) {
    return repoPath ? { scopeType: 'repo', scopeValue: repoPath } : { scopeType: 'global', scopeValue: '' };
  }
  const scopeValue = normalizeKanbanTaskScopeValue(scopeType, card.scopeValue, repoPath);
  if (!scopeValue && scopeType !== 'global') {
    return repoPath ? { scopeType: 'repo', scopeValue: repoPath } : { scopeType: 'global', scopeValue: '' };
  }
  return { scopeType, scopeValue };
}

export function cardMatchesKanbanScope(
  card: Pick<KanbanCard, 'scopeType' | 'scopeValue' | 'repoPath'>,
  scope: { scopeType: KanbanTaskScopeType; scopeValue?: string },
): boolean {
  const resolvedCardScope = resolveKanbanCardScope(card);
  const resolvedTargetValue = normalizeKanbanTaskScopeValue(scope.scopeType, scope.scopeValue);
  return resolvedCardScope.scopeType === scope.scopeType && resolvedCardScope.scopeValue === resolvedTargetValue;
}

export function createDefaultKanbanTaskTypes(): KanbanTaskType[] {
  return DEFAULT_TASK_TYPES.map((item) => ({ ...item }));
}

export function fallbackTaskTypeId(taskTypes: KanbanTaskType[]): string {
  return taskTypes.find((item) => item.active !== false)?.id ?? taskTypes[0]?.id ?? 'idea';
}

export function createKanbanTaskType(seed?: Partial<KanbanTaskType>): KanbanTaskType {
  const label = String(seed?.label ?? '').trim() || 'Untitled type';
  return {
    id: normalizeTaskTypeId(seed?.id ?? label) || createKanbanId('type'),
    label,
    active: seed?.active !== false,
  };
}

export function sanitizeKanbanTaskTypes(value: unknown): KanbanTaskType[] {
  const list = Array.isArray(value) ? value : [];
  const out: KanbanTaskType[] = [];
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
  return out.length > 0 ? out : createDefaultKanbanTaskTypes();
}

export function createKanbanCard(
  seed?: Partial<
    Pick<
      KanbanCard,
      | 'title'
      | 'description'
      | 'typeId'
      | 'createdAt'
      | 'updatedAt'
      | 'scopeType'
      | 'scopeValue'
      | 'repoPath'
      | 'droneId'
      | 'droneName'
      | 'playbookId'
      | 'playbookLabel'
      | 'chatName'
      | 'prompt'
      | 'promptId'
      | 'messageId'
    >
  >,
  fallbackTypeIdRaw: string = 'idea',
): KanbanCard {
  const fallbackTypeId = normalizeTaskTypeId(fallbackTypeIdRaw) || 'idea';
  const typeId = normalizeTaskTypeId(seed?.typeId) || fallbackTypeId;
  const repoPath = typeof seed?.repoPath === 'string' && seed.repoPath.trim() ? seed.repoPath.trim() : '';
  const scope = resolveKanbanCardScope({
    scopeType: seed?.scopeType,
    scopeValue: seed?.scopeValue,
    repoPath,
  });
  return {
    id: createKanbanId('card'),
    title: String(seed?.title ?? '').trim(),
    description: String(seed?.description ?? '').trim(),
    typeId,
    ...(typeof seed?.createdAt === 'string' && seed.createdAt.trim() ? { createdAt: seed.createdAt.trim() } : {}),
    ...(typeof seed?.updatedAt === 'string' && seed.updatedAt.trim() ? { updatedAt: seed.updatedAt.trim() } : {}),
    scopeType: scope.scopeType,
    ...(scope.scopeValue ? { scopeValue: scope.scopeValue } : {}),
    ...(scope.scopeType === 'repo' && scope.scopeValue ? { repoPath: scope.scopeValue } : repoPath ? { repoPath } : {}),
    ...(typeof seed?.droneId === 'string' && seed.droneId.trim() ? { droneId: seed.droneId.trim() } : {}),
    ...(typeof seed?.droneName === 'string' && seed.droneName.trim() ? { droneName: seed.droneName.trim() } : {}),
    ...(typeof seed?.playbookId === 'string' && seed.playbookId.trim() ? { playbookId: seed.playbookId.trim() } : {}),
    ...(typeof seed?.playbookLabel === 'string' && seed.playbookLabel.trim() ? { playbookLabel: seed.playbookLabel.trim() } : {}),
    ...(typeof seed?.chatName === 'string' && seed.chatName.trim() ? { chatName: seed.chatName.trim() } : {}),
    ...(typeof seed?.prompt === 'string' && seed.prompt ? { prompt: seed.prompt } : {}),
    ...(typeof seed?.promptId === 'string' && seed.promptId.trim() ? { promptId: seed.promptId.trim() } : {}),
    ...(typeof seed?.messageId === 'string' && seed.messageId.trim() ? { messageId: seed.messageId.trim() } : {}),
  };
}

export function createKanbanLane(
  seed?: Partial<Pick<KanbanLane, 'title' | 'cards'>>,
  fallbackTypeIdRaw: string = 'idea',
): KanbanLane {
  const cards = Array.isArray(seed?.cards) ? seed.cards : [];
  return {
    id: createKanbanId('lane'),
    title: String(seed?.title ?? '').trim() || defaultKanbanLaneTitle(0),
    cards: cards.map((card) => createKanbanCard(card, fallbackTypeIdRaw)),
  };
}

export function createDefaultKanbanBoardState(): KanbanBoardState {
  const taskTypes = createDefaultKanbanTaskTypes();
  const fallbackTypeId = fallbackTaskTypeId(taskTypes);
  return {
    taskTypes,
    lanes: DEFAULT_KANBAN_LANE_TITLES.map((title) => createKanbanLane({ title }, fallbackTypeId)),
  };
}

export function sanitizeKanbanBoardState(value: unknown): KanbanBoardState {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const taskTypes = sanitizeKanbanTaskTypes(raw.taskTypes);
  const fallbackTypeId = fallbackTaskTypeId(taskTypes);
  const lanesRaw = Array.isArray(raw.lanes) ? raw.lanes : [];
  const lanes: KanbanLane[] = [];
  for (let i = 0; i < lanesRaw.length; i += 1) {
    const laneRaw = lanesRaw[i];
    if (!laneRaw || typeof laneRaw !== 'object' || Array.isArray(laneRaw)) continue;
      const laneRecord = laneRaw as Record<string, unknown>;
      const title = String(laneRecord.title ?? '').trim() || defaultKanbanLaneTitle(i);
      const cardsRaw = Array.isArray(laneRecord.cards) ? laneRecord.cards : [];
      const cards: KanbanCard[] = [];
      for (const cardRaw of cardsRaw) {
        if (!cardRaw || typeof cardRaw !== 'object' || Array.isArray(cardRaw)) continue;
        const cardRecord = cardRaw as Record<string, unknown>;
        const repoPath = typeof cardRecord.repoPath === 'string' && cardRecord.repoPath.trim() ? cardRecord.repoPath.trim() : '';
        const scope = resolveKanbanCardScope({
          scopeType: cardRecord.scopeType as KanbanTaskScopeType | undefined,
          scopeValue: typeof cardRecord.scopeValue === 'string' ? cardRecord.scopeValue : undefined,
          repoPath,
        });
        cards.push({
          id: String(cardRecord.id ?? '').trim() || createKanbanId('card'),
          title: String(cardRecord.title ?? '').trim(),
          description: String(cardRecord.description ?? '').trim(),
          typeId: normalizeTaskTypeId(cardRecord.typeId) || fallbackTypeId,
          ...(typeof cardRecord.createdAt === 'string' && cardRecord.createdAt.trim() ? { createdAt: cardRecord.createdAt.trim() } : {}),
          ...(typeof cardRecord.updatedAt === 'string' && cardRecord.updatedAt.trim() ? { updatedAt: cardRecord.updatedAt.trim() } : {}),
          scopeType: scope.scopeType,
          ...(scope.scopeValue ? { scopeValue: scope.scopeValue } : {}),
          ...(scope.scopeType === 'repo' && scope.scopeValue ? { repoPath: scope.scopeValue } : repoPath ? { repoPath } : {}),
          ...(typeof cardRecord.droneId === 'string' && cardRecord.droneId.trim() ? { droneId: cardRecord.droneId.trim() } : {}),
          ...(typeof cardRecord.droneName === 'string' && cardRecord.droneName.trim() ? { droneName: cardRecord.droneName.trim() } : {}),
          ...(typeof cardRecord.playbookId === 'string' && cardRecord.playbookId.trim() ? { playbookId: cardRecord.playbookId.trim() } : {}),
        ...(typeof cardRecord.playbookLabel === 'string' && cardRecord.playbookLabel.trim() ? { playbookLabel: cardRecord.playbookLabel.trim() } : {}),
        ...(typeof cardRecord.chatName === 'string' && cardRecord.chatName.trim() ? { chatName: cardRecord.chatName.trim() } : {}),
        ...(typeof cardRecord.prompt === 'string' && cardRecord.prompt ? { prompt: cardRecord.prompt } : {}),
        ...(typeof cardRecord.promptId === 'string' && cardRecord.promptId.trim() ? { promptId: cardRecord.promptId.trim() } : {}),
        ...(typeof cardRecord.messageId === 'string' && cardRecord.messageId.trim() ? { messageId: cardRecord.messageId.trim() } : {}),
      });
    }
    lanes.push({
      id: String(laneRecord.id ?? '').trim() || createKanbanId('lane'),
      title,
      cards,
    });
  }
  return lanes.length > 0 ? { taskTypes, lanes } : createDefaultKanbanBoardState();
}

function fallbackTitleFromText(textRaw: string): string {
  const [firstLine = ''] = String(textRaw ?? '').split('\n');
  const title = firstLine.trim() || String(textRaw ?? '').trim();
  if (!title) return 'Untitled task';
  return title.length > 72 ? `${title.slice(0, 69).trimEnd()}...` : title;
}

function normalizePastedText(textRaw: string): string {
  const normalized = String(textRaw ?? '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return '';
  const lines = normalized.split('\n');
  const trailingLines = lines.slice(1);
  const nonEmptyLinesForIndent = (trailingLines.some((line) => line.trim().length > 0) ? trailingLines : lines).filter(
    (line) => line.trim().length > 0,
  );
  const sharedIndent = nonEmptyLinesForIndent.reduce<number>((min, line) => {
    const match = line.match(/^\s*/);
    const indent = match ? match[0].length : 0;
    return Math.min(min, indent);
  }, Number.POSITIVE_INFINITY);
  const [firstLine = '', ...restLines] = lines;
  return [firstLine, ...restLines]
    .map((line, index) => {
      if (index === 0 || !Number.isFinite(sharedIndent) || sharedIndent <= 0) return line;
      return line.slice(Math.min(sharedIndent, line.length));
    })
    .join('\n')
    .trim();
}

export function parsePastedKanbanCard(
  textRaw: string,
): (Pick<KanbanCard, 'title' | 'description'> & { needsGeneratedTitle: boolean }) | null {
  const normalized = normalizePastedText(textRaw);
  if (!normalized) return null;
  if (normalized.length <= PASTED_TEXT_INLINE_TITLE_MAX_CHARS) {
    return {
      title: normalized,
      description: '',
      needsGeneratedTitle: false,
    };
  }
  return {
    title: fallbackTitleFromText(normalized),
    description: normalized,
    needsGeneratedTitle: true,
  };
}

export function findKanbanCardLocation(board: Pick<KanbanBoardState, 'lanes'>, cardIdRaw: string): { laneId: string; index: number } | null {
  const cardId = String(cardIdRaw ?? '').trim();
  if (!cardId) return null;
  for (const lane of board.lanes) {
    const index = lane.cards.findIndex((card) => card.id === cardId);
    if (index >= 0) return { laneId: lane.id, index };
  }
  return null;
}

export function resolveKanbanCardDropTarget(
  board: Pick<KanbanBoardState, 'lanes'>,
  input: ResolveKanbanCardDropTargetInput,
): { toLaneId: string; toIndex: number } | null {
  const activeCardId = String(input.activeCardId ?? '').trim();
  const overId = String(input.overId ?? '').trim();
  const overType = String(input.overType ?? '').trim();
  if (!activeCardId || !overId) return null;
  const activeLocation = findKanbanCardLocation(board, activeCardId);
  if (!activeLocation) return null;

  if (overType === 'lane' || overType === 'lane-end') {
    const toLaneId = String(input.overLaneId ?? '').trim();
    if (!toLaneId) return null;
    const targetLane = board.lanes.find((lane) => lane.id === toLaneId) ?? null;
    if (!targetLane) return null;
    return { toLaneId, toIndex: targetLane.cards.length };
  }

  const overLocation = findKanbanCardLocation(board, overId);
  if (!overLocation) return null;
  if (activeLocation.laneId === overLocation.laneId) {
    if (activeLocation.index < overLocation.index) {
      return {
        toLaneId: overLocation.laneId,
        toIndex: overLocation.index + 1,
      };
    }
    if (activeLocation.index > overLocation.index) {
      return {
        toLaneId: overLocation.laneId,
        toIndex: overLocation.index,
      };
    }
    return {
      toLaneId: overLocation.laneId,
      toIndex: overLocation.index,
    };
  }
  const activeMidpoint = Number(input.activeRectTop ?? 0) + Number(input.activeRectHeight ?? 0) / 2;
  const overMidpoint = Number(input.overRectTop ?? 0) + Number(input.overRectHeight ?? 0) / 2;
  const placeAfter = activeMidpoint > overMidpoint;
  return {
    toLaneId: overLocation.laneId,
    toIndex: overLocation.index + (placeAfter ? 1 : 0),
  };
}

function moveKanbanCardInternal(
  board: KanbanBoardState,
  input: MoveKanbanCardInput,
  updateTimestamp: boolean,
): KanbanBoardState {
  const cardId = String(input.cardId ?? '').trim();
  const fromLaneId = String(input.fromLaneId ?? '').trim();
  const toLaneId = String(input.toLaneId ?? '').trim();
  const toIndexRaw = Number(input.toIndex);
  if (!cardId || !fromLaneId || !toLaneId || !Number.isFinite(toIndexRaw)) return board;

  const sourceLane = board.lanes.find((lane) => lane.id === fromLaneId) ?? null;
  const targetLane = board.lanes.find((lane) => lane.id === toLaneId) ?? null;
  if (!sourceLane || !targetLane) return board;

  const sourceIndex = sourceLane.cards.findIndex((card) => card.id === cardId);
  if (sourceIndex < 0) return board;

  const card = sourceLane.cards[sourceIndex] ?? null;
  if (!card) return board;

  const movedCard = updateTimestamp
    ? {
        ...card,
        updatedAt: new Date().toISOString(),
      }
    : card;
  const sourceCards = sourceLane.cards.filter((item) => item.id !== cardId);
  const unclampedTargetIndex = fromLaneId === toLaneId && sourceIndex < toIndexRaw ? toIndexRaw - 1 : toIndexRaw;
  const targetIndex = Math.max(0, Math.min(targetLane.cards.length, unclampedTargetIndex));

  return {
    ...board,
    lanes: board.lanes.map((lane) => {
      if (lane.id === fromLaneId && lane.id === toLaneId) {
        const nextCards = sourceCards.slice();
        nextCards.splice(targetIndex, 0, movedCard);
        return { ...lane, cards: nextCards };
      }
      if (lane.id === fromLaneId) {
        return { ...lane, cards: sourceCards };
      }
      if (lane.id === toLaneId) {
        const nextCards = lane.cards.slice();
        nextCards.splice(targetIndex, 0, movedCard);
        return { ...lane, cards: nextCards };
      }
      return lane;
    }),
  };
}

export function previewKanbanCardMove(board: KanbanBoardState, input: MoveKanbanCardInput): KanbanBoardState {
  return moveKanbanCardInternal(board, input, false);
}

export function moveKanbanCard(board: KanbanBoardState, input: MoveKanbanCardInput): KanbanBoardState {
  return moveKanbanCardInternal(board, input, true);
}
