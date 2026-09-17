import React from 'react';
import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';
import { createPortal } from 'react-dom';
import { observeCompanionWindowSize } from './helpers/observe-companion-window-size';
import { prepareCompanionWindow } from './helpers/prepare-companion-window';

type CompanionWindowState = {
  supported: boolean;
  detached: boolean;
  error: string;
  toggle(): void;
  portalContainer?: HTMLElement;
  ownerWindow?: Window;
};

const CompanionWindowContext = React.createContext<CompanionWindowState>({
  supported: false, detached: false, error: '', toggle() {},
});

export function useCompanionWindow() {
  return React.useContext(CompanionWindowContext);
}

export function useCompanionWindowHost(visible: boolean) {
  const bridge = typeof window === 'undefined' ? undefined : window.droneHubDesktop?.companionWindow;
  // Never change the portal target: moving this DOM node preserves the entire
  // React subtree, including editor drafts, selection, and proposal review state.
  const [host] = React.useState(() => typeof document === 'undefined' ? undefined : document.createElement('div'));
  const [floating, setFloating] = React.useState<Window | null>(null);
  const floatingRef = React.useRef<Window | null>(null);
  const cleanupRef = React.useRef<(() => void) | null>(null);
  const [error, setError] = React.useState('');
  const restoreAttempted = React.useRef(false);
  const attach = React.useCallback((savePreference = true) => {
    if (savePreference) useDroneHubUiStore.getState().setCompanionWindowDetached(false);
    if (host) document.body.append(host);
    cleanupRef.current?.();
    cleanupRef.current = null;
    floatingRef.current = null;
    setFloating(null);
    bridge?.control('attach');
  }, [bridge, host]);

  React.useLayoutEffect(() => {
    if (!host) return;
    document.body.append(host);
    return () => {
      // Move before destroy, even on unmount, so React can clean up its nodes.
      document.body.append(host);
      cleanupRef.current?.();
      cleanupRef.current = null;
      floatingRef.current = null;
      restoreAttempted.current = false;
      bridge?.control('close');
      host.remove();
    };
  }, [host, bridge]);
  React.useEffect(() => bridge?.onClose(() => attach()), [bridge, attach]);
  React.useEffect(() => {
    if (!floating || !bridge || !host) return;
    const stopSizing = observeCompanionWindowSize(host, floating, height => bridge.control('resize', { height }));
    bridge.control(visible ? 'show' : 'hide');
    return stopSizing;
  }, [bridge, floating, host, visible]);

  const detach = React.useCallback(() => {
    if (!bridge || !host) return;
    setError('');
    if (floatingRef.current) return;
    let child: Window | null = null;
    try {
      child = window.open('about:blank', 'drone-hub-companion');
      if (!child) throw new Error('The desktop window could not be opened.');
      cleanupRef.current = prepareCompanionWindow(document, child.document);
      child.document.body.append(host);
      floatingRef.current = child;
      setFloating(child);
      useDroneHubUiStore.getState().setCompanionWindowDetached(true);
    } catch (cause) {
      attach(false);
      setError(`Could not detach Companion. ${cause instanceof Error ? cause.message : 'Try again.'}`);
    }
  }, [attach, bridge, host]);

  React.useEffect(() => {
    // Restore only when Companion is opened, without activating it on app startup.
    if (!visible || !bridge || !host || restoreAttempted.current) return;
    restoreAttempted.current = true;
    if (useDroneHubUiStore.getState().companionWindowDetached) detach();
  }, [visible, bridge, host, detach]);

  const toggle = React.useCallback(() => {
    if (floatingRef.current) attach();
    else detach();
  }, [attach, detach]);

  const state: CompanionWindowState = {
    supported: Boolean(bridge), detached: Boolean(floating), error, toggle,
    portalContainer: host,
    ownerWindow: floating ?? (typeof window === 'undefined' ? undefined : window),
  };
  return {
    ...state,
    render: (children: React.ReactNode) => (
      <CompanionWindowContext.Provider value={state}>
        {host ? createPortal(children, host) : children}
      </CompanionWindowContext.Provider>
    ),
  };
}
