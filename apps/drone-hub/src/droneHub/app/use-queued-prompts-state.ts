import React from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { PendingPrompt } from '../types';
import { droneChatQueueKey, makeId, parseDroneChatQueueKey } from './helpers';

type QueuedPromptsState = {
  queuedPromptsByDroneChat: Record<string, PendingPrompt[]>;
  enqueueQueuedPrompt: (droneIdRaw: string, chatNameRaw: string, promptRaw: string) => PendingPrompt | null;
  patchQueuedPrompt: (key: string, id: string, patch: Partial<PendingPrompt>) => void;
  removeQueuedPrompt: (key: string, id: string) => void;
  clearQueuedPromptsForDrone: (droneIdRaw: string) => void;
  getQueuedPromptsForKey: (key: string) => PendingPrompt[];
};

const useQueuedPromptsStore = create<QueuedPromptsState>((set, get) => ({
  queuedPromptsByDroneChat: {},
  enqueueQueuedPrompt: (droneIdRaw, chatNameRaw, promptRaw) => {
    const droneId = String(droneIdRaw ?? '').trim();
    const chatName = String(chatNameRaw ?? '').trim() || 'default';
    const prompt = String(promptRaw ?? '').trim();
    if (!droneId || !prompt) return null;
    const item: PendingPrompt = {
      id: `queued-${makeId()}`,
      at: new Date().toISOString(),
      prompt,
      state: 'queued',
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
      const next: Record<string, PendingPrompt[]> = {};
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
