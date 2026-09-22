import React from 'react';
import type { SidebarContextMenuItem } from './SidebarContextMenu';
import { requestSideChat } from './side-chat-events';
import { formatShortcutBinding, type ShortcutBindingMap } from './shortcuts';
import { useSideChatBusyStore } from './side-chat-busy-store';

export type ChatContextTarget = { droneId: string; chatName: string };
export type ChatContextActions = {
  createChat: (target: ChatContextTarget) => void;
  cloneChat: (target: ChatContextTarget) => void;
};

export const ChatContextActionsContext = React.createContext<ChatContextActions | null>(null);

function forkDisabledReason(scope: HTMLElement, checkpointId: string | undefined, droneId: string): string | undefined {
  const availability = scope.querySelector<HTMLElement>('[data-chat-fork-supported]')
    ?? scope.parentElement?.querySelector<HTMLElement>(':scope > [data-chat-fork-supported]');
  if (availability?.dataset.chatForkSupported === 'false') return 'Cloning to a side chat is not supported for this agent.';
  if (useSideChatBusyStore.getState().busy[droneId] ?? (availability?.dataset.chatForkBusy === 'true')) return 'A side chat operation is already in progress.';
  if (!checkpointId) return 'Wait for a completed assistant answer.';
}

export function chatActionMenuItems(
  target: ChatContextTarget,
  scope: HTMLElement,
  actions: ChatContextActions,
  bindings: ShortcutBindingMap,
): SidebarContextMenuItem[] {
  const checkpoint = scope.matches('[data-side-chat-checkpoint-id]')
    ? scope
    : scope.querySelector<HTMLElement>('[data-side-chat-checkpoint-id]');
  const checkpointId = checkpoint?.dataset.sideChatCheckpointId;
  const disabledReason = forkDisabledReason(scope, checkpointId, target.droneId);
  const shortcut = (id: 'createDroneChat' | 'cloneDroneChat' | 'createSideChat' | 'toggleSideChatMain') =>
    bindings[id] ? formatShortcutBinding(bindings[id]) : undefined;
  const items: SidebarContextMenuItem[] = [
    { id: 'create-chat', label: 'New chat', shortcut: shortcut('createDroneChat'), onSelect: () => actions.createChat(target) },
    { id: 'clone-chat', label: 'Clone chat', shortcut: shortcut('cloneDroneChat'), onSelect: () => actions.cloneChat(target) },
    {
      id: 'fork-side-chat', label: 'Clone to side chat', shortcut: shortcut('createSideChat'),
      disabled: Boolean(disabledReason), disabledReason,
      onSelect: () => {
        if (!forkDisabledReason(scope, checkpointId, target.droneId) && checkpointId) requestSideChat(target.droneId, { sourceChatName: target.chatName, checkpointId });
      },
    },
  ];
  const group = scope.closest('.dv-groupview') ?? scope.closest('[data-main-workspace-chat]');
  const move = [...(group?.querySelectorAll<HTMLButtonElement>('[data-side-chat-move]') ?? [])]
    .find(button => button.dataset.sideChatMove === target.chatName);
  if (move) items.push({
    id: 'move-chat', label: move.getAttribute('aria-label') || 'Open as main chat',
    shortcut: shortcut('toggleSideChatMain'), disabled: move.disabled,
    disabledReason: move.disabled ? 'A side chat operation is already in progress.' : undefined,
    onSelect: () => { if (move.isConnected && !move.disabled) move.click(); },
  });
  return items;
}
