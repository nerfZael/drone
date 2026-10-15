import React from 'react';
import { useDroneHubActiveDrag } from '../app/drone-hub-dnd';
import { pastedChatReferences } from '../app/chat-clipboard-store';
import {
  COMPOSER_REFERENCE_DRAG_TYPES,
  composerReferencesFromDragData,
  composerReferencesFromTransfer,
  type ComposerReference,
} from '../chat/composer-references';
import type { DroneSummary } from '../types';

export type DroppedChat = { droneId: string; chatName: string };

/** Chats a set of references names; a whole drone stands for its main chat. */
export function chatsFromReferences(
  references: readonly ComposerReference[],
  droneById: Readonly<Record<string, DroneSummary>>,
): DroppedChat[] {
  const chats = new Map<string, DroppedChat>();
  for (const reference of references) {
    if (reference.kind === 'chat') {
      chats.set(`${reference.droneId}\u0000${reference.chatName}`, { droneId: reference.droneId, chatName: reference.chatName });
      continue;
    }
    const names = droneById[reference.droneId]?.chats ?? [];
    const chatName = names.includes('default') ? 'default' : (names[0] ?? 'default');
    chats.set(`${reference.droneId}\u0000${chatName}`, { droneId: reference.droneId, chatName });
  }
  return [...chats.values()];
}

function pointInElement(element: Element | null, x: number, y: number): boolean {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * Lets an element take chats the way a composer takes references: dragged from the sidebar
 * (dnd-kit, followed by pointer), dragged from the Chats window or canvas (native drag), or
 * pasted after a copy there. Returns the props to spread and whether a drop is hovering.
 */
export function useChatDropTarget(
  rootRef: React.RefObject<HTMLElement | null>,
  droneById: Readonly<Record<string, DroneSummary>>,
  onChats: (chats: DroppedChat[]) => void,
) {
  const onChatsRef = React.useRef(onChats);
  onChatsRef.current = onChats;
  const dronesRef = React.useRef(droneById);
  dronesRef.current = droneById;
  const sidebarDrag = useDroneHubActiveDrag();
  const [sidebarOver, setSidebarOver] = React.useState(false);
  const [nativeOver, setNativeOver] = React.useState(false);
  React.useEffect(() => {
    const references = composerReferencesFromDragData(sidebarDrag);
    setSidebarOver(false);
    if (!references.length) return;
    const view = rootRef.current?.ownerDocument.defaultView;
    if (!view) return;
    const over = (event: PointerEvent) => pointInElement(rootRef.current, event.clientX, event.clientY);
    const onMove = (event: PointerEvent) => setSidebarOver(over(event));
    const onUp = (event: PointerEvent) => {
      if (over(event)) onChatsRef.current(chatsFromReferences(references, dronesRef.current));
    };
    view.addEventListener('pointermove', onMove);
    view.addEventListener('pointerup', onUp);
    return () => {
      view.removeEventListener('pointermove', onMove);
      view.removeEventListener('pointerup', onUp);
    };
  }, [rootRef, sidebarDrag]);
  const accepts = (event: React.DragEvent) =>
    COMPOSER_REFERENCE_DRAG_TYPES.some((type) => event.dataTransfer?.types?.includes?.(type));
  const props = {
    onDragEnterCapture: (event: React.DragEvent) => {
      if (!accepts(event)) return;
      event.preventDefault();
      setNativeOver(true);
    },
    onDragOverCapture: (event: React.DragEvent) => {
      if (accepts(event)) event.preventDefault();
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setNativeOver(false);
    },
    onDropCapture: (event: React.DragEvent) => {
      if (!accepts(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setNativeOver(false);
      onChatsRef.current(chatsFromReferences(composerReferencesFromTransfer(event.dataTransfer), dronesRef.current));
    },
    onPasteCapture: (event: React.ClipboardEvent) => {
      const pasted = pastedChatReferences(event.clipboardData);
      if (!pasted) return;
      event.preventDefault();
      event.stopPropagation();
      onChatsRef.current(chatsFromReferences(pasted.references, dronesRef.current));
    },
  };
  return { props, over: sidebarOver || nativeOver };
}
