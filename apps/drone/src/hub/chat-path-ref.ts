const CHAT_PATH = /^\/api\/drones\/([^/]+)\/chats\/([^/]+)(\/.*)?$/;

/**
 * Chat routes name the chat in the path. A client may put the chat's stable ID
 * there instead, so its request reaches the same chat even if it was renamed
 * meanwhile. The ID becomes the chat's current name here, once, before any route
 * reads the path; a segment that is no chat's ID stays a name.
 */
export function resolveChatIdInPath(
  url: URL,
  chatNameForId: (input: { droneId: string; chatId: string }) => string | null,
): void {
  const match = CHAT_PATH.exec(url.pathname);
  if (!match) return;
  let droneId: string;
  let chatRef: string;
  try {
    droneId = decodeURIComponent(match[1]!);
    chatRef = decodeURIComponent(match[2]!);
  } catch {
    return;
  }
  const chatName = chatNameForId({ droneId, chatId: chatRef });
  if (!chatName || chatName === chatRef) return;
  url.pathname = `/api/drones/${match[1]}/chats/${encodeURIComponent(chatName)}${match[3] ?? ''}`;
}
