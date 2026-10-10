import { desktopNotificationSupport } from './desktop-notification-support';
import { desktopNotificationPayload } from './desktop-notification-presentation';
import { useEffect } from 'react';
import { dispatchAssistantOpenDroneChat } from '../assistant/open-drone-chat-event';
import { subscribeDesktopEvents } from './desktop-events';
import { useDesktopNotificationSettings } from './desktop-notification-settings';

export function useDesktopNotifications(): void {
  useEffect(() => {
    const desktop = window.droneHubDesktop;
    if (!desktop?.showNotification) return;
    let disposed = false;
    let cleanup = () => {};
    void desktopNotificationSupport().then((support) => {
      if (disposed || support !== 'cards') return;
      const seen = new Set<string>();
      const offSettings = useDesktopNotificationSettings.subscribe((settings, previous) => {
        if (previous.enabled && !settings.enabled) {
          void desktop.clearNotifications?.().catch((error) => settings.setError(String(error?.message || error)));
        }
      });
      const offClick = desktop.onNotificationClick?.(({ droneId, chatName }) => dispatchAssistantOpenDroneChat(droneId, chatName));
      const offError = desktop.onNotificationError?.((error) => useDesktopNotificationSettings.getState().setError(error));
      const unsubscribe = subscribeDesktopEvents({ handlers: {
        desktop_notification: (event) => {
          const data = JSON.parse(event.data);
          if (!data?.id || !data.droneId || !data.chatName || seen.has(data.id)) return;
          seen.add(data.id);
          if (seen.size > 1000) seen.delete(seen.values().next().value!);
          const settings = useDesktopNotificationSettings.getState();
          const payload = desktopNotificationPayload(data, settings);
          if (!payload) return;
          void desktop.showNotification!(payload).catch((error) => settings.setError(String(error?.message || error)));
        },
      } });
      cleanup = () => { unsubscribe(); offSettings(); offClick?.(); offError?.(); };
    });
    return () => { disposed = true; cleanup(); };
  }, []);
}
