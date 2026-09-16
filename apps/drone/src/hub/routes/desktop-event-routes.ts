import { DesktopNotificationObserver } from '../notifications/DesktopNotificationObserver';
import type { ChatSubscriptionStatus } from '../subscriptions/resource-subscription-service';
import type { ServerResponse } from 'node:http';

import type { DroneChatBroadcaster } from '../drone-chat-broadcaster';
import type { DroneRegistryBroadcaster } from '../drone-registry-broadcaster';
import type { HubRouter } from '../hub-router';
import { hubChangeEvents } from '../hub-change-events';

export type DesktopEventRouteDependencies = {
  assistantService: {
    subscribeChanges: (subscriber: (event: any) => void) => () => void;
  };
  droneChatBroadcaster: DroneChatBroadcaster;
  droneRegistryBroadcaster: DroneRegistryBroadcaster;
  readNotificationStatus: (chat: { droneId: string; chatName: string }) => Promise<ChatSubscriptionStatus & { droneName: string }>;
  nowIso: () => string;
  writeSseEvent: (response: ServerResponse, event: string, data: any) => void;
};

function desktopRegistryEventName(event: string): string {
  if (event === 'snapshot') return 'registry_snapshot';
  if (event === 'delta') return 'registry_delta';
  return 'registry_stream_error';
}

function desktopChatEventName(event: string): string {
  if (event === 'snapshot') return 'chat_snapshot';
  if (event === 'chat_delta') return 'chat_delta';
  return 'chat_stream_error';
}

export function registerDesktopEventRoutes(
  router: HubRouter,
  deps: DesktopEventRouteDependencies,
): void {
  router.get('/api/desktop/events', ({ req, res, url }) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('connection', 'keep-alive');
    req.socket.setTimeout(0);
    (res as ServerResponse & { flushHeaders?: () => void }).flushHeaders?.();

    const observer = url.searchParams.get('notifications') === '1'
      ? new DesktopNotificationObserver(deps.readNotificationStatus, (event) => {
          deps.writeSseEvent(res, 'desktop_notification', event);
        })
      : null;
    const unsubscribeNotifications = observer
      ? hubChangeEvents.onDesktopNotification((event) => deps.writeSseEvent(res, 'desktop_notification', event))
      : () => {};
    const unsubscribeAssistant = deps.assistantService.subscribeChanges((event) => {
      deps.writeSseEvent(res, 'assistant_change', event);
    });
    const unsubscribeRegistry = deps.droneRegistryBroadcaster.subscribe((event, data) => {
      deps.writeSseEvent(res, desktopRegistryEventName(event), data);
      if (event === 'delta') observer?.update((data.upserts ?? []).flatMap((drone: any) =>
        (drone.chats ?? []).map((chatName: string) => ({ droneId: drone.id, chatName }))));
    });
    const unsubscribeChat = deps.droneChatBroadcaster.subscribe((event, data) => {
      deps.writeSseEvent(res, desktopChatEventName(event), data);
      if (event === 'snapshot' || event === 'chat_delta') observer?.update(data.chats ?? [], data.removed ?? []);
    });
    const unsubscribeDeliveries = hubChangeEvents.onResourceDeliveryChange(() => {
      deps.writeSseEvent(res, 'pending_events_changed', { at: deps.nowIso() });
    });

    deps.droneRegistryBroadcaster.start();
    deps.droneChatBroadcaster.start();
    deps.writeSseEvent(res, 'connected', { ok: true, at: deps.nowIso() });

    const registrySnapshot = deps.droneRegistryBroadcaster.freshSnapshot;
    if (registrySnapshot) {
      deps.writeSseEvent(res, 'registry_snapshot', registrySnapshot);
      deps.droneRegistryBroadcaster.schedule(0);
    } else {
      void deps.droneRegistryBroadcaster.refresh({ broadcastSnapshot: true });
    }
    const chatSnapshot = deps.droneChatBroadcaster.snapshot;
    if (chatSnapshot) {
      observer?.update(chatSnapshot.chats);
      deps.writeSseEvent(res, 'chat_snapshot', chatSnapshot);
      deps.droneChatBroadcaster.schedule(0);
    } else {
      void deps.droneChatBroadcaster.refresh({ broadcastSnapshot: true });
    }

    const keepAlive = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) res.write(': keepalive\n\n');
    }, 25_000);
    keepAlive.unref?.();

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearInterval(keepAlive);
      observer?.close();
      unsubscribeNotifications();
      unsubscribeAssistant();
      unsubscribeRegistry();
      unsubscribeChat();
      unsubscribeDeliveries();
      deps.droneRegistryBroadcaster.stopIfIdle();
      deps.droneChatBroadcaster.stopIfIdle();
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
  });
}
