import { removeExplorerRootsEverywhere } from './explorer-roots';

/** How the Hub names a chat's home workspace (`chatHomeTargetId` in apps/drone/src/hub/chat-homes.ts). */
const CHAT_HOME_PREFIX = 'host:chat-home-';
export const CHAT_HOMES_GONE_EVENT = 'drone-hub:chat-homes-gone';

/** The chat whose home `workspaceId` is (also a home's file route id), or null for any other workspace. */
export function chatIdOfHome(workspaceId: string): string | null {
  return workspaceId.startsWith(CHAT_HOME_PREFIX) ? workspaceId.slice(CHAT_HOME_PREFIX.length) || null : null;
}

/** The test `closeGoneChatHomes` sent: whether a workspace is the home of a chat that is not active any more. */
export function goneChatHomeTest(event: Event): ((workspaceId: string) => boolean) | null {
  return (event as CustomEvent<{ gone?: (workspaceId: string) => boolean }>).detail?.gone ?? null;
}

/**
 * Takes the homes of chats that were deleted or archived out of every File Explorer, and closes their files in the
 * editors of this window (keeping those with unsaved changes). `activeChatIds` is every chat that still exists and is
 * not archived, wherever it was removed: here, in another window, by an agent.
 */
export function closeGoneChatHomes(activeChatIds: ReadonlySet<string>): void {
  const gone = (workspaceId: string) => {
    const chatId = chatIdOfHome(workspaceId);
    return chatId !== null && !activeChatIds.has(chatId);
  };
  removeExplorerRootsEverywhere(gone);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHAT_HOMES_GONE_EVENT, { detail: { gone } }));
}
