import React from 'react';
import { isWorkflowChildDrone } from '../workflows/workflow-drone-visibility';
import type { StartupSeedState } from './app-types';
import { isStartupSeedFresh } from './app-config';
import { normalizedDroneChats } from './chat-node-helpers';
import {
  resolveDroneCardSelection,
  resolveSelectedChatForDrone,
  retainValidSelectedDroneIds,
  shouldKeepPendingSelectedChat,
  type DroneSelectionClickOptions,
} from './drone-selection-helpers';
import type { DroneSummary } from '../types';
import { beginChatLoadNavigation } from './chat-load-telemetry';

const PENDING_SELECTED_CHAT_GRACE_MS = 5_000;

function sameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

type UseDroneSelectionStateArgs = {
  orderedDroneIds: string[];
  selectedDrone: string | null;
  selectedDroneIds: string[];
  selectedChat: string;
  activeRepoPath: string;
  homeOpen: boolean;
  draftChat: { prompt: unknown | null } | null;
  droneById: Record<string, DroneSummary>;
  dronesReady: boolean;
  dronesFilteredByRepoIdSet: Set<string>;
  visibleDronesFilteredByRepo: DroneSummary[];
  retainedDroneIds: readonly string[];
  startupSeedByDrone: Record<string, StartupSeedState>;
  selectionAnchorRef: React.MutableRefObject<string | null>;
  preferredSelectedDroneRef: React.MutableRefObject<string | null>;
  preferredSelectedDroneHoldUntilRef: React.MutableRefObject<number>;
  scrollChatToBottom: () => void;
  resetGroupDndState: () => void;
  setGroupMoveError: React.Dispatch<React.SetStateAction<string | null>>;
  setAppView: React.Dispatch<React.SetStateAction<'workspace' | 'settings'>>;
  setHomeOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setDraftChat: React.Dispatch<React.SetStateAction<any>>;
  setDraftCreateOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setDraftCreateError: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedDrone: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedDroneIds: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedGroupMultiChat: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedChat: React.Dispatch<React.SetStateAction<string>>;
};

