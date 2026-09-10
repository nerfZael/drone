import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { requestJson } from '../http';
import { subscribeDesktopEvents } from '../app/desktop-events';

export type PendingEvent = {
  id: string;
  resourceId: string;
  resourceType: string;
  eventType: string;
  summary: string;
  deliveryMode: 'queue' | 'asap';
  status: 'batching' | 'ready' | 'releasing' | 'paused' | 'rate-limited' | 'retrying' | 'failed';
  releaseAt: string | null;
  canRelease: boolean;
  error: string | null;
};
type PendingEventsResponse = { serverNow: string; deliveries: PendingEvent[] };

export function usePendingEvents(droneId: string, chatName: string, enabled = true) {
  const client = useQueryClient();
  const queryKey = React.useMemo(() => ['pending-events', droneId, chatName], [droneId, chatName]);
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const response = await requestJson<PendingEventsResponse>(
        `/api/resource-subscriptions/pending?${new URLSearchParams({ droneId, chatName })}`,
        { signal },
      );
      return { ...response, receivedAt: Date.now() };
    },
    enabled,
    refetchInterval: 2_000,
  });
  React.useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void client.invalidateQueries({ queryKey }), 50);
    };
    const unsubscribe = subscribeDesktopEvents({
      handlers: { pending_events_changed: refresh },
      onConnectedChange: (connected) => {
        if (connected) refresh();
      },
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [client, enabled, queryKey]);
  const mutation = useMutation({
    mutationFn: async (input: { droneId: string; chatName: string; deliveryIds: string[] }) => {
      await client.cancelQueries({ queryKey: ['pending-events', input.droneId, input.chatName] });
      return requestJson<PendingEventsResponse>('/api/resource-subscriptions/pending/release', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
    },
    onSettled: (_data, _error, input) =>
      client.invalidateQueries({
        queryKey: ['pending-events', input.droneId, input.chatName],
      }),
  });
  const mutationForChat =
    mutation.variables?.droneId === droneId && mutation.variables.chatName === chatName;
  return {
    deliveries: enabled ? (query.data?.deliveries ?? []) : [],
    serverNow: query.data?.serverNow,
    receivedAt: query.data?.receivedAt,
    error: enabled
      ? (query.error?.message ?? (mutationForChat ? mutation.error?.message : null) ?? null)
      : null,
    stale: query.isError,
    busy: mutationForChat && mutation.isPending,
    release: (deliveryIds: string[]) => mutation.mutate({ droneId, chatName, deliveryIds }),
  };
}

export type PendingEventsState = ReturnType<typeof usePendingEvents>;

export function questionPendingDeliveryStatus(
  state: PendingEventsState,
  requestId: string,
): string | undefined {
  const event = state.deliveries.find(
    (item) => item.resourceType === 'question_request' && item.resourceId === requestId,
  );
  if (!event) return undefined;
  if (state.stale) return 'Delivery status unavailable';
  if (event.status === 'failed') return 'Delivery failed';
  if (event.status === 'paused') return 'Delivery paused';
  return 'Pending delivery';
}

export function pendingEventStatus(event: PendingEvent, now: number): string {
  const seconds = Math.max(0, Math.ceil((Date.parse(event.releaseAt ?? '') - now) / 1_000));
  switch (event.status) {
    case 'paused':
      return 'Delivery paused';
    case 'rate-limited':
      return 'Waiting for run limit';
    case 'retrying':
      return seconds > 0 ? `Retry in ~${seconds}s` : 'Waiting to retry';
    case 'failed':
      return 'Delivery failed';
    case 'releasing':
      return 'Releasing…';
    default:
      return seconds > 0 ? `Next release in ~${seconds}s` : 'Waiting for release';
  }
}
