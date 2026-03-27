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
import {
  createKanbanCard,
  createKanbanLane,
  createKanbanTaskType,
  fallbackTaskTypeId,
  moveKanbanCard,
  parsePastedKanbanCard,
  type KanbanBoardState,
  type KanbanCard,
  type KanbanLane,
  type KanbanTaskType,
} from './kanban-board-state';
import { shouldApplySuggestedKanbanTitle } from './kanban-generated-title-state';
import { IconBoard, IconPlus, IconTrash } from './icons';
import { KanbanTaskDetailsDialog } from './KanbanTaskDetailsDialog';
import { KanbanTaskTypeEditor } from './KanbanTaskTypeEditor';
import { SpawnContextToolbar } from './SpawnContextToolbar';

type KanbanBoardWorkspaceProps = {
  board: KanbanBoardState;
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
  onBoardChange: React.Dispatch<React.SetStateAction<KanbanBoardState>>;
  onClose: () => void;
};

type KanbanCardRef = {
  laneId: string;
  cardId: string;
};

type KanbanCardLocation = {
  laneId: string;
  index: number;
};

type SortableKanbanCardProps = {
  card: KanbanCard;
  laneId: string;
  controlsLocked: boolean;
  selected: boolean;
  activeDragCardId: string | null;
  taskTypeLabel: string;
  onOpenCard: (laneId: string, cardId: string) => void;
  onRemoveCard: (laneId: string, cardId: string) => void;
};

type KanbanLaneCardsProps = {
  lane: KanbanLane;
  controlsLocked: boolean;
  selectedCardRef: KanbanCardRef | null;
  activeDragCardId: string | null;
  taskTypeLabelById: Record<string, string>;
  onOpenCard: (laneId: string, cardId: string) => void;
  onRemoveCard: (laneId: string, cardId: string) => void;
};

const LANE_ACCENTS = ['#E0C84F', '#6AABFF', '#F5A623', '#34D399', '#C084FC', '#F472B6'] as const;

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

function findKanbanCardLocation(board: KanbanBoardState, cardIdRaw: string): KanbanCardLocation | null {
  const cardId = String(cardIdRaw ?? '').trim();
  if (!cardId) return null;
  for (const lane of board.lanes) {
    const index = lane.cards.findIndex((card) => card.id === cardId);
    if (index >= 0) return { laneId: lane.id, index };
  }
  return null;
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
  controlsLocked,
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
    isDragging,
  } = useSortable({
    id: card.id,
    data: { type: 'card', laneId },
    disabled: controlsLocked,
  });
  const style = React.useMemo(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition,
    }),
    [transform, transition],
  );

  const dragging = isDragging || activeDragCardId === card.id;

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(controlsLocked ? {} : listeners)}
      onClick={(event) => {
        if (isCardControlTarget(event.target)) return;
        onOpenCard(laneId, card.id);
      }}
      className={`dh-kanban-card group animate-card-enter px-3.5 py-2.5 ${
        selected ? 'is-selected' : ''
      } ${dragging ? 'is-dragging' : ''} ${controlsLocked ? '' : 'cursor-grab touch-none active:cursor-grabbing'}`}
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div
            className={`w-full bg-transparent text-left text-[12.5px] font-medium leading-snug ${
              controlsLocked ? 'cursor-not-allowed text-[var(--muted)] opacity-70' : 'text-[var(--fg)]'
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
          disabled={controlsLocked}
          className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-all ${
            controlsLocked
              ? 'cursor-not-allowed text-[var(--muted-dim)] opacity-20'
              : 'text-[var(--muted-dim)] opacity-0 group-hover:opacity-100 hover:bg-[rgba(255,90,90,.12)] hover:text-[var(--red)]'
          }`}
          title={controlsLocked ? 'Board is loading' : 'Delete task'}
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
  controlsLocked,
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
          <EmptyKanbanLaneDropTarget laneId={lane.id} controlsLocked={controlsLocked} />
        ) : (
          <>
            {lane.cards.map((card) => (
              <SortableKanbanCard
                key={card.id}
                card={card}
                laneId={lane.id}
                controlsLocked={controlsLocked}
                selected={selectedCardRef?.laneId === lane.id && selectedCardRef?.cardId === card.id}
                activeDragCardId={activeDragCardId}
                taskTypeLabel={taskTypeLabelById[card.typeId] ?? card.typeId}
                onOpenCard={onOpenCard}
                onRemoveCard={onRemoveCard}
              />
            ))}
            <KanbanLaneEndDropTarget laneId={lane.id} controlsLocked={controlsLocked} />
          </>
        )}
      </SortableContext>
    </div>
  );
}