export function useDroneSelectionState({
  orderedDroneIds,
  selectedDrone,
  selectedDroneIds,
  selectedChat,
  activeRepoPath,
  homeOpen,
  draftChat,
  droneById,
  dronesReady,
  dronesFilteredByRepoIdSet,
  visibleDronesFilteredByRepo,
  retainedDroneIds,
  startupSeedByDrone,
  selectionAnchorRef,
  preferredSelectedDroneRef,
  preferredSelectedDroneHoldUntilRef,
  scrollChatToBottom,
  resetGroupDndState,
  setGroupMoveError,
  setAppView,
  setHomeOpen,
  setDraftChat,
  setDraftCreateOpen,
  setDraftCreateError,
  setSelectedDrone,
  setSelectedDroneIds,
  setSelectedGroupMultiChat,
  setSelectedChat,
}: UseDroneSelectionStateArgs) {
  const lastSelectedChatByDroneRef = React.useRef<Record<string, string>>({});
  const pendingSelectedChatByDroneRef = React.useRef<
    Record<string, { chatName: string; untilMs: number }>
  >({});
  const previousActiveRepoPathRef = React.useRef(String(activeRepoPath ?? '').trim());
  const pendingActiveRepoPathRef = React.useRef<string | null>(null);
  const normalizedActiveRepoPath = String(activeRepoPath ?? '').trim();
  const activeRepoPathChanged = previousActiveRepoPathRef.current !== normalizedActiveRepoPath;
  const activeRepoSelectionPending =
    activeRepoPathChanged || pendingActiveRepoPathRef.current === normalizedActiveRepoPath;
  const manualEmptySelectionRef = React.useRef(false);
  const explicitChatSelectionRef = React.useRef(false);
  const retainedDroneIdSet = React.useMemo(
    () =>
      new Set(
        retainedDroneIds
          .map((droneId) => String(droneId ?? '').trim())
          .filter((droneId) => droneId && Boolean(droneById[droneId])),
      ),
    [droneById, retainedDroneIds],
  );
  const clearSelectedDroneState = React.useCallback(() => {
    manualEmptySelectionRef.current = false;
    if (selectedDrone) setSelectedDrone(null);
    setSelectedDroneIds((prev) => (prev.length === 0 ? prev : []));
    selectionAnchorRef.current = null;
    preferredSelectedDroneRef.current = null;
    preferredSelectedDroneHoldUntilRef.current = 0;
  }, [
    preferredSelectedDroneHoldUntilRef,
    preferredSelectedDroneRef,
    selectedDrone,
    selectionAnchorRef,
    setSelectedDrone,
    setSelectedDroneIds,
  ]);
  const resolveChatForDrone = React.useCallback(
    (droneIdRaw: string) =>
      resolveSelectedChatForDrone({
        droneId: droneIdRaw,
        droneById,
        lastSelectedChatByDrone: lastSelectedChatByDroneRef.current,
      }),
    [droneById],
  );

  React.useEffect(() => {
    if (previousActiveRepoPathRef.current !== normalizedActiveRepoPath) {
      pendingActiveRepoPathRef.current = normalizedActiveRepoPath;
    }
    previousActiveRepoPathRef.current = normalizedActiveRepoPath;
  }, [normalizedActiveRepoPath]);

  React.useEffect(() => {
    if (!dronesReady) return;
    const droneId = String(selectedDrone ?? '').trim();
    const chatName = String(selectedChat ?? '').trim() || 'default';
    if (!droneId) return;
    lastSelectedChatByDroneRef.current[droneId] = chatName;
  }, [dronesReady, selectedChat, selectedDrone]);

  React.useEffect(() => {
    if (!dronesReady) return;
    const droneId = String(selectedDrone ?? '').trim();
    const chatName = String(selectedChat ?? '').trim() || 'default';
    if (!droneId) return;
    const drone = droneById[droneId] ?? null;
    const chats = [
      ...normalizedDroneChats(drone, { includeDefaultWhenEmpty: true }),
      ...(drone?.workflowChats ?? []),
    ];
    if (chatName !== 'default' && !chats.includes(chatName)) {
      if (pendingSelectedChatByDroneRef.current[droneId]?.chatName !== chatName) {
        pendingSelectedChatByDroneRef.current[droneId] = {
          chatName,
          untilMs: Date.now() + PENDING_SELECTED_CHAT_GRACE_MS,
        };
      }
      return;
    }
    delete pendingSelectedChatByDroneRef.current[droneId];
  }, [droneById, dronesReady, selectedChat, selectedDrone]);

  const selectDroneCard = React.useCallback(
    (droneIdRaw: string, opts?: DroneSelectionClickOptions) => {
      const id = String(droneIdRaw ?? '').trim();
      if (!id) return;
      const nextChat = resolveChatForDrone(id);
      const alreadySelectedSingle =
        !opts?.toggle &&
        !opts?.range &&
        selectedDrone === id &&
        selectedDroneIds.length === 1 &&
        selectedDroneIds[0] === id &&
        (String(selectedChat ?? '').trim() || 'default') === nextChat &&
        !homeOpen &&
        !draftChat;
      // Manual card selection should always override any temporary preferred auto-selection.
      preferredSelectedDroneRef.current = null;
      preferredSelectedDroneHoldUntilRef.current = 0;
      if (alreadySelectedSingle) {
        selectionAnchorRef.current = id;
        return;
      }
      if (!opts?.toggle && !opts?.range && !explicitChatSelectionRef.current) {
        beginChatLoadNavigation({
          target: { droneId: id, chatName: nextChat },
          source: 'drone',
        });
      }
      setAppView('workspace');
      setHomeOpen(false);
      setSelectedGroupMultiChat(null);
      setDraftChat(null);
      setDraftCreateOpen(false);
      setDraftCreateError(null);
      const next = resolveDroneCardSelection({
        droneId: id,
        selectedDrone,
        selectedDroneIds,
        orderedDroneIds,
        selectionAnchor: selectionAnchorRef.current,
        opts,
      });
      setSelectedDroneIds((prev) => (sameStringArray(prev, next.selectedDroneIds) ? prev : next.selectedDroneIds));
      setSelectedDrone(next.activeDroneId);
      selectionAnchorRef.current = next.selectionAnchor;
      manualEmptySelectionRef.current = Boolean(opts?.toggle && next.selectedDroneIds.length === 0);
      if (next.activeDroneId && next.activeDroneId !== selectedDrone) {
        setSelectedChat(resolveChatForDrone(next.activeDroneId));
        scrollChatToBottom();
      }
    },
    [
      orderedDroneIds,
      draftChat,
      homeOpen,
      preferredSelectedDroneHoldUntilRef,
      preferredSelectedDroneRef,
      resolveChatForDrone,
      scrollChatToBottom,
      selectedChat,
      selectedDrone,
      selectedDroneIds,
      selectionAnchorRef,
      setAppView,
      setHomeOpen,
      setDraftChat,
      setDraftCreateError,
      setDraftCreateOpen,
      setSelectedChat,
      setSelectedDrone,
      setSelectedDroneIds,
      setSelectedGroupMultiChat,
    ],
  );

  const selectDroneChat = React.useCallback(
    (droneIdRaw: string, chatNameRaw: string) => {
      const droneId = String(droneIdRaw ?? '').trim();
      if (!droneId) return;
      const chatName = String(chatNameRaw ?? '').trim() || 'default';
      const alreadySelected =
        selectedDrone === droneId &&
        (String(selectedChat ?? '').trim() || 'default') === chatName &&
        !homeOpen &&
        !draftChat;
      if (!alreadySelected) {
        beginChatLoadNavigation({
          target: { droneId, chatName },
          source: 'chat',
        });
      }
      explicitChatSelectionRef.current = true;
      try {
        selectDroneCard(droneId);
        setSelectedChat(chatName);
      } finally {
        explicitChatSelectionRef.current = false;
      }
    },
    [draftChat, homeOpen, selectDroneCard, selectedChat, selectedDrone, setSelectedChat],
  );

  const setDroneSelectionFromSidebarFolder = React.useCallback(
    (droneIdsRaw: readonly string[], opts?: { preserveActive?: boolean }) => {
      const droneIds = Array.from(
        new Set(droneIdsRaw.map((droneId) => String(droneId ?? '').trim()).filter(Boolean)),
      );
      const activeDroneId =
        opts?.preserveActive && selectedDrone && droneIds.includes(selectedDrone)
          ? selectedDrone
          : droneIds[0] ?? null;
      preferredSelectedDroneRef.current = null;
      preferredSelectedDroneHoldUntilRef.current = 0;
      selectionAnchorRef.current = activeDroneId;
      manualEmptySelectionRef.current = droneIds.length === 0;
      setSelectedDroneIds((prev) => (sameStringArray(prev, droneIds) ? prev : droneIds));
      setSelectedDrone(activeDroneId);
      if (activeDroneId && activeDroneId !== selectedDrone) setSelectedChat('default');
    },
    [
      preferredSelectedDroneHoldUntilRef,
      preferredSelectedDroneRef,
      selectedDrone,
      selectionAnchorRef,
      setSelectedChat,
      setSelectedDrone,
      setSelectedDroneIds,
    ],
  );

  React.useEffect(() => {
    if (!dronesReady) return;
    const valid = new Set(visibleDronesFilteredByRepo.map((d) => d.id));
    for (const droneId of retainedDroneIdSet) valid.add(droneId);
    for (const drone of Object.values(droneById)) {
      if (isWorkflowChildDrone(drone)) valid.add(drone.id);
    }
    setSelectedDroneIds((prev) => {
      // Selection actions update the active drone and the selected-id list through
      // separate store setters. Do not re-add the (possibly stale) active drone
      // here: doing so can undo a modifier-click deselection.
      const next = retainValidSelectedDroneIds(prev, valid);
      if (next.length === prev.length && next.every((id, idx) => id === prev[idx])) return prev;
      return next;
    });
  }, [droneById, dronesReady, retainedDroneIdSet, selectedDrone, setSelectedDroneIds, visibleDronesFilteredByRepo]);

  // Auto-select first drone (and recover from deletions).
  React.useEffect(() => {
    if (!dronesReady) return;
    if (homeOpen) {
      clearSelectedDroneState();
      return;
    }
    if (draftChat) {
      if (!draftChat.prompt) {
        clearSelectedDroneState();
      }
      return;
    }
    const selectedDroneRecord = selectedDrone ? droneById[selectedDrone] : null;
    const selectedDroneMatchesActiveRepo = Boolean(
      selectedDroneRecord &&
        (!normalizedActiveRepoPath ||
          String(selectedDroneRecord.repoPath ?? '').trim() === normalizedActiveRepoPath),
    );
    const selectedExistsInRepo = Boolean(
      selectedDrone &&
        (dronesFilteredByRepoIdSet.has(selectedDrone) ||
          (!activeRepoSelectionPending && retainedDroneIdSet.has(selectedDrone)) ||
          (selectedDroneMatchesActiveRepo && isWorkflowChildDrone(selectedDroneRecord))),
    );
    if (visibleDronesFilteredByRepo.length === 0) {
      if (selectedExistsInRepo) {
        pendingActiveRepoPathRef.current = null;
        return;
      }
      clearSelectedDroneState();
      resetGroupDndState();
      setGroupMoveError(null);
      pendingActiveRepoPathRef.current = null;
      return;
    }
    const preferred = preferredSelectedDroneRef.current;
    if (preferred) {
      const preferredExists = visibleDronesFilteredByRepo.some((d) => d.id === preferred);
      if (preferredExists) {
        if (selectedDrone !== preferred) {
          manualEmptySelectionRef.current = false;
          setSelectedDrone(preferred);
          setSelectedDroneIds((prev) => (prev.length === 1 && prev[0] === preferred ? prev : [preferred]));
          selectionAnchorRef.current = preferred;
          setSelectedChat(resolveChatForDrone(preferred));
          pendingActiveRepoPathRef.current = null;
          return;
        }
        preferredSelectedDroneRef.current = null;
        preferredSelectedDroneHoldUntilRef.current = 0;
      }
      const holdActive = Date.now() < preferredSelectedDroneHoldUntilRef.current;
      const seed = startupSeedByDrone[preferred] ?? null;
      if (!holdActive && !isStartupSeedFresh(seed)) {
        preferredSelectedDroneRef.current = null;
        preferredSelectedDroneHoldUntilRef.current = 0;
      } else if (!selectedExistsInRepo) {
        return;
      }
    }
    if (!selectedExistsInRepo) {
      if (manualEmptySelectionRef.current && selectedDroneIds.length === 0 && !selectedDrone) {
        return;
      }
      const first = visibleDronesFilteredByRepo[0].id;
      manualEmptySelectionRef.current = false;
      setSelectedDrone(first);
      setSelectedDroneIds((prev) => (prev.length === 1 && prev[0] === first ? prev : [first]));
      selectionAnchorRef.current = first;
      setSelectedChat(resolveChatForDrone(first));
    }
    pendingActiveRepoPathRef.current = null;
  }, [
    clearSelectedDroneState,
    activeRepoSelectionPending,
    draftChat,
    droneById,
    dronesReady,
    homeOpen,
    normalizedActiveRepoPath,
    dronesFilteredByRepoIdSet,
    visibleDronesFilteredByRepo,
    preferredSelectedDroneHoldUntilRef,
    preferredSelectedDroneRef,
    retainedDroneIdSet,
    resolveChatForDrone,
    resetGroupDndState,
    selectedDrone,
    selectedDroneIds,
    setGroupMoveError,
    startupSeedByDrone,
  ]);

  // Fall back if selected chat disappears.
  React.useEffect(() => {
    if (!dronesReady) return;
    if (!selectedDrone) return;
    const d = droneById[selectedDrone] ?? null;
    const chats = [...(d?.chats ?? []), ...(d?.workflowChats ?? [])];
    if (selectedChat && chats.includes(selectedChat)) return;
    const fallbackChat = chats.includes('default') ? 'default' : chats[0] ?? 'default';
    const pendingSelection = pendingSelectedChatByDroneRef.current[selectedDrone];
    if (
      shouldKeepPendingSelectedChat({
        selectedChat,
        availableChats: chats,
        pendingUntilMs:
          pendingSelection?.chatName === selectedChat ? pendingSelection.untilMs : 0,
      })
    ) {
      const pendingUntilMs = pendingSelection?.untilMs ?? 0;
      const timer = setTimeout(() => {
        setSelectedChat((current) =>
          current === selectedChat ? fallbackChat : current,
        );
      }, Math.max(0, pendingUntilMs - Date.now()) + 1);
      return () => clearTimeout(timer);
    }
    if (selectedChat !== fallbackChat) setSelectedChat(fallbackChat);
  }, [droneById, dronesReady, selectedDrone, selectedChat, setSelectedChat]);

  return { selectDroneCard, selectDroneChat, setDroneSelectionFromSidebarFolder };
}
