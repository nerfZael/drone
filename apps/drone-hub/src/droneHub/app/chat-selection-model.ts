import React from 'react';
import type { ChatInfo } from '../../domain';
import { chatIdentity, continuesChat } from './chat-identity';

export function chatNamesForConfigSelection(input: {
  chats?: readonly string[] | null;
  workflowChats?: readonly string[] | null;
  sideChats?: readonly { name: string }[] | null;
}): string[] {
  return Array.from(
    new Set(
      [...(input.chats ?? []), ...(input.workflowChats ?? []), ...(input.sideChats ?? []).map((chat) => chat.name)]
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
  // Keyed by the chat's ID once known, so a renamed chat keeps what is cached for it.
  return `${droneId}\u0000${chatIdentity(droneId, chatNameRaw)}`;
}

/**
 * A React key for a view of one chat. It stays the same while that chat is
 * renamed, or becomes known by its ID, so the view is not mounted again.
 */
export function useChatViewKey(
  droneIdRaw: string | null | undefined,
  chatNameRaw: string | null | undefined,
): string {
  const key = chatSelectionKey(droneIdRaw, chatNameRaw);
  const ref = React.useRef({ latest: key, shown: key });
  if (ref.current.latest !== key) {
    ref.current = { latest: key, shown: continuesChat(ref.current.latest, key) ? ref.current.shown : key };
  }
  return ref.current.shown;
}

export function chatInfoForSelection(
  chatInfo: ChatInfo | null,
  chatInfoKey: string,
  droneIdRaw: string | null | undefined,
  chatNameRaw: string | null | undefined,
): ChatInfo | null {
  if (!chatInfo) return null;
  const expectedKey = chatSelectionKey(droneIdRaw, chatNameRaw);
  const expectedChatName = String(chatNameRaw ?? '').trim() || 'default';
  const payloadChatName = String(chatInfo.chat ?? '').trim() || 'default';
  return chatInfoKey === expectedKey && payloadChatName === expectedChatName ? chatInfo : null;
}

export function chatConfigAvailableForSelection(
  chatInfo: ChatInfo | null,
  chatInfoKey: string,
  selectionKey: string,
): boolean {
  return Boolean(chatInfo && selectionKey && chatInfoKey === selectionKey);
}

export function shouldBlockChatContentForConfig(input: {
  configPending: boolean;
  transcriptAvailable: boolean;
  transcriptError: boolean;
}): boolean {
  return input.configPending && !input.transcriptAvailable && !input.transcriptError;
}

export function chatMetadataEligibleForSelection(input: {
  hasDroneSummary: boolean;
  droneProvisioning: boolean;
  droneStartupFailed: boolean;
  chatListed: boolean;
}): boolean {
  return (
    input.hasDroneSummary &&
    !input.droneProvisioning &&
    !input.droneStartupFailed &&
    input.chatListed
  );
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

export function genericChatComposerAvailable(input: {
  nativeChatActive: boolean;
  chatConfigResolution: ReturnType<typeof chatConfigResolutionState>;
  /** The loading view replaces the transcript and brings its own composer. */
  contentBlocked?: boolean;
}): boolean {
  if (input.nativeChatActive) return false;
  if (input.chatConfigResolution === 'ready' || input.chatConfigResolution === 'drone-error') return true;
  // Chat configuration reloads while the history stays on screen (drone phase
  // changes, chat switches served from cache). Removing the composer then
  // makes it look like it vanished mid-conversation.
  return input.chatConfigResolution === 'loading' && input.contentBlocked === false;
}

export function shouldShowDroneStartupFailureEmptyState(input: {
  startupFailed: boolean;
  transcriptCount: number;
  pendingPromptCount: number;
}): boolean {
  return input.startupFailed && input.transcriptCount <= 0 && input.pendingPromptCount <= 0;
}
