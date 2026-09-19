import React from 'react';
import { DetachedChatContent, type DetachedChatWindowsProps } from './DetachedChatWindows';
import type { DroneSummary } from '../types';
import { useChatContextMenu } from './use-chat-context-menu';
import { openDesktopChatMenuItems } from './DetachedChatIndicator';

/** The regular main chat temporarily occupies the promoted fork's window. */
export function DisplacedMainChat({ drone, chatName, context }: {
  drone: DroneSummary;
  chatName: string;
  context: DetachedChatWindowsProps;
}) {
  const menu = useChatContextMenu(`Actions for ${chatName}`,
    () => openDesktopChatMenuItems(drone.id, chatName), { droneId: drone.id, chatName });
  return <div data-side-chat-name={chatName} data-chat-drone-id={drone.id} data-chat-name={chatName}
    onContextMenu={menu.onContextMenu}
    className="dh-floating-chat flex h-full min-h-0 min-w-0 flex-col bg-[var(--chat-background)]">
    <DetachedChatContent key={chatName} chat={{ droneId: drone.id, chatName, open: true }} drone={drone} context={context} />
    {menu.menu}
  </div>;
}
