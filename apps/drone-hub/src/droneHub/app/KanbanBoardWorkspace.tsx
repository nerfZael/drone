import React from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ChatAgentConfig } from '../../domain';
import type { UiMenuSelectEntry } from '../../ui/menuSelect';
import { requestJson } from '../http';
import type { PlaybookDefinition, TaskPlaybookButton } from '../types';
import {
  cardMatchesKanbanScope,
  createKanbanCard,
  createKanbanLane,
  createKanbanTaskType,
  fallbackTaskTypeId,
  findKanbanCardLocation,
  moveKanbanCard,
  parsePastedKanbanCard,
  previewKanbanCardMove,
  resolveKanbanCardScope,
  resolveKanbanCardDropTarget,
  type KanbanBoardState,
  type KanbanCard,
  type KanbanLane,
  type KanbanTaskScopeType,
  type KanbanTaskType,
} from './kanban-board-state';
import {
  GLOBAL_KANBAN_SCOPE_LABEL,
  buildKanbanScopeTaskCounts,
  filterKanbanBoardByScope,
  kanbanBoardScopeKey,
  labelForKanbanBoardScope,
  listKanbanScopeValues,
  type KanbanBoardScopeSelection,
} from './kanban-task-scope';
import { shouldApplySuggestedKanbanTitle } from './kanban-generated-title-state';
import { fetchJson, usePoll } from './hooks';
import { IconBoard, IconPlus, IconTable, IconTrash } from './icons';
import { KanbanTableView } from './KanbanTableView';
import { KanbanTaskDetailsDialog } from './KanbanTaskDetailsDialog';
import { KanbanTaskPlaybookButtonEditor } from './KanbanTaskPlaybookButtonEditor';
import { KanbanTaskTypeEditor } from './KanbanTaskTypeEditor';
import { playbookRunsRepoLabel } from './playbook-runs-ui';
import { SpawnContextToolbar } from './SpawnContextToolbar';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';

type KanbanBoardWorkspaceProps = {
  initialRepoPath: string;
  registeredRepoPaths: string[];
  groupScopeNames: string[];
  availableScopeDrones: Array<{
    id: string;
    name: string;
    group: string | null;
    repoPath: string;
  }>;
  currentScopeGroupName: string | null;
  currentScopeDroneId: string | null;
  board: KanbanBoardState;
  taskPlaybookButtons: TaskPlaybookButton[];
  taskPlaybookButtonsLoading: boolean;
  taskPlaybookButtonsSaving: boolean;
  taskPlaybookButtonsError: string | null;
  spawnAgentMenuEntries: UiMenuSelectEntry[];
  spawnAgentConfig: ChatAgentConfig;
  createRepoMenuEntries: UiMenuSelectEntry[];
  boardLoading: boolean;
  boardSaving: boolean;
  boardError: string | null;
  boardUpdatedAt: string | null;
  onReloadBoard: () => void;
  onOpenCustomAgentModal: () => void;
  onSuggestCardTitleFromPaste: (description: string) => Promise<string | null>;
  availableDroneIds: string[];
  onOpenTaskDrone: (droneId: string) => void;
  onOpenTaskRun: (droneId: string, chatName: string) => void;
  onBoardChange: React.Dispatch<React.SetStateAction<KanbanBoardState>>;
  onTaskPlaybookButtonsChange: React.Dispatch<React.SetStateAction<TaskPlaybookButton[]>>;
  onClose: () => void;
};

type KanbanCardRef = {
  laneId: string;
  cardId: string;
};

type SortableKanbanCardProps = {
  card: KanbanCard;
  laneId: string;
  dragLocked: boolean;
  editLocked: boolean;
  selected: boolean;
  activeDragCardId: string | null;
  taskTypeLabel: string;
  onOpenCard: (laneId: string, cardId: string) => void;
  onRemoveCard: (laneId: string, cardId: string) => void;
};

type KanbanLaneCardsProps = {
  lane: KanbanLane;
  dragLocked: boolean;
  editLocked: boolean;
  selectedCardRef: KanbanCardRef | null;
  activeDragCardId: string | null;
  taskTypeLabelById: Record<string, string>;
  onOpenCard: (laneId: string, cardId: string) => void;
  onRemoveCard: (laneId: string, cardId: string) => void;
};

const LANE_ACCENTS = ['#E0C84F', '#6AABFF', '#F5A623', '#34D399', '#C084FC', '#F472B6'] as const;
const NO_REPO_FILTER_VALUE = '__kanban-no-repo__';
const KANBAN_DROP_TARGET_SWITCH_BUFFER_PX = 10;

function resolvePreviewTargetIndex(
  activeLocation: { laneId: string; index: number },
  dropTarget: { toLaneId: string; toIndex: number },
): number {
  if (activeLocation.laneId === dropTarget.toLaneId && activeLocation.index < dropTarget.toIndex) {
    return dropTarget.toIndex - 1;
  }
  return dropTarget.toIndex;
}

function resolveCommittedMoveFromPreview(
  sourceBoard: Pick<KanbanBoardState, 'lanes'>,
  previewBoard: Pick<KanbanBoardState, 'lanes'>,
  cardIdRaw: string,
): { cardId: string; fromLaneId: string; toLaneId: string; toIndex: number } | null {
  const cardId = String(cardIdRaw ?? '').trim();
  if (!cardId) return null;
  const sourceLocation = findKanbanCardLocation(sourceBoard, cardId);
  const previewLocation = findKanbanCardLocation(previewBoard, cardId);
  if (!sourceLocation || !previewLocation) return null;
  if (sourceLocation.laneId === previewLocation.laneId && sourceLocation.index === previewLocation.index) {
    return null;
  }
  return {
    cardId,
    fromLaneId: sourceLocation.laneId,
    toLaneId: previewLocation.laneId,
    toIndex:
      sourceLocation.laneId === previewLocation.laneId && sourceLocation.index < previewLocation.index
        ? previewLocation.index + 1
        : previewLocation.index,
  };
}

function isEditablePasteTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function isCardControlTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button, input, textarea, select, [contenteditable="true"]'));
}

function laneCountLabel(count: number): string {
  return `${count} lane${count === 1 ? '' : 's'}`;
}

function cardCountLabel(count: number): string {
  return `${count} task${count === 1 ? '' : 's'}`;
}

function laneAccent(index: number): string {
  return LANE_ACCENTS[index % LANE_ACCENTS.length] ?? '#9DCAFF';
}

function normalizeCardRepoPath(repoPathRaw: unknown): string {
  return String(repoPathRaw ?? '').trim();
}

function matchesRepoFilter(repoPathRaw: unknown, selectedRepoPathRaw: string): boolean {
  const repoPath = normalizeCardRepoPath(repoPathRaw);
  const selectedRepoPath = String(selectedRepoPathRaw ?? '').trim();
  if (!selectedRepoPath) return true;
  if (selectedRepoPath === NO_REPO_FILTER_VALUE) return !repoPath;
  return repoPath === selectedRepoPath;
}

function stopCardDragActivation(event: React.PointerEvent<HTMLElement>) {
  event.stopPropagation();
}

function EmptyKanbanLaneDropTarget({ laneId, controlsLocked }: { laneId: string; controlsLocked: boolean }) {
  const { isOver, setNodeRef } = useDroppable({
    id: `lane:${laneId}`,
    data: { type: 'lane', laneId },
    disabled: controlsLocked,
  });

  return (
    <div
      ref={setNodeRef}
      className={`relative overflow-hidden rounded-[14px] border px-4 py-6 text-center text-[11px] text-[var(--muted-dim)] transition-all ${
        isOver
          ? 'border-[rgba(167,139,250,.45)] bg-[rgba(167,139,250,.08)]'
          : 'border-dashed border-[rgba(255,255,255,.08)] bg-[rgba(255,255,255,.015)]'
      }`}
    >
      {isOver && (
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(167,139,250,.1),transparent_70%)]" />
      )}
      <div className="relative">
        <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(255,255,255,.04)]">
          <IconPlus className="opacity-30" />
        </div>
        <span>Drop a task here or click <strong className="text-[var(--muted)]">Add task</strong> below</span>
      </div>
    </div>
  );
}

function KanbanLaneEndDropTarget({ laneId, controlsLocked }: { laneId: string; controlsLocked: boolean }) {
  const { isOver, setNodeRef } = useDroppable({
    id: `lane-end:${laneId}`,
    data: { type: 'lane-end', laneId },
    disabled: controlsLocked,
  });

  return (
    <div
      ref={setNodeRef}
      className={`mx-2 h-5 rounded-lg transition-all ${
        isOver ? 'bg-[rgba(167,139,250,.14)]' : 'bg-transparent'
      }`}
    >
      <div className={`mx-auto mt-[9px] h-0.5 rounded-full transition-all ${isOver ? 'w-3/4 bg-[var(--accent)]' : 'w-8 bg-[rgba(255,255,255,.06)]'}`} />
    </div>
  );
}

