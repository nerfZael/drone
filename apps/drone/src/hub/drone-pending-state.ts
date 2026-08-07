import {
  normalizePendingPromptState as normalizeSharedPendingPromptState,
  type PendingPromptState,
} from '@drone/assistant-chat';
import type { ChatImageAttachment } from './chat-attachments';

export type PendingPhase = 'draft' | 'starting' | 'creating' | 'seeding' | 'error';

export type { PendingPromptState } from '@drone/assistant-chat';

export type PendingStartupPrompt = {
  id: string;
  chatName: string;
  at: string;
  prompt: string;
  attachments?: ChatImageAttachment[];
  messageId?: string;
  cwd?: string | null;
  deliveryMode?: 'queue' | 'asap';
  state: PendingPromptState;
  error?: string;
  updatedAt?: string;
};

export type PendingPromptProjection = {
  id: string;
  at: string;
  prompt: string;
  messageId?: string;
  cwd?: string | null;
  deliveryMode?: 'queue' | 'asap';
  state: PendingPromptState;
  error?: string;
  updatedAt: string;
};

export function hasQueuedPromptWithId(drone: unknown, promptIdRaw: unknown): boolean {
  const promptId = String(promptIdRaw ?? '').trim();
  if (!promptId || !drone || typeof drone !== 'object') return false;
  const chats = (drone as any).chats;
  if (!chats || typeof chats !== 'object') return false;
  for (const entry of Object.values(chats) as any[]) {
    const pending = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
    if (
      pending.some(
        (prompt: any) =>
          String(prompt?.id ?? '').trim() === promptId &&
          String(prompt?.state ?? '').trim() === 'queued',
      )
    ) {
      return true;
    }
  }
  return false;
}

export function createPendingDroneStateHelpers(deps: {
  normalizeChatName: (raw: any) => string;
  normalizeChatImageAttachments?: (raw: unknown) => ChatImageAttachment[];
  nowIso: () => string;
}) {
  function resolvePendingDroneDisplayName(pendingEntry: any, fallbackRaw: unknown): string {
    return String(pendingEntry?.name ?? '').trim() || String(fallbackRaw ?? '').trim();
  }

  function applyPendingDisplayNameToProvisionedDrone(droneEntry: any, pendingEntry: any, fallbackRaw: unknown): string {
    const currentName = String(droneEntry?.name ?? '').trim();
    const fallback = String(fallbackRaw ?? '').trim();
    const pendingName = resolvePendingDroneDisplayName(pendingEntry, fallback);
    // The canonical pending -> real transition carries a rename that lands while
    // the CLI create is running. Do not overwrite that newer real name with the
    // pending snapshot captured before creation started.
    const displayName = currentName && fallback && currentName !== fallback
      ? currentName
      : pendingName || currentName || fallback;
    if (displayName) droneEntry.name = displayName;
    return displayName;
  }

  function normalizePendingPromptState(raw: unknown): PendingPromptState {
    return normalizeSharedPendingPromptState(raw, 'queued');
  }

  function normalizePendingPromptText(raw: unknown): string {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return String((raw as any).prompt ?? (raw as any).message ?? '');
    }
    return String(raw ?? '');
  }

  function normalizePendingStartupPrompts(raw: unknown, chatNameFilter?: string): PendingStartupPrompt[] {
    const list = Array.isArray(raw) ? raw : [];
    const out: PendingStartupPrompt[] = [];
    const chatFilter = chatNameFilter ? deps.normalizeChatName(chatNameFilter) : '';
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const id = String((item as any).id ?? '').trim();
      const prompt = normalizePendingPromptText((item as any).prompt);
      const chatName = deps.normalizeChatName((item as any).chatName);
      if (!id || !prompt.trim()) continue;
      let attachments: ChatImageAttachment[] = [];
      if (deps.normalizeChatImageAttachments) {
        try {
          attachments = deps.normalizeChatImageAttachments((item as any).attachments);
        } catch {
          attachments = [];
        }
      }
      if (chatFilter && chatName !== chatFilter) continue;
      out.push({
        id,
        chatName,
        at: typeof (item as any).at === 'string' ? String((item as any).at) : deps.nowIso(),
        prompt,
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(typeof (item as any).messageId === 'string' && String((item as any).messageId).trim()
          ? { messageId: String((item as any).messageId).trim() }
          : {}),
        cwd:
          typeof (item as any).cwd === 'string' ? String((item as any).cwd) : (item as any).cwd === null ? null : undefined,
        ...((item as any).deliveryMode === 'asap' || (item as any).deliveryMode === 'queue'
          ? { deliveryMode: (item as any).deliveryMode as 'queue' | 'asap' }
          : {}),
        state: normalizePendingPromptState((item as any).state),
        error: typeof (item as any).error === 'string' ? String((item as any).error) : undefined,
        updatedAt: typeof (item as any).updatedAt === 'string' ? String((item as any).updatedAt) : undefined,
      });
    }
    return out.slice(-80);
  }

  function startupPromptToPendingPrompt(prompt: PendingStartupPrompt): PendingPromptProjection {
    return {
      id: prompt.id,
      at: prompt.at,
      prompt: prompt.prompt,
      ...(prompt.messageId ? { messageId: prompt.messageId } : {}),
      ...(typeof prompt.cwd === 'string' || prompt.cwd === null ? { cwd: prompt.cwd } : {}),
      ...(prompt.deliveryMode ? { deliveryMode: prompt.deliveryMode } : {}),
      state: prompt.state,
      ...(prompt.error ? { error: prompt.error } : {}),
      updatedAt: prompt.updatedAt ?? deps.nowIso(),
    };
  }

  return {
    applyPendingDisplayNameToProvisionedDrone,
    normalizePendingPromptText,
    normalizePendingPromptState,
    normalizePendingStartupPrompts,
    resolvePendingDroneDisplayName,
    startupPromptToPendingPrompt,
  };
}