export function KanbanBoardWorkspace({
  board,
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
  onBoardChange,
  onClose,
}: KanbanBoardWorkspaceProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const controlsLocked = boardLoading;
  const [selectedTypeIds, setSelectedTypeIds] = React.useState<string[]>([]);
  const [typesEditorOpen, setTypesEditorOpen] = React.useState(false);
  const [selectedCardRef, setSelectedCardRef] = React.useState<KanbanCardRef | null>(null);
  const [activeDragCardId, setActiveDragCardId] = React.useState<string | null>(null);
  const pendingGeneratedTitleByCardIdRef = React.useRef(new Map<string, string>());
  const laneCount = board.lanes.length;
  const activeTaskTypes = React.useMemo(
    () => board.taskTypes.filter((item) => item.active !== false),
    [board.taskTypes],
  );
  const selectedTypeIdSet = React.useMemo(
    () => new Set(selectedTypeIds.filter((typeId) => activeTaskTypes.some((item) => item.id === typeId))),
    [activeTaskTypes, selectedTypeIds],
  );
  const filteredSelectionActive = selectedTypeIdSet.size > 0 && selectedTypeIdSet.size < activeTaskTypes.length;
  const boardInteractionLocked = controlsLocked || filteredSelectionActive;
  const visibleBoard = React.useMemo(() => {
    if (!filteredSelectionActive) return board;
    return {
      ...board,
      lanes: board.lanes.map((lane) => ({
        ...lane,
        cards: lane.cards.filter((card) => selectedTypeIdSet.has(card.typeId)),
      })),
    };
  }, [board, filteredSelectionActive, selectedTypeIdSet]);
  const taskTypeLabelById = React.useMemo(
    () => Object.fromEntries(board.taskTypes.map((item) => [item.id, item.label])),
    [board.taskTypes],
  );
  const availableDroneIdSet = React.useMemo(
    () => new Set(availableDroneIds.map((item) => String(item ?? '').trim()).filter(Boolean)),
    [availableDroneIds],
  );
  const cardCount = React.useMemo(
    () => visibleBoard.lanes.reduce((sum, lane) => sum + lane.cards.length, 0),
    [visibleBoard.lanes],
  );
  const activeDragCard = React.useMemo(() => {
    if (!activeDragCardId) return null;
    for (const lane of visibleBoard.lanes) {
      const card = lane.cards.find((item) => item.id === activeDragCardId) ?? null;
      if (card) return card;
    }
    return null;
  }, [activeDragCardId, visibleBoard.lanes]);
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

  React.useEffect(() => {
    if (selectedCardRef && !selectedCardEntry) setSelectedCardRef(null);
  }, [selectedCardEntry, selectedCardRef]);

  React.useEffect(() => {
    setSelectedTypeIds((prev) => prev.filter((typeId) => activeTaskTypes.some((item) => item.id === typeId)));
  }, [activeTaskTypes]);

  const defaultCreateTypeId = React.useMemo(() => {
    if (selectedTypeIdSet.size === 1) return [...selectedTypeIdSet][0] ?? fallbackTaskTypeId(board.taskTypes);
    return fallbackTaskTypeId(board.taskTypes);
  }, [board.taskTypes, selectedTypeIdSet]);

  const openCard = React.useCallback((laneIdRaw: string, cardIdRaw: string) => {
    const laneId = String(laneIdRaw ?? '').trim();
    const cardId = String(cardIdRaw ?? '').trim();
    if (!laneId || !cardId) return;
    setSelectedCardRef({ laneId, cardId });
  }, []);

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
      seed?: Partial<Pick<ReturnType<typeof createKanbanCard>, 'title' | 'description' | 'typeId'>>,
    ): ReturnType<typeof createKanbanCard> | null => {
      const laneId = String(laneIdRaw ?? '').trim();
      if (!laneId) return null;
      const timestamp = new Date().toISOString();
      const nextCard = createKanbanCard({
        title: seed?.title ?? 'Untitled task',
        description: seed?.description ?? '',
        typeId: seed?.typeId ?? defaultCreateTypeId,
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
    [defaultCreateTypeId, onBoardChange],
  );

  const updateCard = React.useCallback(
    (laneIdRaw: string, cardIdRaw: string, patch: { title?: string; description?: string; typeId?: string }) => {
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
                    ? {
                        ...card,
                        ...(Object.prototype.hasOwnProperty.call(patch, 'title') ? { title: String(patch.title ?? '') } : {}),
                        ...(Object.prototype.hasOwnProperty.call(patch, 'description')
                          ? { description: String(patch.description ?? '') }
                          : {}),
                        ...(Object.prototype.hasOwnProperty.call(patch, 'typeId') ? { typeId: String(patch.typeId ?? '') } : {}),
                        updatedAt: new Date().toISOString(),
                      }
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

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    const cardId = String(event.active.id ?? '').trim();
    setActiveDragCardId(cardId || null);
  }, []);

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      setActiveDragCardId(null);
      if (filteredSelectionActive) return;
      const activeCardId = String(event.active.id ?? '').trim();
      const overId = String(event.over?.id ?? '').trim();
      if (!activeCardId || !event.over || !overId) return;

      const activeLocation = findKanbanCardLocation(board, activeCardId);
      if (!activeLocation) return;

      const overType = String((event.over.data.current as { type?: string } | undefined)?.type ?? '').trim();
      let toLaneId = '';
      let toIndex = 0;

      if (overType === 'lane' || overType === 'lane-end') {
        toLaneId = String((event.over.data.current as { laneId?: string } | undefined)?.laneId ?? '').trim();
        if (!toLaneId) return;
        toIndex = board.lanes.find((lane) => lane.id === toLaneId)?.cards.length ?? 0;
      } else {
        const overLocation = findKanbanCardLocation(board, overId);
        if (!overLocation) return;
        toLaneId = overLocation.laneId;
        const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
        const activeMidpoint = (activeRect?.top ?? 0) + (activeRect?.height ?? 0) / 2;
        const overMidpoint = event.over.rect.top + event.over.rect.height / 2;
        const placeAfter = activeMidpoint > overMidpoint;
        toIndex = overLocation.index + (placeAfter ? 1 : 0);
      }

      onBoardChange((prev) =>
        moveKanbanCard(prev, {
          cardId: activeCardId,
          fromLaneId: activeLocation.laneId,
          toLaneId,
          toIndex,
        }),
      );
    },
    [board, filteredSelectionActive, onBoardChange],
  );

  const handleDragCancel = React.useCallback(() => {
    setActiveDragCardId(null);
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
                  </div>
                  <div className="mt-1.5 text-[11px] text-[var(--muted)] leading-relaxed max-w-[52ch]">
                    Organize work across lanes. Paste text to create tasks, drag to reorder, filter by type.
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
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
                  disabled={boardInteractionLocked}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[10px] font-semibold uppercase tracking-wide transition-all ${
                    boardInteractionLocked
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
                  </button>
                );
              })}
            </div>
            {(boardLoading || boardSaving || boardUpdatedAt || boardError) && (
              <div className="ml-auto flex items-center gap-2 text-[10px] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--code)' }}>
                {boardLoading ? (
                  <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse-dot" />Loading…</span>
                ) : boardSaving ? (
                  <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[var(--yellow)] animate-pulse-dot" />Saving…</span>
                ) : boardError ? (
                  <span className="flex items-center gap-1.5 text-[var(--red)]" title={boardError}><span className="h-1.5 w-1.5 rounded-full bg-[var(--red)]" />Sync error</span>
                ) : boardUpdatedAt ? (
                  <span title={boardUpdatedAt}>Saved {new Date(boardUpdatedAt).toLocaleString()}</span>
                ) : null}
              </div>
            )}
          </div>
          {typesEditorOpen ? (
            <KanbanTaskTypeEditor
              taskTypes={board.taskTypes}
              onAddTaskType={addTaskType}
              onUpdateTaskType={updateTaskType}
              onRemoveTaskType={removeTaskType}
            />
          ) : null}
          {filteredSelectionActive ? (
            <div className="mx-6 mb-4 flex items-center gap-2 rounded-lg border border-[rgba(255,178,36,.16)] bg-[rgba(255,178,36,.06)] px-3 py-2 text-[10px] text-[var(--yellow)]">
              <span className="h-1 w-1 rounded-full bg-[var(--yellow)]" />
              Drag-and-drop is disabled while task-type filters are active.
            </div>
          ) : null}
        </div>
        <div className="dh-accent-bar" />
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden px-6 py-6">
          <div className="flex h-full min-h-0 w-max items-start gap-5 pr-6">
            {visibleBoard.lanes.map((lane, laneIdx) => {
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
                          disabled={boardInteractionLocked}
                          placeholder={`Lane ${laneIdx + 1}`}
                          className={`min-w-0 flex-1 bg-transparent font-semibold tracking-tight focus:outline-none ${
                            controlsLocked ? 'cursor-not-allowed opacity-70' : ''
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
                      disabled={boardInteractionLocked || board.lanes.length <= 1}
                      className={`inline-flex h-7 w-7 items-center justify-center rounded-lg transition-all ${
                        boardInteractionLocked || board.lanes.length <= 1
                          ? 'cursor-not-allowed text-[var(--muted-dim)] opacity-20'
                          : 'text-[var(--muted-dim)] hover:bg-[rgba(255,90,90,.1)] hover:text-[var(--red)]'
                      }`}
                      title={
                        boardInteractionLocked ? 'Clear filters to edit lanes' : board.lanes.length <= 1 ? 'Keep at least one lane' : 'Delete lane'
                      }
                    >
                      <IconTrash className="opacity-80" />
                    </button>
                  </div>

                  <div className="flex-1 min-h-0 overflow-y-auto px-2 pt-2 pb-1">
                    <KanbanLaneCards
                      lane={lane}
                      controlsLocked={boardInteractionLocked}
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
                      disabled={boardInteractionLocked}
                      className={`inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed text-[10px] font-semibold uppercase tracking-wide transition-all ${
                        boardInteractionLocked
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
              disabled={boardInteractionLocked}
              className={`inline-flex h-full min-h-[200px] w-[80px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed transition-all ${
                boardInteractionLocked
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
      <KanbanTaskDetailsDialog
        card={selectedCardEntry?.card ?? null}
        laneTitle={selectedCardEntry?.lane.title ?? null}
        taskTypes={board.taskTypes}
        controlsLocked={controlsLocked}
        creatorDroneAvailable={Boolean(
          selectedCardEntry?.card.droneId && availableDroneIdSet.has(String(selectedCardEntry.card.droneId)),
        )}
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
      />
    </div>
  );
}
