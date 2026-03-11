import React from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { ChatImageAttachmentPayload } from '../chat';
import type { PendingPrompt } from '../types';
import { attachmentRefsFromPayload, normalizeChatImageAttachmentPayloads } from './chat-attachment-payloads';
import { droneChatQueueKey, makeId, parseDroneChatQueueKey } from './helpers';

export type QueuedPrompt = PendingPrompt & {
  attachmentPayloads?: ChatImageAttachmentPayload[];
};

type QueuedPromptsState = {
  queuedPromptsByDroneChat: Record<string, QueuedPrompt[]>;
  enqueueQueuedPrompt: (
    droneIdRaw: string,
    chatNameRaw: string,
    promptRaw: string,
    attachmentsRaw?: ChatImageAttachmentPayload[],
  ) => QueuedPrompt | null;
  patchQueuedPrompt: (key: string, id: string, patch: Partial<QueuedPrompt>) => void;
  removeQueuedPrompt: (key: string, id: string) => void;
  clearQueuedPromptsForDrone: (droneIdRaw: string) => void;
  getQueuedPromptsForKey: (key: string) => QueuedPrompt[];
};

const useQueuedPromptsStore = create<QueuedPromptsState>((set, get) => ({
  queuedPromptsByDroneChat: {},
  enqueueQueuedPrompt: (droneIdRaw, chatNameRaw, promptRaw, attachmentsRaw) => {
    const droneId = String(droneIdRaw ?? '').trim();
    const chatName = String(chatNameRaw ?? '').trim() || 'default';
    const prompt = String(promptRaw ?? '').trim();
    const attachmentPayloads = normalizeChatImageAttachmentPayloads(attachmentsRaw);
    if (!droneId || (!prompt && attachmentPayloads.length === 0)) return null;
    const item: QueuedPrompt = {
      id: `queued-${makeId()}`,
      at: new Date().toISOString(),
      prompt,
      state: 'queued',
      ...(attachmentPayloads.length > 0 ? { attachments: attachmentRefsFromPayload(attachmentPayloads), attachmentPayloads } : {}),
    };
    const key = droneChatQueueKey(droneId, chatName);
    set((prev) => {
      const cur = prev.queuedPromptsByDroneChat[key] ?? [];
      return {
        queuedPromptsByDroneChat: { ...prev.queuedPromptsByDroneChat, [key]: [...cur, item] },
      };
    });
    return item;
  },
  patchQueuedPrompt: (key, id, patch) => {
    set((prev) => {
      const cur = prev.queuedPromptsByDroneChat[key];
      if (!cur || cur.length === 0) return prev;
      const idx = cur.findIndex((p) => p.id === id);
      if (idx < 0) return prev;
      const nextArr = cur.slice();
      nextArr[idx] = { ...nextArr[idx], ...patch, updatedAt: new Date().toISOString() };
      return {
        queuedPromptsByDroneChat: { ...prev.queuedPromptsByDroneChat, [key]: nextArr },
      };
    });
  },
  removeQueuedPrompt: (key, id) => {
    set((prev) => {
      const cur = prev.queuedPromptsByDroneChat[key];
      if (!cur || cur.length === 0) return prev;
      const nextArr = cur.filter((p) => p.id !== id);
      if (nextArr.length === cur.length) return prev;
      if (nextArr.length === 0) {
        const next = { ...prev.queuedPromptsByDroneChat };
        delete next[key];
        return { queuedPromptsByDroneChat: next };
      }
      return {
        queuedPromptsByDroneChat: { ...prev.queuedPromptsByDroneChat, [key]: nextArr },
      };
    });
  },
  clearQueuedPromptsForDrone: (droneIdRaw) => {
    const droneId = String(droneIdRaw ?? '').trim();
    if (!droneId) return;
    set((prev) => {
      let changed = false;
      const next: Record<string, QueuedPrompt[]> = {};
      for (const [k, v] of Object.entries(prev.queuedPromptsByDroneChat)) {
        const parsed = parseDroneChatQueueKey(k);
        if (parsed && parsed.droneId === droneId) {
          changed = true;
          continue;
        }
        next[k] = v;
      }
      if (!changed) return prev;
      return { queuedPromptsByDroneChat: next };
    });
  },
  getQueuedPromptsForKey: (key) => {
    const k = String(key ?? '').trim();
    if (!k) return [];
    return get().queuedPromptsByDroneChat[k] ?? [];
  },
}));

export function useQueuedPromptsState() {
  const {
    queuedPromptsByDroneChat,
    enqueueQueuedPrompt,
    patchQueuedPrompt,
    removeQueuedPrompt,
    clearQueuedPromptsForDrone,
    getQueuedPromptsForKey,
  } = useQueuedPromptsStore(
    useShallow((s) => ({
      queuedPromptsByDroneChat: s.queuedPromptsByDroneChat,
      enqueueQueuedPrompt: s.enqueueQueuedPrompt,
      patchQueuedPrompt: s.patchQueuedPrompt,
      removeQueuedPrompt: s.removeQueuedPrompt,
      clearQueuedPromptsForDrone: s.clearQueuedPromptsForDrone,
      getQueuedPromptsForKey: s.getQueuedPromptsForKey,
    })),
  );
  const flushingQueuedKeysRef = React.useRef<Set<string>>(new Set());

  return {
    queuedPromptsByDroneChat,
    flushingQueuedKeysRef,
    enqueueQueuedPrompt,
    patchQueuedPrompt,
    removeQueuedPrompt,
    clearQueuedPromptsForDrone,
    getQueuedPromptsForKey,
  };
}
