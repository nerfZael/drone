import type { DeviceMeshCapabilityEvent } from './device-mesh-events';

export type RemoteDroneRefreshPlan = {
  refreshChat: boolean;
  refreshDrones: boolean;
};

export type TrailingRefresh = () => Promise<void>;

const CHAT_ONLY_REASONS = new Set([
  'runtime_tool_call_started',
  'runtime_tool_call_progress',
  'runtime_tool_call_completed',
  'runtime_tool_call_failed',
  'workspace_policy_changed',
]);

export function remoteDroneRefreshPlan(
  event: DeviceMeshCapabilityEvent,
  active: { droneId: string; chatName: string },
): RemoteDroneRefreshPlan {
  if (event.capability !== 'drone-control') {
    return { refreshChat: false, refreshDrones: false };
  }
  if (event.event === 'drones.changed') {
    return { refreshChat: false, refreshDrones: true };
  }
  if (event.event !== 'chat.changed') {
    return { refreshChat: false, refreshDrones: false };
  }
  const eventDroneId = String(event.payload?.droneId ?? '').trim();
  const eventChatName = String(event.payload?.chatName ?? '').trim();
  const reason = String(event.payload?.reason ?? '').trim();
  const matchingChat = Boolean(
    active.droneId &&
    (!eventDroneId || eventDroneId === active.droneId) &&
    (!eventChatName || eventChatName === active.chatName),
  );
  if (CHAT_ONLY_REASONS.has(reason)) {
    return { refreshChat: matchingChat, refreshDrones: false };
  }
  if (reason === 'canonical_history_changed' || reason === 'chat_write') {
    return { refreshChat: matchingChat, refreshDrones: !matchingChat };
  }
  return { refreshChat: matchingChat, refreshDrones: true };
}

export function createTrailingRefresh(run: () => Promise<void>): TrailingRefresh {
  let pending = false;
  let active: Promise<void> | null = null;

  const drain = async () => {
    while (pending) {
      pending = false;
      await run();
    }
  };

  return () => {
    pending = true;
    if (!active) {
      active = drain().finally(() => {
        active = null;
      });
    }
    return active;
  };
}
