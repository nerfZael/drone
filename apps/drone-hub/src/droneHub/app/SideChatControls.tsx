import React from 'react';
import type { WorkspaceSideChat } from './use-workspace-side-chats';
import { IconSidebarExpand } from './icons';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import { formatShortcutBinding } from './shortcuts';

/**
 * Branch / keep / move actions of a forked chat. They sit in the title bar of
 * its window, next to the delete action, or in the main chat's tab bar when
 * the fork is the main chat; the tab already names the chat and shows its cost.
 */
export function SideChatControls({ chat, busy, main = false, onKeep, onOpenSource, onMove }: {
  chat: WorkspaceSideChat;
  busy: boolean;
  main?: boolean;
  onKeep(): void;
  onOpenSource(): void;
  onMove(): void;
}) {
  const buttonClass = 'dh-chat-window-action disabled:opacity-50';
  const iconSize = 14;
  const moveLabel = main ? 'Return to floating window' : 'Open as main chat';
  const moveBinding = useDroneHubUiStore((state) => state.shortcutBindings.toggleSideChatMain);
  const moveTitle = `${main ? 'Return to the previous floating position and restore the previous main chat.' : 'Open as main chat and show the previous main chat in this window.'}${moveBinding ? ` (${formatShortcutBinding(moveBinding)})` : ''}`;
  // The floating title bar is a drag handle; keep its buttons from starting a drag.
  const stopDrag = main ? undefined : (event: React.PointerEvent) => event.stopPropagation();
  const buttons = (
    <>
      <button type="button" className={buttonClass} onPointerDown={stopDrag} onClick={onOpenSource} aria-label={`Open source chat: ${chat.sourceChatName}`} title={`Branched from ${chat.sourceChatName}. Click to open the source chat.`}>
        <svg aria-hidden="true" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M6 7v10M18 7a10 10 0 0 1-12 9" /></svg>
      </button>
      <button type="button" className={buttonClass} disabled={busy} onPointerDown={stopDrag} onClick={onKeep} aria-label="Keep in sidebar" title="Keep in sidebar">
        <IconSidebarExpand className="h-3.5 w-3.5" />
      </button>
      <button type="button" data-side-chat-move={chat.name} className={buttonClass} disabled={busy} onPointerDown={stopDrag} onClick={onMove} aria-label={moveLabel} title={moveTitle}>
        <svg aria-hidden="true" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          {main ? <><path d="M9 15H3V3h12v6" /><rect x="9" y="9" width="12" height="12" rx="2" /></> : <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 15l6-6M9 9h6v6" /></>}
        </svg>
      </button>
    </>
  );
  return buttons;
}
