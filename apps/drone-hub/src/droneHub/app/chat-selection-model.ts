import type { ChatInfo } from '../../domain';

export function chatNamesForConfigSelection(input: {
  chats?: readonly string[] | null;
  workflowChats?: readonly string[] | null;
}): string[] {
  return Array.from(
    new Set(
      [...(input.chats ?? []), ...(input.workflowChats ?? [])]
        .map((chatName) => String(chatName ?? '').trim())
        .filter(Boolean),
    ),
  ).sort();
}

export function chatSelectionKey(
  droneIdRaw: string | null | undefined,
  chatNameRaw: string | null | undefined,
): string {
  const droneId = String(droneIdRaw ?? '').trim();
  if (!droneId) return '';
  return `${droneId}\u0000${String(chatNameRaw ?? '').trim() || 'default'}`;
}

export function chatInfoForSelection(
  chatInfo: ChatInfo | null,
  chatInfoKey: string,
  droneIdRaw: string | null | undefined,
  chatNameRaw: string | null | undefined,
): ChatInfo | null {
  if (!chatInfo) return null;
  return chatInfoKey === chatSelectionKey(droneIdRaw, chatNameRaw) ? chatInfo : null;
}

export function chatConfigResolutionState(input: {
  currentChatIsDraft: boolean;
  hasChats: boolean;
  metadataAvailable: boolean;
  loading: boolean;
  startupFailed?: boolean;
}): 'ready' | 'loading' | 'unavailable' | 'drone-error' {
  if (input.startupFailed) return 'drone-error';
  if (input.currentChatIsDraft || !input.hasChats || input.metadataAvailable) return 'ready';
  return input.loading ? 'loading' : 'unavailable';
}

export function shouldShowDroneStartupFailureEmptyState(input: {
  startupFailed: boolean;
  transcriptCount: number;
  pendingPromptCount: number;
}): boolean {
  return input.startupFailed && input.transcriptCount <= 0 && input.pendingPromptCount <= 0;
}
