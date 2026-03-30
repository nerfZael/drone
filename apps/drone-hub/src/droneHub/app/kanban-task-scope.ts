import {
  cardMatchesKanbanScope,
  resolveKanbanCardScope,
  type KanbanBoardState,
  type KanbanTaskScopeType,
} from './kanban-board-state';

export type KanbanBoardScopeSelection = {
  scopeType: KanbanTaskScopeType;
  scopeValue: string;
};

export const GLOBAL_KANBAN_SCOPE_LABEL = 'Global';

export function kanbanBoardScopeKey(scope: KanbanBoardScopeSelection): string {
  return `${scope.scopeType}:${scope.scopeValue}`;
}

export function buildKanbanScopeTaskCounts(board: KanbanBoardState): Record<string, number> {
  const next: Record<string, number> = {};
  for (const lane of board.lanes) {
    for (const card of lane.cards) {
      const scope = resolveKanbanCardScope(card);
      const key = kanbanBoardScopeKey({ scopeType: scope.scopeType, scopeValue: scope.scopeValue });
      next[key] = (next[key] ?? 0) + 1;
    }
  }
  return next;
}

export function listKanbanScopeValues(
  board: KanbanBoardState,
  scopeType: Exclude<KanbanTaskScopeType, 'global'>,
): string[] {
  const values = new Set<string>();
  for (const lane of board.lanes) {
    for (const card of lane.cards) {
      const scope = resolveKanbanCardScope(card);
      if (scope.scopeType !== scopeType || !scope.scopeValue) continue;
      values.add(scope.scopeValue);
    }
  }
  return Array.from(values.values()).sort((a, b) => a.localeCompare(b));
}

export function filterKanbanBoardByScope(
  board: KanbanBoardState,
  scope: KanbanBoardScopeSelection,
): KanbanBoardState {
  return {
    ...board,
    lanes: board.lanes.map((lane) => ({
      ...lane,
      cards: lane.cards.filter((card) => cardMatchesKanbanScope(card, scope)),
    })),
  };
}

export function labelForKanbanBoardScope(
  scope: KanbanBoardScopeSelection,
  opts: {
    repoLabel: (repoPath: string) => string;
    droneNameById: Map<string, string>;
  },
): string {
  if (scope.scopeType === 'global') return GLOBAL_KANBAN_SCOPE_LABEL;
  if (scope.scopeType === 'repo') return opts.repoLabel(scope.scopeValue);
  if (scope.scopeType === 'group') return scope.scopeValue || 'Unnamed group';
  return opts.droneNameById.get(scope.scopeValue) ?? scope.scopeValue ?? 'Unknown drone';
}
