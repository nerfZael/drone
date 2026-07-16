import React from 'react';
import type { StartupSeedState } from './app-types';
import { isStartupSeedFresh } from './app-config';
import { normalizedDroneChats } from './chat-node-helpers';
import {
  resolveDroneCardSelection,
  resolveSelectedChatForDrone,
  shouldKeepPendingSelectedChat,
  type DroneSelectionClickOptions,
} from './drone-selection-helpers';
import type { DroneSummary } from '../types';

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
  homeOpen: boolean;
  playbookRunsOpen: boolean;
  draftChat: { prompt: unknown | null } | null;
  droneById: Record<string, DroneSummary>;
  dronesFilteredByRepoIdSet: Set<string>;
  visibleDronesFilteredByRepo: DroneSummary[];
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
  setPlaybookRunsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedChat: React.Dispatch<React.SetStateAction<string>>;
};

export function useDroneSelectionState({
  orderedDroneIds,
  selectedDrone,
  selectedDroneIds,
  selectedChat,
  homeOpen,
  playbookRunsOpen,
  draftChat,
  droneById,
  dronesFilteredByRepoIdSet,
  visibleDronesFilteredByRepo,
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
  setPlaybookRunsOpen,
  setSelectedChat,
}: UseDroneSelectionStateArgs) {
  const lastSelectedChatByDroneRef = React.useRef<Record<string, string>>({});
  const pendingSelectedChatUntilByDroneRef = React.useRef<Record<string, number>>({});
  const manualEmptySelectionRef = React.useRef(false);
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
    const droneId = String(selectedDrone ?? '').trim();
    const chatName = String(selectedChat ?? '').trim() || 'default';
    if (!droneId) return;
    lastSelectedChatByDroneRef.current[droneId] = chatName;
  }, [selectedChat, selectedDrone]);

  React.useEffect(() => {
    const droneId = String(selectedDrone ?? '').trim();
    const chatName = String(selectedChat ?? '').trim() || 'default';
    if (!droneId) return;
    const drone = droneById[droneId] ?? null;
    const chats = normalizedDroneChats(drone, { includeDefaultWhenEmpty: true });
    if (chatName !== 'default' && !chats.includes(chatName)) {
      pendingSelectedChatUntilByDroneRef.current[droneId] = Date.now() + PENDING_SELECTED_CHAT_GRACE_MS;
      return;
    }
    delete pendingSelectedChatUntilByDroneRef.current[droneId];
  }, [droneById, selectedChat, selectedDrone]);

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
        !playbookRunsOpen &&
        !draftChat;
      // Manual card selection should always override any temporary preferred auto-selection.
      preferredSelectedDroneRef.current = null;
      preferredSelectedDroneHoldUntilRef.current = 0;
      if (alreadySelectedSingle) {
        selectionAnchorRef.current = id;
        return;
      }
      setAppView('workspace');
      setHomeOpen(false);
      setSelectedGroupMultiChat(null);
      setPlaybookRunsOpen(false);
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
      if (next.activeDroneId) {
        setSelectedChat(resolveChatForDrone(next.activeDroneId));
        scrollChatToBottom();
      }
    },
    [
      orderedDroneIds,
      draftChat,
      homeOpen,
      playbookRunsOpen,
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
      setPlaybookRunsOpen,
    ],
  );

  const selectDroneChat = React.useCallback(
    (droneIdRaw: string, chatNameRaw: string) => {
      const droneId = String(droneIdRaw ?? '').trim();
      if (!droneId) return;
      const chatName = String(chatNameRaw ?? '').trim() || 'default';
      selectDroneCard(droneId);
      setSelectedChat(chatName);
    },
    [selectDroneCard, setSelectedChat],
  );

  React.useEffect(() => {
    const valid = new Set(visibleDronesFilteredByRepo.map((d) => d.id));
    setSelectedDroneIds((prev) => {
      const next = prev.filter((id) => valid.has(id));
      if (selectedDrone && valid.has(selectedDrone) && !next.includes(selectedDrone)) {
        next.push(selectedDrone);
      }
      if (next.length === prev.length && next.every((id, idx) => id === prev[idx])) return prev;
      return next;
    });
  }, [selectedDrone, setSelectedDroneIds, visibleDronesFilteredByRepo]);

  // Auto-select first drone (and recover from deletions).
  React.useEffect(() => {
    if (homeOpen) {
      clearSelectedDroneState();
      return;
    }
    if (playbookRunsOpen) {
      clearSelectedDroneState();
      return;
    }
    if (draftChat) {
      if (!draftChat.prompt) {
        clearSelectedDroneState();
      }
      return;
    }
    const selectedExistsInRepo = Boolean(selectedDrone && dronesFilteredByRepoIdSet.has(selectedDrone));
    if (visibleDronesFilteredByRepo.length === 0) {
      if (selectedExistsInRepo) return;
      clearSelectedDroneState();
      resetGroupDndState();
      setGroupMoveError(null);
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
  }, [
    clearSelectedDroneState,
    draftChat,
    homeOpen,
    dronesFilteredByRepoIdSet,
    visibleDronesFilteredByRepo,
    playbookRunsOpen,
    preferredSelectedDroneHoldUntilRef,
    preferredSelectedDroneRef,
    resolveChatForDrone,
    resetGroupDndState,
    selectedDrone,
    selectedDroneIds,
    setGroupMoveError,
    startupSeedByDrone,
  ]);

  // Fall back if selected chat disappears.
  React.useEffect(() => {
    if (!selectedDrone) return;
    const d = droneById[selectedDrone] ?? null;
    const chats = d?.chats ?? [];
    if (chats.length === 0) return;
    if (selectedChat && chats.includes(selectedChat)) return;
    if (
      shouldKeepPendingSelectedChat({
        selectedChat,
        availableChats: chats,
        pendingUntilMs: pendingSelectedChatUntilByDroneRef.current[selectedDrone] ?? 0,
      })
    ) {
      return;
    }
    setSelectedChat(chats.includes('default') ? 'default' : chats[0]);
  }, [droneById, selectedDrone, selectedChat, setSelectedChat]);

  return { selectDroneCard, selectDroneChat };
}
