import React from 'react';
import type { WorkspaceSideChat } from './use-workspace-side-chats';
import { IconSidebarExpand } from './icons';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import { formatShortcutBinding } from './shortcuts';

/**
 * Branch / keep / move actions of a forked chat. In a floating window they sit
 * in the title bar next to the delete action; when the fork is the main chat
 * they form a slim row above the transcript that also names the chat.
 */
export function SideChatControls({ chat, busy, main = false, onKeep, onOpenSource, onMove }: {
  chat: WorkspaceSideChat;
  busy: boolean;
  main?: boolean;
  onKeep(): void;
  onOpenSource(): void;
  onMove(): void;
}) {
  const buttonClass = main
    ? 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--accent)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent)] disabled:opacity-50'
    : 'dh-chat-window-action disabled:opacity-50';
  const iconSize = main ? 16 : 14;
  const moveLabel = main ? 'Return to floating window' : 'Open as main chat';
  const moveBinding = useDroneHubUiStore((state) => state.shortcutBindings.toggleSideChatMain);
  const moveTitle = `${main ? 'Return to the previous floating position and restore the previous main chat.' : 'Open as main chat.'}${moveBinding ? ` (${formatShortcutBinding(moveBinding)})` : ''}`;
  // The floating title bar is a drag handle; keep its buttons from starting a drag.
  const stopDrag = main ? undefined : (event: React.PointerEvent) => event.stopPropagation();
  const buttons = (
    <>
      <button type="button" className={buttonClass} onPointerDown={stopDrag} onClick={onOpenSource} aria-label={`Open source chat: ${chat.sourceChatName}`} title={`Branched from ${chat.sourceChatName}. Click to open the source chat.`}>
        <svg aria-hidden="true" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M6 7v10M18 7a10 10 0 0 1-12 9" /></svg>
      </button>
      <button type="button" className={buttonClass} disabled={busy} onPointerDown={stopDrag} onClick={onKeep} aria-label="Keep in sidebar" title="Keep in sidebar">
        <IconSidebarExpand className={main ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
      </button>
      <button type="button" data-side-chat-move={chat.name} className={buttonClass} disabled={busy} onPointerDown={stopDrag} onClick={onMove} aria-label={moveLabel} title={moveTitle}>
        <svg aria-hidden="true" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          {main ? <><path d="M9 15H3V3h12v6" /><rect x="9" y="9" width="12" height="12" rx="2" /></> : <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 15l6-6M9 9h6v6" /></>}
        </svg>
      </button>
    </>
  );
  if (!main) return buttons;
  return (
    <div role="toolbar" aria-label="Side chat controls" className="flex shrink-0 items-center justify-end gap-1 border-b border-[var(--border)] px-2 py-0.5">
      <span className="mr-auto min-w-0 truncate text-11 text-[var(--muted)]">{chat.name}</span>
      {buttons}
    </div>
  );
}
