import React from 'react';
import type { PendingPrompt } from '../types';
import { droneChatQueueKey, makeId, parseDroneChatQueueKey } from './helpers';

export function useQueuedPromptsState() {
  // Local-only prompt queue used while drones are provisioning (hubPhase starting/seeding).
  // Key format: `${droneId}::${chatName}`
  const [queuedPromptsByDroneChat, setQueuedPromptsByDroneChat] = React.useState<Record<string, PendingPrompt[]>>({});
  const queuedPromptsByDroneChatRef = React.useRef<Record<string, PendingPrompt[]>>({});
  const flushingQueuedKeysRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    queuedPromptsByDroneChatRef.current = queuedPromptsByDroneChat;
  }, [queuedPromptsByDroneChat]);

  const enqueueQueuedPrompt = React.useCallback((droneIdRaw: string, chatNameRaw: string, promptRaw: string): PendingPrompt | null => {
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
    setQueuedPromptsByDroneChat((prev) => {
      const cur = prev[key] ?? [];
      return { ...prev, [key]: [...cur, item] };
    });
    return item;
  }, []);

  const patchQueuedPrompt = React.useCallback((key: string, id: string, patch: Partial<PendingPrompt>) => {
    setQueuedPromptsByDroneChat((prev) => {
      const cur = prev[key];
      if (!cur || cur.length === 0) return prev;
      const idx = cur.findIndex((p) => p.id === id);
      if (idx < 0) return prev;
      const nextArr = cur.slice();
      nextArr[idx] = { ...nextArr[idx], ...patch, updatedAt: new Date().toISOString() };
      return { ...prev, [key]: nextArr };
    });
  }, []);

  const removeQueuedPrompt = React.useCallback((key: string, id: string) => {
    setQueuedPromptsByDroneChat((prev) => {
      const cur = prev[key];
      if (!cur || cur.length === 0) return prev;
      const nextArr = cur.filter((p) => p.id !== id);
      if (nextArr.length === cur.length) return prev;
      if (nextArr.length === 0) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: nextArr };
    });
  }, []);

  const clearQueuedPromptsForDrone = React.useCallback((droneIdRaw: string) => {
    const droneId = String(droneIdRaw ?? '').trim();
    if (!droneId) return;
    setQueuedPromptsByDroneChat((prev) => {
      let changed = false;
      const next: Record<string, PendingPrompt[]> = {};
      for (const [k, v] of Object.entries(prev)) {
        const parsed = parseDroneChatQueueKey(k);
        if (parsed && parsed.droneId === droneId) {
          changed = true;
          continue;
        }
        next[k] = v;
      }
      return changed ? next : prev;
    });
  }, []);

  return {
    queuedPromptsByDroneChat,
    queuedPromptsByDroneChatRef,
    flushingQueuedKeysRef,
    enqueueQueuedPrompt,
    patchQueuedPrompt,
    removeQueuedPrompt,
    clearQueuedPromptsForDrone,
  };
}
