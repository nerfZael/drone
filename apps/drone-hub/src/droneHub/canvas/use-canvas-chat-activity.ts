import React from 'react';
import { requestJson } from '../http';
import { createCanvasChatNodeId } from '../app/app-config';
import type { ChatActivity, ChatSteps } from './detailed-card-model';

const POLL_MS = 15_000;
/** Steps are summarized every 20 seconds or so while a chat works. */
const BUSY_POLL_MS = 6_000;

export type CanvasChatActivity = { activity: Record<string, ChatActivity>; steps: Record<string, ChatSteps> };

const EMPTY: CanvasChatActivity = { activity: {}, steps: {} };

/**
 * Cost, timing and steps per chat card: one request each for every chat, again
 * every few seconds while anything works (steps change as it goes), and whenever a chat starts or stops.
 */
export function useCanvasChatActivity(busyKey: string): CanvasChatActivity {
  const [byNodeId, setByNodeId] = React.useState<CanvasChatActivity>(EMPTY);
  React.useEffect(() => {
    let controller: AbortController | null = null;
    const load = () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      void Promise.all([
        requestJson<{ chats: Array<ChatActivity & { droneId: string; chatName: string }> }>('/api/usage/chats', { signal: current.signal })
          .catch(() => null),
        requestJson<{ steps: Array<ChatSteps & { droneId: string; chatName: string }> }>('/api/chats/steps', { signal: current.signal })
          .catch(() => null),
      ]).then(([usage, steps]) => {
        if (current.signal.aborted) return;
        setByNodeId((previous) => {
          const next: CanvasChatActivity = { activity: usage ? {} : previous.activity, steps: steps ? {} : previous.steps };
          for (const { droneId, chatName, ...activity } of usage?.chats ?? []) {
            const nodeId = createCanvasChatNodeId(droneId, chatName);
            if (nodeId) next.activity[nodeId] = activity;
          }
          for (const { droneId, chatName, ...chatSteps } of steps?.steps ?? []) {
            const nodeId = createCanvasChatNodeId(droneId, chatName);
            if (nodeId) next.steps[nodeId] = chatSteps;
          }
          return next;
        });
      });
    };
    load();
    const timer = setInterval(load, busyKey ? BUSY_POLL_MS : POLL_MS);
    return () => {
      clearInterval(timer);
      controller?.abort();
    };
  }, [busyKey]);
  return byNodeId;
}
