import React from 'react';
import type { PromptQueueInterruptionResolution } from '@drone/assistant-chat';

import { beginRecordBusyKey, removeRecordKey } from './keyed-record-state';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

export function usePendingPromptInterruption(input: {
  droneId?: string | null;
  chatName?: string | null;
  requestJson: RequestJson;
  onResolved?: () => void;
}) {
  const [busyById, setBusyById] = React.useState<Record<string, true>>({});
  const [errorById, setErrorById] = React.useState<Record<string, string>>({});
  const onResolvedRef = React.useRef(input.onResolved);
  onResolvedRef.current = input.onResolved;

  React.useEffect(() => {
    setBusyById({});
    setErrorById({});
  }, [input.chatName, input.droneId]);

  const resolve = React.useCallback(
    async (promptIdRaw: string, resolution: PromptQueueInterruptionResolution): Promise<void> => {
      const promptId = String(promptIdRaw ?? '').trim();
      const droneId = String(input.droneId ?? '').trim();
      const chatName = String(input.chatName ?? '').trim() || 'default';
      if (!promptId || !droneId || !beginRecordBusyKey(setBusyById, promptId)) return;
      setErrorById((current) => removeRecordKey(current, promptId));
      try {
        await input.requestJson<{ ok: true }>(
          `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/pending/${encodeURIComponent(promptId)}/interruption`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ resolution }),
          },
        );
        onResolvedRef.current?.();
      } catch (error: any) {
        setErrorById((current) => ({
          ...current,
          [promptId]: error?.message ?? String(error),
        }));
      } finally {
        setBusyById((current) => removeRecordKey(current, promptId));
      }
    },
    [input.chatName, input.droneId, input.requestJson],
  );

  return { busyById, errorById, resolve };
}
