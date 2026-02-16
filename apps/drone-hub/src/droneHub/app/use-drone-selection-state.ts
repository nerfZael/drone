import React from 'react';
import type { StartupSeedState } from './app-types';
import { isStartupSeedFresh } from './app-config';
import type { DroneSummary } from '../types';

type UseDroneSelectionStateArgs = {
  orderedDroneIds: string[];
  selectedDrone: string | null;
  selectedDroneIds: string[];
  selectedChat: string;
  draftChat: { prompt: unknown | null } | null;
  drones: DroneSummary[];
  dronesFilteredByRepo: DroneSummary[];
  startupSeedByDrone: Record<string, StartupSeedState>;
  selectionAnchorRef: React.MutableRefObject<string | null>;
  preferredSelectedDroneRef: React.MutableRefObject<string | null>;
  preferredSelectedDroneHoldUntilRef: React.MutableRefObject<number>;
  scrollChatToBottom: () => void;
  resetGroupDndState: () => void;
  setGroupMoveError: React.Dispatch<React.SetStateAction<string | null>>;
  setAppView: React.Dispatch<React.SetStateAction<'workspace' | 'settings'>>;
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
  draftChat,
  drones,
  dronesFilteredByRepo,
  startupSeedByDrone,
  selectionAnchorRef,
  preferredSelectedDroneRef,
  preferredSelectedDroneHoldUntilRef,
  scrollChatToBottom,
  resetGroupDndState,
  setGroupMoveError,
  setAppView,
  setDraftChat,
  setDraftCreateOpen,
  setDraftCreateError,
  setSelectedDrone,
  setSelectedDroneIds,
  setSelectedGroupMultiChat,
  setSelectedChat,
}: UseDroneSelectionStateArgs) {
  const selectDroneCard = React.useCallback(
    (droneIdRaw: string, opts?: { toggle?: boolean; range?: boolean }) => {
      const id = String(droneIdRaw ?? '').trim();
      if (!id) return;
      setAppView('workspace');
      setSelectedGroupMultiChat(null);
      setDraftChat(null);
      setDraftCreateOpen(false);
      setDraftCreateError(null);
      if (opts?.range && orderedDroneIds.length > 0) {
        const anchor =
          (selectionAnchorRef.current &&
            orderedDroneIds.includes(selectionAnchorRef.current) &&
            selectionAnchorRef.current) ||
          (selectedDrone && orderedDroneIds.includes(selectedDrone) ? selectedDrone : id);
        const anchorIdx = orderedDroneIds.indexOf(anchor);
        const selectedIdx = orderedDroneIds.indexOf(id);
        if (anchorIdx >= 0 && selectedIdx >= 0) {
          const start = Math.min(anchorIdx, selectedIdx);
          const end = Math.max(anchorIdx, selectedIdx);
          setSelectedDroneIds(orderedDroneIds.slice(start, end + 1));
          setSelectedDrone(id);
          selectionAnchorRef.current = anchor;
          scrollChatToBottom();
          return;
        }
      }
      if (opts?.toggle) {
        setSelectedDroneIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
        setSelectedDrone(id);
        selectionAnchorRef.current = id;
        scrollChatToBottom();
        return;
      }
      setSelectedDroneIds([id]);
      setSelectedDrone(id);
      selectionAnchorRef.current = id;
      scrollChatToBottom();
    },
    [
      orderedDroneIds,
      scrollChatToBottom,
      selectedDrone,
      selectionAnchorRef,
      setAppView,
      setDraftChat,
      setDraftCreateError,
      setDraftCreateOpen,
      setSelectedDrone,
      setSelectedDroneIds,
      setSelectedGroupMultiChat,
    ],
  );

  React.useEffect(() => {
    const valid = new Set(dronesFilteredByRepo.map((d) => d.id));
    setSelectedDroneIds((prev) => {
      const next = prev.filter((id) => valid.has(id));
      if (selectedDrone && valid.has(selectedDrone) && !next.includes(selectedDrone)) {
        next.push(selectedDrone);
      }
      if (next.length === prev.length && next.every((id, idx) => id === prev[idx])) return prev;
      return next;
    });
  }, [selectedDrone, setSelectedDroneIds, dronesFilteredByRepo]);

  // Auto-select first drone (and recover from deletions).
  React.useEffect(() => {
    if (draftChat) {
      if (!draftChat.prompt) {
        if (selectedDrone) setSelectedDrone(null);
        setSelectedDroneIds((prev) => (prev.length === 0 ? prev : []));
        selectionAnchorRef.current = null;
        preferredSelectedDroneRef.current = null;
        preferredSelectedDroneHoldUntilRef.current = 0;
      }
      return;
    }
    if (dronesFilteredByRepo.length === 0) {
      if (selectedDrone) setSelectedDrone(null);
      setSelectedDroneIds((prev) => (prev.length === 0 ? prev : []));
      resetGroupDndState();
      setGroupMoveError(null);
      selectionAnchorRef.current = null;
      preferredSelectedDroneRef.current = null;
      preferredSelectedDroneHoldUntilRef.current = 0;
      return;
    }
    const preferred = preferredSelectedDroneRef.current;
    if (preferred) {
      const preferredExists = dronesFilteredByRepo.some((d) => d.id === preferred);
      if (preferredExists) {
        if (selectedDrone !== preferred) {
          setSelectedDrone(preferred);
          setSelectedDroneIds((prev) => (prev.length === 1 && prev[0] === preferred ? prev : [preferred]));
          selectionAnchorRef.current = preferred;
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
      } else if (!selectedDrone || !dronesFilteredByRepo.some((d) => d.id === selectedDrone)) {
        return;
      }
    }
    if (!selectedDrone || !dronesFilteredByRepo.some((d) => d.id === selectedDrone)) {
      const first = dronesFilteredByRepo[0].id;
      setSelectedDrone(first);
      setSelectedDroneIds((prev) => (prev.length === 1 && prev[0] === first ? prev : [first]));
      selectionAnchorRef.current = first;
    }
  }, [
    draftChat,
    dronesFilteredByRepo,
    preferredSelectedDroneHoldUntilRef,
    preferredSelectedDroneRef,
    resetGroupDndState,
    selectedDrone,
    selectionAnchorRef,
    setGroupMoveError,
    setSelectedDrone,
    setSelectedDroneIds,
    startupSeedByDrone,
  ]);

  // Fall back if selected chat disappears.
  React.useEffect(() => {
    if (!selectedDrone) return;
    const d = drones.find((x) => x.id === selectedDrone);
    const chats = d?.chats ?? [];
    if (chats.length === 0) return;
    if (selectedChat && chats.includes(selectedChat)) return;
    setSelectedChat(chats.includes('default') ? 'default' : chats[0]);
  }, [drones, selectedDrone, selectedChat, setSelectedChat]);

  return { selectDroneCard };
}
