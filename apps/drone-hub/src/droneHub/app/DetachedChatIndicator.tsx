import React from 'react';
import { detachedChatKey, useDetachedChatStore } from './detached-chat-store';
import type { SidebarContextMenuItem } from './SidebarContextMenu';

export function IconDetachedChat({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 15H3V3h12v6" /><rect x="9" y="9" width="12" height="12" rx="2" /></svg>;
}

export function DetachedChatIndicator({ droneId, chatName }: { droneId: string; chatName?: string }) {
  const open = useDetachedChatStore((s) => chatName
    ? Boolean(s.chats[detachedChatKey(droneId, chatName)]?.open)
    : Object.values(s.chats).some((chat) => chat.open && chat.droneId === droneId));
  return open ? <span className="inline-flex shrink-0 text-[var(--info)]" role="img" aria-label="Chat detached" title="Chat is open in a detached window"><IconDetachedChat /></span> : null;
}

export function detachChatMenuItem(droneId: string, chatName: string): SidebarContextMenuItem {
  const open = useDetachedChatStore.getState().chats[detachedChatKey(droneId, chatName)]?.open;
  return {
    id: 'detach-chat', label: open ? 'Focus detached chat' : 'Detach chat', icon: <IconDetachedChat />,
    onSelect: () => useDetachedChatStore.getState().detach(droneId, chatName),
  };
}
