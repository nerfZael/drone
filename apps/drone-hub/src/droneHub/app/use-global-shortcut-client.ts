import {
  isDroneHubShortcutActionId,
  type DroneHubGlobalShortcutSettingsResponse,
} from '@drone/hub-model';
import React from 'react';

import { requestJson } from '../http';
import {
  applyGlobalShortcutSettings,
  clearActiveGlobalShortcutSettings,
  GLOBAL_SHORTCUT_SETTINGS_EVENT,
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
    let lastActivity = '';
    let activityQueue = Promise.resolve();

    const applySettings = (settings: DroneHubGlobalShortcutSettingsResponse, mergeBindings = false) => {
      if (closed) return;
      applyGlobalShortcutSettings(settings);
      if (mergeBindings) useDroneHubUiStore.getState().setShortcutBindings((current) => ({ ...current, ...settings.bindings }));
      window.dispatchEvent(new CustomEvent(GLOBAL_SHORTCUT_SETTINGS_EVENT, { detail: settings }));
    };

    const refreshSettings = () => {
      void requestJson<DroneHubGlobalShortcutSettingsResponse>('/api/settings/global-shortcuts')
        .then((settings) => applySettings(settings, true))
        .catch(() => undefined);
    };
    const sendActivity = () => {
      const body = JSON.stringify({
          focused: document.hasFocus(),
          visible: document.visibilityState === 'visible',
          capturing: document.activeElement instanceof Element &&
            Boolean(document.activeElement.closest('[data-shortcut-binding-capture="true"]')),
      });
      if (body === lastActivity) return;
      lastActivity = body;
      activityQueue = activityQueue.then(async () => {
        if (closed) return;
        await requestJson(`/api/global-shortcuts/clients/${encodeURIComponent(clientId)}/activity`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body,
        });
      }).catch(() => { lastActivity = ''; });
    };
    const onConnected = () => {
      lastActivity = '';
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
        document.activeElement.closest('[data-shortcut-binding-capture="true"]')
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
    source.addEventListener('settings', (event) => {
      try { applySettings(JSON.parse((event as MessageEvent).data)); } catch { /* Ignore malformed events. */ }
    });
    window.addEventListener('focus', sendActivity);
    window.addEventListener('blur', sendActivity);
    document.addEventListener('visibilitychange', sendActivity);
    document.addEventListener('focusin', sendActivity);
    document.addEventListener('focusout', sendActivity);

    return () => {
      closed = true;
      source.close();
      clearActiveGlobalShortcutSettings();
      window.removeEventListener('focus', sendActivity);
      window.removeEventListener('blur', sendActivity);
      document.removeEventListener('visibilitychange', sendActivity);
      document.removeEventListener('focusin', sendActivity);
      document.removeEventListener('focusout', sendActivity);
    };
  }, []);

  return actionHandlerRef;
}
