import React from 'react';
import type { IDockviewPanelHeaderProps } from 'dockview';
import { usePanelTitle } from './ChatWindowTab';
import { RIGHT_PANEL_TAB_LABELS, type RightPanelTab } from './app-config';
import { desktopToolTabSupported, desktopToolWindowsAvailable, useDesktopToolWindows } from './desktop-tool-windows';

/**
 * A dock tab that carries its own controls before the close button: the
 * panel's name, then whatever buttons the panel adds, then a divider and the X.
 * Middle-click closes, like dockview's stock tab.
 */
export function DockTabShell({ api, children }: {
  api: IDockviewPanelHeaderProps['api'];
  children?: React.ReactNode;
}) {
  const title = usePanelTitle(api);
  const middleButtonDown = React.useRef(false);
  return (
    <div
      className="dv-default-tab"
      data-testid="dockview-dv-default-tab"
      title={title}
      onPointerDown={(event) => {
        middleButtonDown.current = event.button === 1;
        if (event.button === 1) event.preventDefault();
      }}
      onPointerUp={(event) => {
        if (middleButtonDown.current && event.button === 1) api.close();
        middleButtonDown.current = false;
      }}
      onPointerLeave={() => {
        middleButtonDown.current = false;
      }}
    >
      <span className="dv-default-tab-content">{title}</span>
      {/* Controls that render nothing (outside the desktop app) leave the slot empty, and CSS drops the divider with it. */}
      <span className="dh-dock-tab-controls">{children}</span>
      <span className="dh-dock-tab-divider" aria-hidden="true" />
      <div
        className="dv-default-tab-action"
        onPointerDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.preventDefault();
          api.close();
        }}
      >
        <svg height="11" width="11" viewBox="0 0 28 28" aria-hidden="true" focusable={false} className="dv-svg">
          <path d="M2.1 27.3L0 25.2L11.55 13.65L0 2.1L2.1 0L13.65 11.55L25.2 0L27.3 2.1L15.75 13.65L27.3 25.2L25.2 27.3L13.65 15.75L2.1 27.3Z" />
        </svg>
      </div>
    </div>
  );
}

/** Stops a tab control's press from dragging or activating the tab. */
export const stopTabEvent = (event: React.SyntheticEvent) => event.stopPropagation();

/**
 * Opens the tool in a desktop window that follows the selected drone until
 * pinned there. Rendered only in the desktop app, where such windows exist.
 */
export function OpenDesktopToolButton({ tab }: { tab: () => RightPanelTab | null }) {
  if (!desktopToolWindowsAvailable() || !desktopToolTabSupported(tab())) return null;
  return (
    <button
      type="button"
      className="dh-dock-tab-button"
      data-open-desktop-tool=""
      title="Open in a desktop window. The window shows the selected drone until you pin it to one."
      aria-label="Open in a desktop window"
      onPointerDown={stopTabEvent}
      onClick={(event) => {
        stopTabEvent(event);
        const target = tab();
        if (target) useDesktopToolWindows.getState().open(target);
      }}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 10H2V2h8v4" /><rect x="6" y="6" width="8" height="8" rx="1" />
      </svg>
    </button>
  );
}

export function desktopToolWindowLabel(tab: RightPanelTab): string {
  return RIGHT_PANEL_TAB_LABELS[tab] ?? tab;
}
