type ChatIdentity = { droneId: string; chatName: string };

/** A tab and its content share a key; content also carries the actual drone/chat identity. */
export function focusedChatWindow(doc: Document): HTMLElement | null {
  const active = doc.querySelector<HTMLElement>('[data-side-chat-active]');
  if (!active || !isVisible(active)) return null;
  const key = active.dataset.sideChatName;
  const content = [...doc.querySelectorAll<HTMLElement>('[data-side-chat-name]')].find(
    (node) => node.dataset.sideChatName === key && node.dataset.chatDroneId && node.dataset.chatName && isVisible(node),
  );
  // Existing windows without identity metadata can still route composer focus.
  return content ?? active;
}

export function focusedChatIdentity(doc: Document, main: ChatIdentity | null): ChatIdentity | null {
  const window = focusedChatWindow(doc);
  const droneId = window?.dataset.chatDroneId;
  const chatName = window?.dataset.chatName;
  return droneId && chatName ? { droneId, chatName } : main;
}

function isVisible(node: HTMLElement): boolean {
  return !node.closest('[aria-hidden="true"]') && !node.closest('[style*="display: none"]');
}
