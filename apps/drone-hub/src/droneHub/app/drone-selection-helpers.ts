import { normalizedDroneChats } from './chat-node-helpers';
import type { DroneSummary } from '../types';

export type DroneSelectionClickOptions = {
  toggle?: boolean;
  range?: boolean;
  orderedDroneIds?: string[];
};

function uniqueOrderedDroneIds(ids: string[]): string[] {
  return Array.from(new Set(ids.map((item) => String(item ?? '').trim()).filter(Boolean)));
}

export function retainValidSelectedDroneIds(
  selectedDroneIds: readonly string[],
  validDroneIds: ReadonlySet<string>,
): string[] {
  return uniqueOrderedDroneIds([...selectedDroneIds]).filter((id) => validDroneIds.has(id));
}

export function resolveSelectedChatForDrone(args: {
  droneId: string;
  droneById?: Record<string, DroneSummary>;
  drones?: DroneSummary[];
  lastSelectedChatByDrone: Record<string, string>;
}): string {
  const droneId = String(args.droneId ?? '').trim();
  if (!droneId) return 'default';
  const drone =
    args.droneById?.[droneId] ??
    args.drones?.find((candidate) => String(candidate?.id ?? '').trim() === droneId) ??
    null;
  const chats = normalizedDroneChats(drone);
  const remembered = String(args.lastSelectedChatByDrone[droneId] ?? '').trim();
  if (remembered && chats.includes(remembered)) return remembered;
  if (chats.includes('default')) return 'default';
  return chats[0] ?? 'default';
}

export function shouldKeepPendingSelectedChat(args: {
  selectedChat: string;
  availableChats: string[];
  pendingUntilMs: number;
  nowMs?: number;
}): boolean {
  const selectedChat = String(args.selectedChat ?? '').trim();
  if (!selectedChat || selectedChat === 'default') return false;
  if (args.availableChats.includes(selectedChat)) return false;
  return args.pendingUntilMs > (args.nowMs ?? Date.now());
}

export function resolveDroneCardSelection({
  droneId,
  selectedDrone,
  selectedDroneIds,
  orderedDroneIds,
  selectionAnchor,
  opts,
}: {
  droneId: string;
  selectedDrone: string | null;
  selectedDroneIds: string[];
  orderedDroneIds: string[];
  selectionAnchor: string | null;
  opts?: DroneSelectionClickOptions;
}): { selectedDroneIds: string[]; activeDroneId: string | null; selectionAnchor: string | null } {
  const id = String(droneId ?? '').trim();
  if (!id) return { selectedDroneIds, activeDroneId: selectedDrone, selectionAnchor };

  const currentSelectedIds = uniqueOrderedDroneIds(selectedDroneIds);
  const visibleOrder = uniqueOrderedDroneIds(opts?.orderedDroneIds?.length ? opts.orderedDroneIds : orderedDroneIds);
  if (opts?.range && visibleOrder.length > 0) {
    const anchor =
      (selectionAnchor && visibleOrder.includes(selectionAnchor) && selectionAnchor) ||
      (selectedDrone && visibleOrder.includes(selectedDrone) ? selectedDrone : id);
    const anchorIdx = visibleOrder.indexOf(anchor);
    const selectedIdx = visibleOrder.indexOf(id);
    if (anchorIdx >= 0 && selectedIdx >= 0) {
      const start = Math.min(anchorIdx, selectedIdx);
      const end = Math.max(anchorIdx, selectedIdx);
      return {
        selectedDroneIds: visibleOrder.slice(start, end + 1),
        activeDroneId: id,
        selectionAnchor: anchor,
      };
    }
  }

  if (opts?.toggle) {
    if (currentSelectedIds.includes(id)) {
      const nextSelectedIds = currentSelectedIds.filter((item) => item !== id);
      const activeDroneId =
        selectedDrone && nextSelectedIds.includes(selectedDrone)
          ? selectedDrone
          : nextSelectedIds[nextSelectedIds.length - 1] ?? null;
      return {
        selectedDroneIds: nextSelectedIds,
        activeDroneId,
        selectionAnchor: id,
      };
    }
    return {
      selectedDroneIds: [...currentSelectedIds, id],
      // Modifier-click changes the selection set without navigating away from the
      // workspace that is already open. This mirrors desktop explorer behavior.
      activeDroneId:
        selectedDrone && currentSelectedIds.includes(selectedDrone) ? selectedDrone : id,
      selectionAnchor: id,
    };
  }

  return {
    selectedDroneIds: [id],
    activeDroneId: id,
    selectionAnchor: id,
  };
}

export function resolveDroneDeleteTargetIds({
  droneId,
  selectedDrone,
  selectedDroneIds,
}: {
  droneId?: string | null;
  selectedDrone: string | null;
  selectedDroneIds: string[];
}): string[] {
  const id = String(droneId ?? '').trim();
  const selectedIds = uniqueOrderedDroneIds(selectedDroneIds);
  if (id) {
    if (selectedIds.length > 1 && selectedIds.includes(id)) return selectedIds;
    return [id];
  }
  if (selectedIds.length > 0) return selectedIds;
  const activeId = String(selectedDrone ?? '').trim();
  return activeId ? [activeId] : [];
}
