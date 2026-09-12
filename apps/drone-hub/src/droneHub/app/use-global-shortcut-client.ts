import {
  isDroneHubShortcutActionId,
  type DroneHubGlobalShortcutSettingsResponse,
} from '@drone/hub-model';
import React from 'react';

import { requestJson } from '../http';
import {
  applyGlobalShortcutSettings,
  clearActiveGlobalShortcutSettings,
} from './global-shortcut-state';
import type { ShortcutActionId } from './shortcuts';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';

export function useGlobalShortcutClient(): React.MutableRefObject<
  ((actionId: ShortcutActionId) => void) | null
> {
  const actionHandlerRef = React.useRef<((actionId: ShortcutActionId) => void) | null>(null);

  React.useEffect(() => {
    const randomClientId = window.crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const clientId = `hub-${randomClientId.replace(/[^A-Za-z0-9_-]/g, '')}`;
    let closed = false;

    const refreshSettings = () => {
      void requestJson<DroneHubGlobalShortcutSettingsResponse>('/api/settings/global-shortcuts')
        .then((settings) => {
          if (closed) return;
          applyGlobalShortcutSettings(settings);
          useDroneHubUiStore.getState().setShortcutBindings((current) => ({
            ...current,
            ...settings.bindings,
          }));
        })
        .catch(() => undefined);
    };
    const sendActivity = () => {
      void requestJson(`/api/global-shortcuts/clients/${encodeURIComponent(clientId)}/activity`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          focused: document.hasFocus(),
          visible: document.visibilityState === 'visible',
        }),
      }).catch(() => undefined);
    };
    const onConnected = () => {
      sendActivity();
      refreshSettings();
    };
    const onShortcut = (event: MessageEvent) => {
      let data: unknown = null;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      const actionId = (data as { actionId?: unknown } | null)?.actionId;
      if (
        document.hasFocus() &&
        document.activeElement instanceof Element &&
        document.activeElement.closest('[data-shortcut-capture="true"]')
      ) {
        return;
      }
      if (isDroneHubShortcutActionId(actionId)) actionHandlerRef.current?.(actionId);
    };

    const source = new window.EventSource(
      `/api/global-shortcuts/events?clientId=${encodeURIComponent(clientId)}`,
    );
    source.addEventListener('connected', onConnected);
    source.addEventListener('shortcut', onShortcut);
    window.addEventListener('focus', sendActivity);
    window.addEventListener('blur', sendActivity);
    document.addEventListener('visibilitychange', sendActivity);

    return () => {
      closed = true;
      source.close();
      clearActiveGlobalShortcutSettings();
      window.removeEventListener('focus', sendActivity);
      window.removeEventListener('blur', sendActivity);
      document.removeEventListener('visibilitychange', sendActivity);
    };
  }, []);

  return actionHandlerRef;
}