function SortableKanbanCard({
  card,
  laneId,
  dragLocked,
  editLocked,
  selected,
  activeDragCardId,
  taskTypeLabel,
  onOpenCard,
  onRemoveCard,
}: SortableKanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: card.id,
    data: { type: 'card', laneId },
    disabled: dragLocked,
  });
  const style = React.useMemo(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition,
    }),
    [transform, transition],
  );

  const dragging = activeDragCardId === card.id;

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(dragLocked ? {} : listeners)}
      onClick={(event) => {
        if (isCardControlTarget(event.target)) return;
        onOpenCard(laneId, card.id);
      }}
      className={`dh-kanban-card group animate-card-enter px-3.5 py-2.5 ${
        selected ? 'is-selected' : ''
      } ${dragging ? 'is-dragging' : ''} ${dragLocked ? '' : 'cursor-grab touch-none active:cursor-grabbing'}`}
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div
            className={`w-full bg-transparent text-left text-[12.5px] font-medium leading-snug ${
              editLocked ? 'cursor-not-allowed text-[var(--muted)] opacity-70' : 'text-[var(--fg)]'
            }`}
          >
            {card.title || 'Untitled task'}
          </div>
          <div className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-[rgba(255,255,255,.04)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
            <span className="inline-block h-1 w-1 rounded-full bg-[var(--accent-muted)] opacity-50" />
            {taskTypeLabel}
          </div>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemoveCard(laneId, card.id);
          }}
          onPointerDown={stopCardDragActivation}
          disabled={editLocked}
          className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-all ${
            editLocked
              ? 'cursor-not-allowed text-[var(--muted-dim)] opacity-20'
              : 'text-[var(--muted-dim)] opacity-0 group-hover:opacity-100 hover:bg-[rgba(255,90,90,.12)] hover:text-[var(--red)]'
          }`}
          title={editLocked ? 'Board is loading' : 'Delete task'}
        >
          <IconTrash className="opacity-80" />
        </button>
      </div>
    </article>
  );
}

function DragOverlayKanbanCard({ card, taskTypeLabel }: { card: KanbanCard; taskTypeLabel: string }) {
  return (
    <article className="w-[272px] rounded-[14px] border border-[rgba(167,139,250,.3)] bg-[rgba(18,21,27,.95)] px-3.5 py-2.5 shadow-[0_24px_64px_rgba(0,0,0,.5),0_0_24px_rgba(167,139,250,.08)] backdrop-blur-md">
      <div className="text-[12.5px] font-medium leading-snug text-[var(--fg)]">{card.title || 'Untitled task'}</div>
      <div className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-[rgba(255,255,255,.06)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
        <span className="inline-block h-1 w-1 rounded-full bg-[var(--accent)] opacity-80" />
        {taskTypeLabel}
      </div>
    </article>
  );
}

function KanbanLaneCards({
  lane,
  dragLocked,
  editLocked,
  selectedCardRef,
  activeDragCardId,
  taskTypeLabelById,
  onOpenCard,
  onRemoveCard,
}: KanbanLaneCardsProps) {
  const cardIds = React.useMemo(() => lane.cards.map((card) => card.id), [lane.cards]);

  return (
    <div className="space-y-2 p-1">
      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        {lane.cards.length === 0 ? (
          <EmptyKanbanLaneDropTarget laneId={lane.id} controlsLocked={dragLocked} />
        ) : (
          <>
            {lane.cards.map((card) => (
              <SortableKanbanCard
                key={card.id}
                card={card}
                laneId={lane.id}
                dragLocked={dragLocked}
                editLocked={editLocked}
                selected={selectedCardRef?.laneId === lane.id && selectedCardRef?.cardId === card.id}
                activeDragCardId={activeDragCardId}
                taskTypeLabel={taskTypeLabelById[card.typeId] ?? card.typeId}
                onOpenCard={onOpenCard}
                onRemoveCard={onRemoveCard}
              />
            ))}
            <KanbanLaneEndDropTarget laneId={lane.id} controlsLocked={dragLocked} />
          </>
        )}
      </SortableContext>
    </div>
  );
}

export function KanbanBoardWorkspace({
  initialRepoPath,
  registeredRepoPaths,
  groupScopeNames,
  availableScopeDrones,
  currentScopeGroupName,
  currentScopeDroneId,
  board,
  taskPlaybookButtons,
  taskPlaybookButtonsLoading,
  taskPlaybookButtonsSaving,
  taskPlaybookButtonsError,
  spawnAgentMenuEntries,
  spawnAgentConfig,
  createRepoMenuEntries,
  boardLoading,
  boardSaving,
  boardError,
  boardUpdatedAt,
  onReloadBoard,
  onOpenCustomAgentModal,
  onSuggestCardTitleFromPaste,
  availableDroneIds,
  onOpenTaskDrone,
  onOpenTaskRun,
  onBoardChange,
  onTaskPlaybookButtonsChange,
  onClose,
}: KanbanBoardWorkspaceProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const controlsLocked = boardLoading;
  const kanbanBoardSelectionInitialized = useDroneHubUiStore((s) => s.kanbanBoardSelectionInitialized);
  const setKanbanBoardSelectionInitialized = useDroneHubUiStore((s) => s.setKanbanBoardSelectionInitialized);
  const storedScopeType = useDroneHubUiStore((s) => s.kanbanBoardScopeType);
  const storedScopeValue = useDroneHubUiStore((s) => s.kanbanBoardScopeValue);
  const setStoredScopeType = useDroneHubUiStore((s) => s.setKanbanBoardScopeType);
  const setStoredScopeValue = useDroneHubUiStore((s) => s.setKanbanBoardScopeValue);
  const selectedRepoPath = useDroneHubUiStore((s) => s.kanbanBoardSelectedRepoPath);
  const setStoredSelectedRepoPath = useDroneHubUiStore((s) => s.setKanbanBoardSelectedRepoPath);
  const viewMode = useDroneHubUiStore((s) => s.kanbanBoardViewMode);
  const setViewMode = useDroneHubUiStore((s) => s.setKanbanBoardViewMode);
  const [selectedTypeIds, setSelectedTypeIds] = React.useState<string[]>([]);
  const [typesEditorOpen, setTypesEditorOpen] = React.useState(false);
  const [selectedCardRef, setSelectedCardRef] = React.useState<KanbanCardRef | null>(null);
  const [activeDragCardId, setActiveDragCardId] = React.useState<string | null>(null);
  const [activeDragCard, setActiveDragCard] = React.useState<KanbanCard | null>(null);
  const [dragPreviewBoard, setDragPreviewBoard] = React.useState<KanbanBoardState | null>(null);
  const dragPreviewTargetRef = React.useRef<{ overId: string; toLaneId: string; toIndex: number } | null>(null);
  const [taskButtonBusyId, setTaskButtonBusyId] = React.useState<string | null>(null);
  const [taskButtonError, setTaskButtonError] = React.useState<string | null>(null);
  const pendingGeneratedTitleByCardIdRef = React.useRef(new Map<string, string>());
  const laneCount = board.lanes.length;
  const initialRepoPathNormalized = React.useMemo(() => String(initialRepoPath ?? '').trim(), [initialRepoPath]);
  const normalizedCurrentScopeGroupName = React.useMemo(() => String(currentScopeGroupName ?? '').trim(), [currentScopeGroupName]);
  const normalizedCurrentScopeDroneId = React.useMemo(() => String(currentScopeDroneId ?? '').trim(), [currentScopeDroneId]);
  const selectedBoardScope = React.useMemo<KanbanBoardScopeSelection>(
    () => ({
      scopeType: storedScopeType,
      scopeValue: storedScopeType === 'global' ? '' : String(storedScopeValue ?? '').trim(),
    }),
    [storedScopeType, storedScopeValue],
  );
  const setSelectedBoardScope = React.useCallback(
    (next: KanbanBoardScopeSelection) => {
      setKanbanBoardSelectionInitialized(true);
      setStoredScopeType(next.scopeType);
      setStoredScopeValue(next.scopeType === 'global' ? '' : next.scopeValue);
    },
    [setKanbanBoardSelectionInitialized, setStoredScopeType, setStoredScopeValue],
  );
  const setSelectedRepoPath = React.useCallback(
    (next: string | ((current: string) => string)) => {
      setKanbanBoardSelectionInitialized(true);
      setStoredSelectedRepoPath(next);
    },
    [setKanbanBoardSelectionInitialized, setStoredSelectedRepoPath],
  );
  const activeTaskTypes = React.useMemo(
    () => board.taskTypes.filter((item) => item.active !== false),
    [board.taskTypes],
  );
  const repoFilteringEnabled = selectedBoardScope.scopeType !== 'repo';
  const selectedTypeIdSet = React.useMemo(
    () => new Set(selectedTypeIds.filter((typeId) => activeTaskTypes.some((item) => item.id === typeId))),
    [activeTaskTypes, selectedTypeIds],
  );
  const filteredSelectionActive = selectedTypeIdSet.size > 0 && selectedTypeIdSet.size < activeTaskTypes.length;
  const repoFilterActive = repoFilteringEnabled && Boolean(selectedRepoPath);
  const boardFilterActive = filteredSelectionActive || repoFilterActive;
  const dragInteractionLocked = controlsLocked || filteredSelectionActive;
  const laneStructureLocked = controlsLocked || filteredSelectionActive;
  const laneDeleteLocked = controlsLocked || filteredSelectionActive || repoFilterActive || selectedBoardScope.scopeType !== 'global';
  const addTaskLocked = controlsLocked || filteredSelectionActive;
  const droneNameById = React.useMemo(
    () => new Map(availableScopeDrones.map((drone) => [drone.id, drone.name])),
    [availableScopeDrones],
  );
  const droneRepoPathById = React.useMemo(
    () => new Map(availableScopeDrones.map((drone) => [drone.id, String(drone.repoPath ?? '').trim()])),
    [availableScopeDrones],
  );
  const taskScopeCountsByKey = React.useMemo(() => buildKanbanScopeTaskCounts(board), [board]);
  const repoScopePaths = React.useMemo(() => {
    const values = new Set<string>(registeredRepoPaths.map((item) => String(item ?? '').trim()).filter(Boolean));
    if (initialRepoPathNormalized) values.add(initialRepoPathNormalized);
    for (const value of listKanbanScopeValues(board, 'repo')) values.add(value);
    return Array.from(values.values()).sort((a, b) => a.localeCompare(b));
  }, [board, initialRepoPathNormalized, registeredRepoPaths]);
  const groupScopeOptions = React.useMemo(() => {
    const values = new Set<string>(groupScopeNames.map((item) => String(item ?? '').trim()).filter(Boolean));
    if (normalizedCurrentScopeGroupName) values.add(normalizedCurrentScopeGroupName);
    for (const value of listKanbanScopeValues(board, 'group')) values.add(value);
    return Array.from(values.values())
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({
        value,
        label: value,
        count: taskScopeCountsByKey[kanbanBoardScopeKey({ scopeType: 'group', scopeValue: value })] ?? 0,
      }));
  }, [board, groupScopeNames, normalizedCurrentScopeGroupName, taskScopeCountsByKey]);
  const droneScopeOptions = React.useMemo(() => {
    const liveById = new Map(
      availableScopeDrones.map((drone) => [
        drone.id,
        {
          value: drone.id,
          label: String(drone.name ?? '').trim() || drone.id,
          count: 0,
        },
      ]),
    );
    if (normalizedCurrentScopeDroneId && !liveById.has(normalizedCurrentScopeDroneId)) {
      liveById.set(normalizedCurrentScopeDroneId, {
        value: normalizedCurrentScopeDroneId,
        label: droneNameById.get(normalizedCurrentScopeDroneId) ?? normalizedCurrentScopeDroneId,
        count: 0,
      });
    }
    for (const lane of board.lanes) {
      for (const card of lane.cards) {
        const scope = resolveKanbanCardScope(card);
        if (scope.scopeType !== 'drone' || !scope.scopeValue) continue;
        if (!liveById.has(scope.scopeValue)) {
          liveById.set(scope.scopeValue, {
            value: scope.scopeValue,
            label: droneNameById.get(scope.scopeValue) ?? scope.scopeValue,
            count: 0,
          });
        }
      }
    }
    return Array.from(liveById.values())
      .map((item) => ({
        ...item,
        count: taskScopeCountsByKey[kanbanBoardScopeKey({ scopeType: 'drone', scopeValue: item.value })] ?? 0,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [availableScopeDrones, board.lanes, droneNameById, normalizedCurrentScopeDroneId, taskScopeCountsByKey]);
  const repoScopeOptions = React.useMemo(
    () =>
      repoScopePaths.map((value) => ({
        value,
        label: playbookRunsRepoLabel(value),
        count: taskScopeCountsByKey[kanbanBoardScopeKey({ scopeType: 'repo', scopeValue: value })] ?? 0,
      })),
    [repoScopePaths, taskScopeCountsByKey],
  );
  const scopeOptionAvailability = React.useMemo(
    () => ({
      repo: new Set(repoScopeOptions.map((item) => item.value)),
      group: new Set(groupScopeOptions.map((item) => item.value)),
      drone: new Set(droneScopeOptions.map((item) => item.value)),
    }),
    [droneScopeOptions, groupScopeOptions, repoScopeOptions],
  );
  const scopedBoard = React.useMemo(() => filterKanbanBoardByScope(board, selectedBoardScope), [board, selectedBoardScope]);
  const scopedCards = React.useMemo(() => scopedBoard.lanes.flatMap((lane) => lane.cards), [scopedBoard.lanes]);
  const cardsForSelectedRepo = React.useMemo(
    () => (repoFilteringEnabled ? scopedCards.filter((card) => matchesRepoFilter(card.repoPath, selectedRepoPath)) : scopedCards),
    [repoFilteringEnabled, scopedCards, selectedRepoPath],
  );
  const typeTaskCountById = React.useMemo(() => {
    const next: Record<string, number> = {};
    for (const card of cardsForSelectedRepo) next[card.typeId] = (next[card.typeId] ?? 0) + 1;
    return next;
  }, [cardsForSelectedRepo]);
  const cardsForSelectedTypes = React.useMemo(() => {
    if (!filteredSelectionActive) {
      return scopedCards;
    }
    return scopedCards.filter((card) => selectedTypeIdSet.has(card.typeId));
  }, [filteredSelectionActive, scopedCards, selectedTypeIdSet]);
  const repoTaskCountByPath = React.useMemo(() => {
    const next: Record<string, number> = {};
    for (const card of cardsForSelectedTypes) {
      const repoPath = normalizeCardRepoPath(card.repoPath);
      if (!repoPath) continue;
      next[repoPath] = (next[repoPath] ?? 0) + 1;
    }
    return next;
  }, [cardsForSelectedTypes]);
  const noRepoTaskCount = React.useMemo(
    () => cardsForSelectedTypes.reduce((sum, card) => sum + (normalizeCardRepoPath(card.repoPath) ? 0 : 1), 0),
    [cardsForSelectedTypes],
  );
  const availableRepoFilterPaths = React.useMemo(() => {
    const values = new Set<string>(registeredRepoPaths.map((item) => String(item ?? '').trim()).filter(Boolean));
    for (const card of scopedCards) {
      const repoPath = normalizeCardRepoPath(card.repoPath);
      if (!repoPath) continue;
      values.add(repoPath);
    }
    return Array.from(values.values()).sort((a, b) => a.localeCompare(b));
  }, [registeredRepoPaths, scopedCards]);
  const visibleBoard = React.useMemo(() => {
    if (!boardFilterActive) return scopedBoard;
    return {
      ...scopedBoard,
      lanes: scopedBoard.lanes.map((lane) => ({
        ...lane,
        cards: lane.cards.filter(
          (card) =>
            (!filteredSelectionActive || selectedTypeIdSet.has(card.typeId)) &&
            (!repoFilteringEnabled || matchesRepoFilter(card.repoPath, selectedRepoPath)),
        ),
      })),
    };
  }, [boardFilterActive, filteredSelectionActive, repoFilteringEnabled, scopedBoard, selectedRepoPath, selectedTypeIdSet]);
  const renderedBoard = dragPreviewBoard ?? visibleBoard;
  const taskTypeLabelById = React.useMemo(
    () => Object.fromEntries(board.taskTypes.map((item) => [item.id, item.label])),
    [board.taskTypes],
  );
  const availableDroneIdSet = React.useMemo(
    () => new Set(availableDroneIds.map((item) => String(item ?? '').trim()).filter(Boolean)),
    [availableDroneIds],
  );
  const { value: playbooksResp, loading: playbooksLoading } = usePoll<{ ok: true; playbooks: PlaybookDefinition[] }>(
    () => fetchJson('/api/playbooks'),
    5_000,
    [],
  );
  const playbooks = Array.isArray(playbooksResp?.playbooks) ? playbooksResp.playbooks : [];
  const cardCount = React.useMemo(
    () => visibleBoard.lanes.reduce((sum, lane) => sum + lane.cards.length, 0),
    [visibleBoard.lanes],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const selectedCardEntry = React.useMemo(() => {
    if (!selectedCardRef) return null;
    const lane = board.lanes.find((item) => item.id === selectedCardRef.laneId) ?? null;
    const card = lane?.cards.find((item) => item.id === selectedCardRef.cardId) ?? null;
    if (!lane || !card) return null;
    return { lane, card };
  }, [board.lanes, selectedCardRef]);
  const visibleTaskPlaybookButtons = React.useMemo(() => {
    const cardTypeId = String(selectedCardEntry?.card.typeId ?? '').trim();
    if (!cardTypeId) return [];
    const availablePlaybookIds = new Set(playbooks.map((playbook) => playbook.id));
    return taskPlaybookButtons.filter((button) => button.taskTypeIds.includes(cardTypeId) && availablePlaybookIds.has(button.playbookId));
  }, [playbooks, selectedCardEntry?.card.typeId, taskPlaybookButtons]);

  React.useEffect(() => {
    if (kanbanBoardSelectionInitialized) return;
    if (normalizedCurrentScopeGroupName) {
      setStoredScopeType('group');
      setStoredScopeValue(normalizedCurrentScopeGroupName);
    } else if (normalizedCurrentScopeDroneId) {
      setStoredScopeType('drone');
      setStoredScopeValue(normalizedCurrentScopeDroneId);
    } else if (initialRepoPathNormalized) {
      setStoredScopeType('repo');
      setStoredScopeValue(initialRepoPathNormalized);
    } else {
      setStoredScopeType('global');
      setStoredScopeValue('');
    }
    setKanbanBoardSelectionInitialized(true);
  }, [
    initialRepoPathNormalized,
    kanbanBoardSelectionInitialized,
    normalizedCurrentScopeDroneId,
    normalizedCurrentScopeGroupName,
    setKanbanBoardSelectionInitialized,
    setStoredScopeType,
    setStoredScopeValue,
  ]);

  React.useEffect(() => {
    if (!selectedRepoPath || selectedRepoPath === NO_REPO_FILTER_VALUE) return;
    if (!repoFilteringEnabled) {
      setSelectedRepoPath('');
      return;
    }
    if (availableRepoFilterPaths.includes(selectedRepoPath)) return;
    setSelectedRepoPath('');
  }, [availableRepoFilterPaths, repoFilteringEnabled, selectedRepoPath, setSelectedRepoPath]);

  React.useEffect(() => {
    if (selectedBoardScope.scopeType === 'global') return;
    const available =
      selectedBoardScope.scopeType === 'repo'
        ? scopeOptionAvailability.repo
        : selectedBoardScope.scopeType === 'group'
          ? scopeOptionAvailability.group
          : scopeOptionAvailability.drone;
    if (available.has(selectedBoardScope.scopeValue)) return;
    setSelectedBoardScope({ scopeType: 'global', scopeValue: '' });
  }, [scopeOptionAvailability, selectedBoardScope, setSelectedBoardScope]);

  React.useEffect(() => {
    if (selectedCardRef && !selectedCardEntry) setSelectedCardRef(null);
  }, [selectedCardEntry, selectedCardRef]);

  React.useEffect(() => {
    if (!selectedCardEntry) return;
    if (cardMatchesKanbanScope(selectedCardEntry.card, selectedBoardScope)) return;
    setSelectedCardRef(null);
  }, [selectedBoardScope, selectedCardEntry]);

  React.useEffect(() => {
    setTaskButtonBusyId(null);
    setTaskButtonError(null);
  }, [selectedCardRef?.cardId]);

  React.useEffect(() => {
    setSelectedTypeIds((prev) => prev.filter((typeId) => activeTaskTypes.some((item) => item.id === typeId)));
  }, [activeTaskTypes]);

  const defaultCreateTypeId = React.useMemo(() => {
    if (selectedTypeIdSet.size === 1) return [...selectedTypeIdSet][0] ?? fallbackTaskTypeId(board.taskTypes);
    return fallbackTaskTypeId(board.taskTypes);
  }, [board.taskTypes, selectedTypeIdSet]);
  const boardScopeCardCount = scopedCards.length;
  const selectedBoardScopeLabel = React.useMemo(
    () => labelForKanbanBoardScope(selectedBoardScope, { repoLabel: playbookRunsRepoLabel, droneNameById }),
    [droneNameById, selectedBoardScope],
  );
  const selectedBoardScopeOptions = React.useMemo(
    () =>
      selectedBoardScope.scopeType === 'repo'
        ? repoScopeOptions
        : selectedBoardScope.scopeType === 'group'
          ? groupScopeOptions
          : selectedBoardScope.scopeType === 'drone'
            ? droneScopeOptions
            : [],
    [droneScopeOptions, groupScopeOptions, repoScopeOptions, selectedBoardScope.scopeType],
  );

  const openCard = React.useCallback((laneIdRaw: string, cardIdRaw: string) => {
    const laneId = String(laneIdRaw ?? '').trim();
    const cardId = String(cardIdRaw ?? '').trim();
    if (!laneId || !cardId) return;
    setSelectedCardRef({ laneId, cardId });
  }, []);

  const selectBoardScopeType = React.useCallback(
    (scopeType: KanbanTaskScopeType) => {
      if (scopeType === 'global') {
        setSelectedBoardScope({ scopeType: 'global', scopeValue: '' });
        return;
      }
      const nextValue =
        scopeType === 'repo'
          ? selectedBoardScope.scopeType === 'repo' && selectedBoardScope.scopeValue
            ? selectedBoardScope.scopeValue
            : initialRepoPathNormalized || repoScopeOptions[0]?.value || ''
          : scopeType === 'group'
            ? selectedBoardScope.scopeType === 'group' && selectedBoardScope.scopeValue
              ? selectedBoardScope.scopeValue
              : normalizedCurrentScopeGroupName || groupScopeOptions[0]?.value || ''
            : selectedBoardScope.scopeType === 'drone' && selectedBoardScope.scopeValue
              ? selectedBoardScope.scopeValue
              : normalizedCurrentScopeDroneId || droneScopeOptions[0]?.value || '';
      if (!nextValue) return;
      setSelectedBoardScope({ scopeType, scopeValue: nextValue });
    },
    [
      droneScopeOptions,
      groupScopeOptions,
      initialRepoPathNormalized,
      normalizedCurrentScopeDroneId,
      normalizedCurrentScopeGroupName,
      repoScopeOptions,
      selectedBoardScope,
      setSelectedBoardScope,
    ],
  );

  const addLane = React.useCallback(() => {
    onBoardChange((prev) => ({
      ...prev,
      lanes: [...prev.lanes, createKanbanLane({ title: `Lane ${prev.lanes.length + 1}` }, fallbackTaskTypeId(prev.taskTypes))],
    }));
  }, [onBoardChange]);

  const updateLaneTitle = React.useCallback(
    (laneIdRaw: string, nextTitle: string) => {
      const laneId = String(laneIdRaw ?? '').trim();
      if (!laneId) return;
      onBoardChange((prev) => ({
        ...prev,
        lanes: prev.lanes.map((lane) => (lane.id === laneId ? { ...lane, title: nextTitle } : lane)),
      }));
    },
    [onBoardChange],
  );

  const removeLane = React.useCallback(
    (laneIdRaw: string) => {
      const laneId = String(laneIdRaw ?? '').trim();
      if (!laneId) return;
      const lane = board.lanes.find((item) => item.id === laneId) ?? null;
      if (!lane || board.lanes.length <= 1) return;
      if (lane.cards.length > 0) {
        const confirmed = window.confirm(
          `Delete lane "${lane.title || 'Untitled lane'}" and its ${cardCountLabel(lane.cards.length)}?`,
        );
        if (!confirmed) return;
      }
      onBoardChange((prev) => ({
        ...prev,
        lanes: prev.lanes.filter((item) => item.id !== laneId),
      }));
      setSelectedCardRef((prev) => (prev?.laneId === laneId ? null : prev));
    },
    [board.lanes, onBoardChange],
  );

  const addCard = React.useCallback(
    (
      laneIdRaw: string,
      seed?: Partial<
        Pick<ReturnType<typeof createKanbanCard>, 'title' | 'description' | 'typeId' | 'repoPath' | 'scopeType' | 'scopeValue'>
      >,
    ): ReturnType<typeof createKanbanCard> | null => {
      const laneId = String(laneIdRaw ?? '').trim();
      if (!laneId) return null;
      const timestamp = new Date().toISOString();
      let defaultRepoPath = normalizeCardRepoPath(seed?.repoPath);
      if (!defaultRepoPath) {
        if (selectedBoardScope.scopeType === 'repo') defaultRepoPath = selectedBoardScope.scopeValue;
        else if (selectedRepoPath && selectedRepoPath !== NO_REPO_FILTER_VALUE) defaultRepoPath = selectedRepoPath;
        else if (selectedBoardScope.scopeType === 'drone') defaultRepoPath = droneRepoPathById.get(selectedBoardScope.scopeValue) ?? '';
      }
      const nextCard = createKanbanCard({
        title: seed?.title ?? 'Untitled task',
        description: seed?.description ?? '',
        typeId: seed?.typeId ?? defaultCreateTypeId,
        scopeType: seed?.scopeType ?? selectedBoardScope.scopeType,
        scopeValue: seed?.scopeValue ?? selectedBoardScope.scopeValue,
        repoPath: defaultRepoPath,
        createdAt: timestamp,
        updatedAt: timestamp,
      }, defaultCreateTypeId);
      onBoardChange((prev) => ({
        ...prev,
        lanes: prev.lanes.map((lane) =>
          lane.id === laneId
            ? {
                ...lane,
                cards: [...lane.cards, nextCard],
              }
            : lane,
        ),
      }));
      setSelectedCardRef({ laneId, cardId: nextCard.id });
      return nextCard;
    },
    [defaultCreateTypeId, droneRepoPathById, onBoardChange, selectedBoardScope, selectedRepoPath],
  );

  const updateCard = React.useCallback(
    (
      laneIdRaw: string,
      cardIdRaw: string,
      patch: {
        title?: string;
        description?: string;
        typeId?: string;
        repoPath?: string | null;
        scopeType?: KanbanTaskScopeType;
        scopeValue?: string | null;
      },
    ) => {
      const laneId = String(laneIdRaw ?? '').trim();
      const cardId = String(cardIdRaw ?? '').trim();
      if (!laneId || !cardId) return;
      if (Object.prototype.hasOwnProperty.call(patch, 'title')) pendingGeneratedTitleByCardIdRef.current.delete(cardId);
      onBoardChange((prev) => ({
        ...prev,
        lanes: prev.lanes.map((lane) =>
          lane.id === laneId
            ? {
                ...lane,
                cards: lane.cards.map((card) =>
                  card.id === cardId
                    ? (() => {
                        const nextCard: KanbanCard = {
                          ...card,
                          ...(Object.prototype.hasOwnProperty.call(patch, 'title') ? { title: String(patch.title ?? '') } : {}),
                          ...(Object.prototype.hasOwnProperty.call(patch, 'description')
                            ? { description: String(patch.description ?? '') }
                            : {}),
                          ...(Object.prototype.hasOwnProperty.call(patch, 'typeId') ? { typeId: String(patch.typeId ?? '') } : {}),
                          updatedAt: new Date().toISOString(),
                        };
                        if (Object.prototype.hasOwnProperty.call(patch, 'scopeType')) {
                          nextCard.scopeType = patch.scopeType;
                        }
                        if (Object.prototype.hasOwnProperty.call(patch, 'scopeValue')) {
                          const nextScopeValue = String(patch.scopeValue ?? '').trim();
                          if (nextScopeValue) nextCard.scopeValue = nextScopeValue;
                          else delete nextCard.scopeValue;
                        }
                        if (Object.prototype.hasOwnProperty.call(patch, 'repoPath')) {
                          const nextRepoPath = normalizeCardRepoPath(patch.repoPath);
                          if (nextRepoPath) nextCard.repoPath = nextRepoPath;
                          else delete nextCard.repoPath;
                        }
                        const scope = resolveKanbanCardScope(nextCard);
                        nextCard.scopeType = scope.scopeType;
                        if (scope.scopeValue) nextCard.scopeValue = scope.scopeValue;
                        else delete nextCard.scopeValue;
                        if (scope.scopeType === 'repo' && scope.scopeValue) nextCard.repoPath = scope.scopeValue;
                        return nextCard;
                      })()
                    : card,
                ),
              }
            : lane,
        ),
      }));
    },
    [onBoardChange],
  );

  const removeCard = React.useCallback(
    (laneIdRaw: string, cardIdRaw: string) => {
      const laneId = String(laneIdRaw ?? '').trim();
      const cardId = String(cardIdRaw ?? '').trim();
      if (!laneId || !cardId) return;
      pendingGeneratedTitleByCardIdRef.current.delete(cardId);
      onBoardChange((prev) => ({
        ...prev,
        lanes: prev.lanes.map((lane) =>
          lane.id === laneId
            ? {
                ...lane,
                cards: lane.cards.filter((card) => card.id !== cardId),
              }
            : lane,
        ),
      }));
      setSelectedCardRef((prev) => (prev?.cardId === cardId ? null : prev));
      setActiveDragCardId((prev) => (prev === cardId ? null : prev));
    },
    [onBoardChange],
  );

  const handleDragStart = React.useCallback(
    (event: DragStartEvent) => {
      const cardId = String(event.active.id ?? '').trim();
      if (!cardId) {
        setActiveDragCardId(null);
        setActiveDragCard(null);
        setDragPreviewBoard(null);
        dragPreviewTargetRef.current = null;
        return;
      }
      setActiveDragCardId(cardId);
      setActiveDragCard(
        visibleBoard.lanes.flatMap((lane) => lane.cards).find((item) => item.id === cardId) ??
          board.lanes.flatMap((lane) => lane.cards).find((item) => item.id === cardId) ??
          null,
      );
      setDragPreviewBoard(null);
      dragPreviewTargetRef.current = null;
    },
    [board.lanes, visibleBoard],
  );

  const handleDragOver = React.useCallback(
    (event: DragOverEvent) => {
      if (filteredSelectionActive) return;
      const activeCardId = String(event.active.id ?? '').trim();
      const overId = String(event.over?.id ?? '').trim();
      if (!activeCardId) return;
      if (!event.over || !overId) return;
      const overType = String((event.over.data.current as { type?: string } | undefined)?.type ?? '').trim();
      const activeRectTop = event.active.rect.current.translated?.top ?? event.active.rect.current.initial?.top ?? 0;
      const activeRectHeight = event.active.rect.current.translated?.height ?? event.active.rect.current.initial?.height ?? 0;
      const overRectTop = event.over.rect.top;
      const overRectHeight = event.over.rect.height;
      const previewSourceBoard = dragPreviewBoard ?? visibleBoard;
      const dropTarget = resolveKanbanCardDropTarget(previewSourceBoard, {
        activeCardId,
        overId,
        overType,
        overLaneId: String((event.over.data.current as { laneId?: string } | undefined)?.laneId ?? '').trim(),
        activeRectTop,
        activeRectHeight,
        overRectTop,
        overRectHeight,
      });
      const activeLocation = findKanbanCardLocation(previewSourceBoard, activeCardId);
      if (!dropTarget || !activeLocation) return;
      let stabilizedTarget = dropTarget;
      const previousTarget = dragPreviewTargetRef.current;
      if (overType !== 'lane' && overType !== 'lane-end' && previousTarget?.overId === overId) {
        const activeMidpoint = activeRectTop + activeRectHeight / 2;
        const overMidpoint = overRectTop + overRectHeight / 2;
        const deadZone = Math.max(
          KANBAN_DROP_TARGET_SWITCH_BUFFER_PX,
          Math.min(18, Math.round(overRectHeight * 0.2)),
        );
        if (Math.abs(activeMidpoint - overMidpoint) <= deadZone && previousTarget.toLaneId === dropTarget.toLaneId) {
          stabilizedTarget = {
            toLaneId: previousTarget.toLaneId,
            toIndex: previousTarget.toIndex,
          };
        }
      }
      if (
        previousTarget?.overId === overId &&
        previousTarget.toLaneId === stabilizedTarget.toLaneId &&
        previousTarget.toIndex === stabilizedTarget.toIndex
      ) {
        return;
      }
      const previewTargetIndex = resolvePreviewTargetIndex(activeLocation, stabilizedTarget);
      if (activeLocation.laneId === stabilizedTarget.toLaneId && activeLocation.index === previewTargetIndex) {
        return;
      }
      dragPreviewTargetRef.current = {
        overId,
        toLaneId: stabilizedTarget.toLaneId,
        toIndex: stabilizedTarget.toIndex,
      };
      setDragPreviewBoard(
        previewKanbanCardMove(previewSourceBoard, {
          cardId: activeCardId,
          fromLaneId: activeLocation.laneId,
          toLaneId: stabilizedTarget.toLaneId,
          toIndex: stabilizedTarget.toIndex,
        }),
      );
    },
    [dragPreviewBoard, filteredSelectionActive, visibleBoard],
  );

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const previewBoardAtDrop = dragPreviewBoard;
      setActiveDragCardId(null);
      setActiveDragCard(null);
      setDragPreviewBoard(null);
      dragPreviewTargetRef.current = null;
      if (filteredSelectionActive) return;
      const activeCardId = String(event.active.id ?? '').trim();
      const overId = String(event.over?.id ?? '').trim();
      if (!activeCardId || !event.over || !overId) return;

      const previewMove = previewBoardAtDrop
        ? resolveCommittedMoveFromPreview(visibleBoard, previewBoardAtDrop, activeCardId)
        : null;
      if (previewMove) {
        onBoardChange((prev) => moveKanbanCard(prev, previewMove));
        return;
      }

      const activeLocation = findKanbanCardLocation(board, activeCardId);
      if (!activeLocation) return;

      const dropTarget = resolveKanbanCardDropTarget(board, {
        activeCardId,
        overId,
        overType: String((event.over.data.current as { type?: string } | undefined)?.type ?? '').trim(),
        overLaneId: String((event.over.data.current as { laneId?: string } | undefined)?.laneId ?? '').trim(),
        activeRectTop: event.active.rect.current.translated?.top ?? event.active.rect.current.initial?.top ?? 0,
        activeRectHeight: event.active.rect.current.translated?.height ?? event.active.rect.current.initial?.height ?? 0,
        overRectTop: event.over.rect.top,
        overRectHeight: event.over.rect.height,
      });
      if (!dropTarget) return;

      onBoardChange((prev) =>
        moveKanbanCard(prev, {
          cardId: activeCardId,
          fromLaneId: activeLocation.laneId,
          toLaneId: dropTarget.toLaneId,
          toIndex: dropTarget.toIndex,
        }),
      );
    },
    [board, dragPreviewBoard, filteredSelectionActive, onBoardChange, visibleBoard],
  );

  const handleDragCancel = React.useCallback(() => {
    setActiveDragCardId(null);
    setActiveDragCard(null);
    setDragPreviewBoard(null);
    dragPreviewTargetRef.current = null;
  }, []);

  const handlePasteCapture = React.useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      if (controlsLocked) return;
      if (isEditablePasteTarget(event.target)) return;
      const parsed = parsePastedKanbanCard(event.clipboardData?.getData('text/plain') ?? '');
      const firstLaneId = String(board.lanes[0]?.id ?? '').trim();
      if (!parsed || !firstLaneId) return;
      event.preventDefault();
      const nextCard = addCard(firstLaneId, parsed);
      if (!parsed.needsGeneratedTitle || !nextCard) return;
      const provisionalTitle = nextCard.title;
      pendingGeneratedTitleByCardIdRef.current.set(nextCard.id, provisionalTitle);
      void onSuggestCardTitleFromPaste(parsed.description)
        .then((suggestedTitle) => {
          const title = String(suggestedTitle ?? '').trim();
          if (!title) {
            pendingGeneratedTitleByCardIdRef.current.delete(nextCard.id);
            return;
          }
          const pendingProvisionalTitle = pendingGeneratedTitleByCardIdRef.current.get(nextCard.id);
          pendingGeneratedTitleByCardIdRef.current.delete(nextCard.id);
          onBoardChange((prev) => ({
            ...prev,
            lanes: prev.lanes.map((lane) =>
              lane.id === firstLaneId
                ? {
                    ...lane,
                    cards: lane.cards.map((card) =>
                      card.id === nextCard.id &&
                      shouldApplySuggestedKanbanTitle({
                        pendingProvisionalTitle,
                        provisionalTitle,
                        currentTitle: card.title,
                      })
                        ? { ...card, title }
                        : card,
                    ),
                  }
                : lane,
            ),
          }));
        })
        .catch(() => {
          pendingGeneratedTitleByCardIdRef.current.delete(nextCard.id);
        });
    },
    [addCard, board.lanes, controlsLocked, onBoardChange, onSuggestCardTitleFromPaste],
  );

  const toggleTypeFilter = React.useCallback((typeIdRaw: string) => {
    const typeId = String(typeIdRaw ?? '').trim();
    if (!typeId) return;
    setSelectedTypeIds((prev) => (prev.includes(typeId) ? prev.filter((item) => item !== typeId) : [...prev, typeId]));
  }, []);

  const clearTypeFilters = React.useCallback(() => {
    setSelectedTypeIds([]);
  }, []);

  const addTaskType = React.useCallback(() => {
    onBoardChange((prev) => ({
      ...prev,
      taskTypes: [...prev.taskTypes, createKanbanTaskType({ label: `Type ${prev.taskTypes.length + 1}` })],
    }));
    setTypesEditorOpen(true);
  }, [onBoardChange]);

  const updateTaskType = React.useCallback((taskTypeIdRaw: string, patch: Partial<KanbanTaskType>) => {
    const taskTypeId = String(taskTypeIdRaw ?? '').trim();
    if (!taskTypeId) return;
    onBoardChange((prev) => ({
      ...prev,
      taskTypes: prev.taskTypes.map((taskType) =>
        taskType.id === taskTypeId
          ? {
              ...taskType,
              ...(Object.prototype.hasOwnProperty.call(patch, 'label') ? { label: String(patch.label ?? '') } : {}),
              ...(Object.prototype.hasOwnProperty.call(patch, 'active') ? { active: patch.active !== false } : {}),
            }
          : taskType,
      ),
    }));
  }, [onBoardChange]);

  const removeTaskType = React.useCallback((taskTypeIdRaw: string) => {
    const taskTypeId = String(taskTypeIdRaw ?? '').trim();
    if (!taskTypeId) return;
    if (board.taskTypes.length <= 1) return;
    const fallbackType = fallbackTaskTypeId(board.taskTypes.filter((item) => item.id !== taskTypeId));
    onBoardChange((prev) => ({
      ...prev,
      taskTypes: prev.taskTypes.filter((item) => item.id !== taskTypeId),
      lanes: prev.lanes.map((lane) => ({
        ...lane,
        cards: lane.cards.map((card) => (card.typeId === taskTypeId ? { ...card, typeId: fallbackType, updatedAt: new Date().toISOString() } : card)),
      })),
    }));
    setSelectedTypeIds((prev) => prev.filter((item) => item !== taskTypeId));
  }, [board.taskTypes, onBoardChange]);

  const addTaskPlaybookButton = React.useCallback(() => {
    const defaultPlaybookId = String(playbooks[0]?.id ?? '').trim();
    const defaultTaskTypeId = String(board.taskTypes[0]?.id ?? '').trim();
    if (!defaultPlaybookId || !defaultTaskTypeId) return;
    onTaskPlaybookButtonsChange((prev) => [
      ...prev,
      {
        id: `task-button-${crypto.randomUUID()}`,
        label: 'Run playbook',
        playbookId: defaultPlaybookId,
        taskTypeIds: [defaultTaskTypeId],
      },
    ]);
  }, [board.taskTypes, onTaskPlaybookButtonsChange, playbooks]);

  const updateTaskPlaybookButton = React.useCallback((buttonIdRaw: string, patch: Partial<TaskPlaybookButton>) => {
    const buttonId = String(buttonIdRaw ?? '').trim();
    if (!buttonId) return;
    onTaskPlaybookButtonsChange((prev) =>
      prev.map((button) =>
        button.id === buttonId
          ? {
              ...button,
              ...(Object.prototype.hasOwnProperty.call(patch, 'label') ? { label: String(patch.label ?? '') } : {}),
              ...(Object.prototype.hasOwnProperty.call(patch, 'playbookId') ? { playbookId: String(patch.playbookId ?? '') } : {}),
              ...(Object.prototype.hasOwnProperty.call(patch, 'taskTypeIds')
                ? { taskTypeIds: Array.from(new Set((Array.isArray(patch.taskTypeIds) ? patch.taskTypeIds : []).map((item) => String(item ?? '').trim()).filter(Boolean))) }
                : {}),
            }
          : button,
      ),
    );
  }, [onTaskPlaybookButtonsChange]);

  const removeTaskPlaybookButton = React.useCallback((buttonIdRaw: string) => {
    const buttonId = String(buttonIdRaw ?? '').trim();
    if (!buttonId) return;
    onTaskPlaybookButtonsChange((prev) => prev.filter((button) => button.id !== buttonId));
  }, [onTaskPlaybookButtonsChange]);

  const runTaskPlaybookButton = React.useCallback(async (buttonIdRaw: string) => {
    const taskId = String(selectedCardEntry?.card.id ?? '').trim();
    const buttonId = String(buttonIdRaw ?? '').trim();
    if (!taskId || !buttonId) return;
    setTaskButtonBusyId(buttonId);
    setTaskButtonError(null);
    try {
      const data = await requestJson<{ ok: true; droneId: string; chatName: string }>(
        `/api/tasks/${encodeURIComponent(taskId)}/run-button/${encodeURIComponent(buttonId)}`,
        { method: 'POST' },
      );
      const droneId = String(data?.droneId ?? '').trim();
      const chatName = String(data?.chatName ?? 'default').trim() || 'default';
      if (!droneId) throw new Error('Task playbook launch did not return a drone id.');
      setSelectedCardRef(null);
      onOpenTaskRun(droneId, chatName);
    } catch (err: any) {
      setTaskButtonError(err?.message ?? String(err));
    } finally {
      setTaskButtonBusyId((current) => (current === buttonId ? null : current));
    }
  }, [onOpenTaskRun, selectedCardEntry?.card.id]);

  const handleOpenCreatorDrone = React.useCallback(() => {
    const droneId = String(selectedCardEntry?.card.droneId ?? '').trim();
    if (!droneId || !availableDroneIdSet.has(droneId)) return;
    setSelectedCardRef(null);
    onOpenTaskDrone(droneId);
  }, [availableDroneIdSet, onOpenTaskDrone, selectedCardEntry]);

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      onPasteCapture={handlePasteCapture}
      onMouseDown={(event) => {
        if (isEditablePasteTarget(event.target)) return;
        rootRef.current?.focus();
      }}
      className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden outline-none"
    >
      <div className="relative flex-shrink-0 border-b border-[var(--border-subtle)]">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(167,139,250,.04)_0%,transparent_80%)]" />
        <div className="dh-noise relative">
          <div className="px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3.5 min-w-0">
                <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(167,139,250,.1)] text-[var(--accent)] shadow-[0_0_16px_rgba(167,139,250,.08)]">
                  <IconBoard />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="text-[15px] font-semibold tracking-tight text-[var(--fg)]" style={{ fontFamily: 'var(--display)' }}>
                      Task Board
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-[rgba(255,255,255,.04)] px-2.5 py-1 text-[10px] font-medium text-[var(--muted-dim)]" style={{ fontFamily: 'var(--code)' }}>
                      {laneCount}<span className="opacity-40">L</span> {cardCount}<span className="opacity-40">T</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-[rgba(255,255,255,.08)] bg-[rgba(255,255,255,.02)] px-2.5 py-1 text-[10px] font-medium text-[var(--muted-dim)]" style={{ fontFamily: 'var(--code)' }}>
                      {selectedBoardScopeLabel}
                      <span className="opacity-40">/</span>
                      {boardScopeCardCount}
                    </span>
                  </div>
                  <div className="mt-1.5 text-[11px] text-[var(--muted)] leading-relaxed max-w-[52ch]">
                    Switch between global, repo, group, and drone-owned boards. Paste text to create tasks, drag to reorder, and filter the current board by type or repo.
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="inline-flex items-center rounded-lg border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-0.5">
                  <button
                    type="button"
                    onClick={() => setViewMode('board')}
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-all ${
                      viewMode === 'board'
                        ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                        : 'text-[var(--muted-dim)] hover:text-[var(--fg)] hover:bg-[var(--hover)]'
                    }`}
                    title="Board view"
                  >
                    <IconBoard />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('table')}
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-all ${
                      viewMode === 'table'
                        ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                        : 'text-[var(--muted-dim)] hover:text-[var(--fg)] hover:bg-[var(--hover)]'
                    }`}
                    title="Table view"
                  >
                    <IconTable />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={onReloadBoard}
                  disabled={boardLoading}
                  className={`inline-flex h-8 items-center justify-center rounded-lg border px-3 text-[10px] font-semibold uppercase tracking-wide transition-all ${
                    boardLoading
                      ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] opacity-40'
                      : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:border-[var(--border)] hover:bg-[rgba(255,255,255,.05)] hover:text-[var(--fg)]'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                  title="Reload saved board from hub storage"
                >
                  {boardLoading ? 'Loading' : 'Reload'}
                </button>
                <button
                  type="button"
                  onClick={addLane}
                  disabled={laneStructureLocked}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[10px] font-semibold uppercase tracking-wide transition-all ${
                    laneStructureLocked
                      ? 'cursor-not-allowed bg-[rgba(255,255,255,.04)] text-[var(--muted-dim)] opacity-40'
                      : 'bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110 shadow-[0_0_12px_rgba(167,139,250,.15)]'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                  title="Add a new lane"
                >
                  <IconPlus className="opacity-80" />
                  Lane
                </button>
                <button
                  type="button"
                  onClick={() => setTypesEditorOpen((prev) => !prev)}
                  className={`inline-flex h-8 items-center justify-center rounded-lg border px-3 text-[10px] font-semibold uppercase tracking-wide transition-all ${
                    typesEditorOpen
                      ? 'border-[var(--accent-muted)] bg-[rgba(167,139,250,.08)] text-[var(--accent)]'
                      : 'border-transparent bg-transparent text-[var(--muted-dim)] hover:bg-[rgba(255,255,255,.04)] hover:text-[var(--fg)]'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                >
                  Types
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-8 items-center justify-center rounded-lg px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-dim)] transition-all hover:bg-[rgba(255,255,255,.04)] hover:text-[var(--fg)]"
                  style={{ fontFamily: 'var(--display)' }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 px-6 pb-4">
            <SpawnContextToolbar
              agentMenuEntries={spawnAgentMenuEntries}
              spawnAgentConfig={spawnAgentConfig}
              createRepoMenuEntries={createRepoMenuEntries}
              onOpenCustomAgentModal={onOpenCustomAgentModal}
              agentTitle="Choose default agent context for tasks on this board."
              modelTitle="Set default model context for this board."
              customButtonTitle="Manage custom agents"
              controlsLocked={controlsLocked}
              repoContainerClassName="min-w-0"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                Board
              </span>
              {([
                ['global', GLOBAL_KANBAN_SCOPE_LABEL, true],
                ['repo', 'Repo', repoScopeOptions.length > 0],
                ['group', 'Group', groupScopeOptions.length > 0],
                ['drone', 'Drone', droneScopeOptions.length > 0],
              ] as Array<[KanbanTaskScopeType, string, boolean]>).map(([scopeType, label, enabled]) => {
                const active = selectedBoardScope.scopeType === scopeType;
                return (
                  <button
                    key={scopeType}
                    type="button"
                    onClick={() => selectBoardScopeType(scopeType)}
                    disabled={!enabled}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[10px] font-semibold uppercase tracking-wide transition-all ${
                      active
                        ? 'bg-[var(--fg)] text-[var(--panel)] shadow-[0_2px_8px_rgba(0,0,0,.2)]'
                        : enabled
                          ? 'bg-[rgba(255,255,255,.04)] text-[var(--muted-dim)] hover:bg-[rgba(255,255,255,.07)] hover:text-[var(--fg)]'
                          : 'cursor-not-allowed bg-[rgba(255,255,255,.03)] text-[var(--muted-dim)] opacity-35'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                    title={!enabled ? `No ${label.toLowerCase()} boards are available yet.` : undefined}
                  >
                    {label}
                  </button>
                );
              })}
              {selectedBoardScope.scopeType !== 'global' ? (
                <select
                  value={selectedBoardScope.scopeValue}
                  onChange={(event) =>
                    setSelectedBoardScope({
                      scopeType: selectedBoardScope.scopeType,
                      scopeValue: event.target.value,
                    })
                  }
                  disabled={controlsLocked || selectedBoardScopeOptions.length === 0}
                  className="h-8 min-w-[180px] rounded-lg border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] px-3 text-[11px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)] disabled:cursor-not-allowed disabled:opacity-50"
                  title={selectedBoardScope.scopeValue || undefined}
                >
                  {selectedBoardScopeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} ({option.count})
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                Type
              </span>
              <button
                type="button"
                onClick={clearTypeFilters}
                className={`inline-flex h-8 items-center rounded-lg px-3 text-[10px] font-semibold uppercase tracking-wide transition-all ${
                  selectedTypeIdSet.size === 0
                    ? 'bg-[var(--fg)] text-[var(--panel)] shadow-[0_2px_8px_rgba(0,0,0,.2)]'
                    : 'bg-[rgba(255,255,255,.04)] text-[var(--muted-dim)] hover:bg-[rgba(255,255,255,.07)] hover:text-[var(--fg)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
              >
                All
                <span className="ml-1.5 text-[9px] opacity-60" style={{ fontFamily: 'var(--code)' }}>
                  {cardsForSelectedRepo.length}
                </span>
              </button>
              {activeTaskTypes.map((taskType) => {
                const typeSelected = selectedTypeIdSet.has(taskType.id);
                return (
                  <button
                    key={taskType.id}
                    type="button"
                    onClick={() => toggleTypeFilter(taskType.id)}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[10px] font-semibold uppercase tracking-wide transition-all ${
                      typeSelected
                        ? 'bg-[rgba(167,139,250,.16)] text-[var(--accent)] border border-[rgba(167,139,250,.2)]'
                        : 'bg-[rgba(255,255,255,.04)] text-[var(--muted-dim)] border border-transparent hover:bg-[rgba(255,255,255,.07)] hover:text-[var(--fg)]'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    {typeSelected && <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />}
                    {taskType.label}
                    <span className="text-[9px] opacity-50" style={{ fontFamily: 'var(--code)' }}>
                      {typeTaskCountById[taskType.id] ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>
            {repoFilteringEnabled ? (
              <>
                <div className="h-4 w-px bg-[var(--border-subtle)]" />
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                    Repo
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedRepoPath('')}
                    className={`inline-flex h-8 items-center rounded-lg px-3 text-[10px] font-semibold uppercase tracking-wide transition-all ${
                      selectedRepoPath === ''
                        ? 'bg-[var(--fg)] text-[var(--panel)] shadow-[0_2px_8px_rgba(0,0,0,.2)]'
                        : 'bg-[rgba(255,255,255,.04)] text-[var(--muted-dim)] hover:bg-[rgba(255,255,255,.07)] hover:text-[var(--fg)]'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    All
                    <span className="ml-1.5 text-[9px] opacity-60" style={{ fontFamily: 'var(--code)' }}>
                      {cardsForSelectedTypes.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedRepoPath((current) => (current === NO_REPO_FILTER_VALUE ? '' : NO_REPO_FILTER_VALUE))}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[10px] font-semibold uppercase tracking-wide transition-all ${
                      selectedRepoPath === NO_REPO_FILTER_VALUE
                        ? 'bg-[rgba(167,139,250,.16)] text-[var(--accent)] border border-[rgba(167,139,250,.2)]'
                        : 'bg-[rgba(255,255,255,.04)] text-[var(--muted-dim)] border border-transparent hover:bg-[rgba(255,255,255,.07)] hover:text-[var(--fg)]'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    {selectedRepoPath === NO_REPO_FILTER_VALUE && <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />}
                    No repo
                    <span className="text-[9px] opacity-50" style={{ fontFamily: 'var(--code)' }}>
                      {noRepoTaskCount}
                    </span>
                  </button>
                  {availableRepoFilterPaths.map((repoPath) => {
                    const active = selectedRepoPath === repoPath;
                    return (
                      <button
                        key={repoPath}
                        type="button"
                        onClick={() => setSelectedRepoPath((current) => (current === repoPath ? '' : repoPath))}
                        className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[10px] font-semibold uppercase tracking-wide transition-all ${
                          active
                            ? 'bg-[rgba(167,139,250,.16)] text-[var(--accent)] border border-[rgba(167,139,250,.2)]'
                            : 'bg-[rgba(255,255,255,.04)] text-[var(--muted-dim)] border border-transparent hover:bg-[rgba(255,255,255,.07)] hover:text-[var(--fg)]'
                        }`}
                        style={{ fontFamily: 'var(--display)' }}
                        title={repoPath}
                      >
                        {active && <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />}
                        {playbookRunsRepoLabel(repoPath)}
                        <span className="text-[9px] opacity-50" style={{ fontFamily: 'var(--code)' }}>
                          {repoTaskCountByPath[repoPath] ?? 0}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}
            {(boardLoading || boardSaving || boardUpdatedAt || boardError || taskPlaybookButtonsSaving || taskPlaybookButtonsError) && (
              <div className="ml-auto flex items-center gap-2 text-[10px] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--code)' }}>
                {boardLoading ? (
                  <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse-dot" />Loading…</span>
                ) : boardSaving ? (
                  <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[var(--yellow)] animate-pulse-dot" />Saving…</span>
                ) : taskPlaybookButtonsSaving ? (
                  <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[var(--yellow)] animate-pulse-dot" />Saving task buttons…</span>
                ) : taskPlaybookButtonsError ? (
                  <span className="flex items-center gap-1.5 text-[var(--red)]" title={taskPlaybookButtonsError}><span className="h-1.5 w-1.5 rounded-full bg-[var(--red)]" />Task button error</span>
                ) : boardError ? (
                  <span className="flex items-center gap-1.5 text-[var(--red)]" title={boardError}><span className="h-1.5 w-1.5 rounded-full bg-[var(--red)]" />Sync error</span>
                ) : boardUpdatedAt ? (
                  <span title={boardUpdatedAt}>Saved {new Date(boardUpdatedAt).toLocaleString()}</span>
                ) : null}
              </div>
            )}
          </div>
          {typesEditorOpen ? (
            <>
              <KanbanTaskTypeEditor
                taskTypes={board.taskTypes}
                onAddTaskType={addTaskType}
                onUpdateTaskType={updateTaskType}
                onRemoveTaskType={removeTaskType}
              />
              <KanbanTaskPlaybookButtonEditor
                taskTypes={board.taskTypes}
                taskPlaybookButtons={taskPlaybookButtons}
                playbooks={playbooks}
                playbooksLoading={playbooksLoading}
                onAddTaskPlaybookButton={addTaskPlaybookButton}
                onUpdateTaskPlaybookButton={updateTaskPlaybookButton}
                onRemoveTaskPlaybookButton={removeTaskPlaybookButton}
              />
            </>
          ) : null}
          {filteredSelectionActive ? (
            <div className="mx-6 mb-4 flex items-center gap-2 rounded-lg border border-[rgba(255,178,36,.16)] bg-[rgba(255,178,36,.06)] px-3 py-2 text-[10px] text-[var(--yellow)]">
              <span className="h-1 w-1 rounded-full bg-[var(--yellow)]" />
              Drag-and-drop and lane edits are disabled while task-type filters are active.
            </div>
          ) : null}
        </div>
        <div className="dh-accent-bar" />
      </div>

      {viewMode === 'table' ? (
        <KanbanTableView
          board={visibleBoard}
          controlsLocked={controlsLocked}
          taskTypeLabelById={taskTypeLabelById}
          laneAccent={laneAccent}
          onOpenCard={openCard}
          onRemoveCard={removeCard}
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden px-6 py-6">
            <div className="flex h-full min-h-0 w-max items-start gap-5 pr-6">
              {renderedBoard.lanes.map((lane, laneIdx) => {
                const accent = laneAccent(laneIdx);
                return (
                  <section key={lane.id} className="dh-lane-column flex h-full min-h-0 w-[300px] flex-col">
                    <div className="dh-lane-accent" style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }} />
                    <div className="flex items-center justify-between gap-3 px-3.5 pt-3.5 pb-1">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-[12px] text-[var(--fg)]">
                          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: accent }} />
                          <input
                            value={lane.title}
                            onChange={(event) => updateLaneTitle(lane.id, event.target.value)}
                            disabled={laneStructureLocked}
                            placeholder={`Lane ${laneIdx + 1}`}
                            className={`min-w-0 flex-1 bg-transparent font-semibold tracking-tight focus:outline-none ${
                              laneStructureLocked ? 'cursor-not-allowed opacity-70' : ''
                            }`}
                            style={{ fontFamily: 'var(--display)' }}
                          />
                        </div>
                        <div className="mt-1 flex items-center gap-2 px-4 text-[10px] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--code)' }}>
                          <span>{lane.cards.length} task{lane.cards.length === 1 ? '' : 's'}</span>
                          {laneIdx === 0 ? (
                            <span className="rounded-md bg-[rgba(167,139,250,.1)] px-1.5 py-0.5 text-[9px] text-[var(--accent)]" style={{ fontFamily: 'var(--display)' }}>
                              Paste target
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLane(lane.id)}
                        disabled={laneDeleteLocked || board.lanes.length <= 1}
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-lg transition-all ${
                          laneDeleteLocked || board.lanes.length <= 1
                            ? 'cursor-not-allowed text-[var(--muted-dim)] opacity-20'
                            : 'text-[var(--muted-dim)] hover:bg-[rgba(255,90,90,.1)] hover:text-[var(--red)]'
                        }`}
                        title={
                          filteredSelectionActive
                            ? 'Clear task-type filters to delete lanes'
                            : repoFilterActive
                              ? 'Clear the repo filter to delete lanes'
                              : selectedBoardScope.scopeType !== 'global'
                                ? 'Switch to the global board to delete lanes'
                              : board.lanes.length <= 1
                                ? 'Keep at least one lane'
                                : 'Delete lane'
                        }
                      >
                        <IconTrash className="opacity-80" />
                      </button>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto px-2 pt-2 pb-1">
                      <KanbanLaneCards
                        lane={lane}
                        dragLocked={dragInteractionLocked}
                        editLocked={controlsLocked}
                        selectedCardRef={selectedCardRef}
                        activeDragCardId={activeDragCardId}
                        taskTypeLabelById={taskTypeLabelById}
                        onOpenCard={openCard}
                        onRemoveCard={removeCard}
                      />
                    </div>

                    <div className="px-3 pb-3 pt-1">
                      <button
                        type="button"
                        onClick={() => addCard(lane.id)}
                        disabled={addTaskLocked}
                        className={`inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed text-[10px] font-semibold uppercase tracking-wide transition-all ${
                          addTaskLocked
                            ? 'cursor-not-allowed border-[rgba(255,255,255,.06)] bg-transparent text-[var(--muted-dim)] opacity-40'
                            : 'border-[rgba(255,255,255,.1)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:border-[var(--accent-muted)] hover:bg-[rgba(167,139,250,.06)] hover:text-[var(--accent)]'
                        }`}
                        style={{ fontFamily: 'var(--display)' }}
                      >
                        <IconPlus className="opacity-70" />
                        Add task
                      </button>
                    </div>
                  </section>
                );
              })}

              <button
                type="button"
                onClick={addLane}
                disabled={laneStructureLocked}
                className={`inline-flex h-full min-h-[200px] w-[80px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed transition-all ${
                  laneStructureLocked
                    ? 'cursor-not-allowed border-[rgba(255,255,255,.06)] text-[var(--muted-dim)] opacity-30'
                    : 'border-[rgba(255,255,255,.08)] text-[var(--muted-dim)] hover:border-[var(--accent-muted)] hover:bg-[rgba(167,139,250,.04)] hover:text-[var(--accent)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
              >
                <IconPlus className="opacity-60" />
                <span className="text-[9px] font-semibold uppercase tracking-widest">Lane</span>
              </button>
            </div>
          </div>
          <DragOverlay>
            {activeDragCard ? <DragOverlayKanbanCard card={activeDragCard} taskTypeLabel={taskTypeLabelById[activeDragCard.typeId] ?? activeDragCard.typeId} /> : null}
          </DragOverlay>
        </DndContext>
      )}
      <KanbanTaskDetailsDialog
        card={selectedCardEntry?.card ?? null}
        laneTitle={selectedCardEntry?.lane.title ?? null}
        registeredRepoPaths={registeredRepoPaths}
        groupScopeNames={groupScopeNames}
        scopeDrones={availableScopeDrones}
        taskTypes={board.taskTypes}
        taskPlaybookButtons={visibleTaskPlaybookButtons}
        controlsLocked={controlsLocked}
        creatorDroneAvailable={Boolean(
          selectedCardEntry?.card.droneId && availableDroneIdSet.has(String(selectedCardEntry.card.droneId)),
        )}
        taskButtonBusyId={taskButtonBusyId}
        taskButtonError={taskButtonError}
        onClose={() => setSelectedCardRef(null)}
        onTitleDraftChange={() => {
          const cardId = String(selectedCardEntry?.card.id ?? '').trim();
          if (!cardId) return;
          pendingGeneratedTitleByCardIdRef.current.delete(cardId);
        }}
        onUpdate={(patch) => {
          if (!selectedCardEntry) return;
          updateCard(selectedCardEntry.lane.id, selectedCardEntry.card.id, patch);
        }}
        onDelete={() => {
          if (!selectedCardEntry) return;
          removeCard(selectedCardEntry.lane.id, selectedCardEntry.card.id);
        }}
        onOpenCreatorDrone={handleOpenCreatorDrone}
        onRunTaskPlaybookButton={(buttonId) => {
          void runTaskPlaybookButton(buttonId);
        }}
      />
    </div>
  );
}
