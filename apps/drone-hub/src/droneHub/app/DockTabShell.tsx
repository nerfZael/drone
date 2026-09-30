import React from 'react';
import type { IDockviewPanelHeaderProps } from 'dockview';
import { usePanelTitle } from './ChatWindowTab';
import { RIGHT_PANEL_TAB_LABELS, type RightPanelTab } from './app-config';
import { desktopToolTabSupported, desktopToolWindowsAvailable, useDesktopToolWindows } from './desktop-tool-windows';
import { expansionKeyForPanel, requestPanelExpansionToggle, usePanelExpansionPreferences } from './workspace-panel-expansion';

/**
 * A dock tab that carries its own controls before the close button: the
 * panel's name, then whatever buttons the panel adds, then a divider and the X.
 * Middle-click closes, like dockview's stock tab; double-click expands the
 * window over its neighbours until the next double-click.
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
      onDoubleClick={(event) => {
        if ((event.target as Element).closest('button, .dv-default-tab-action')) return;
        if (api.group) requestPanelExpansionToggle(api.group.id);
      }}
    >
      <span className="dv-default-tab-content">{title}</span>
      {/* Controls that render nothing (outside the desktop app) leave the slot empty, and CSS drops the divider with it. */}
      <span className="dh-dock-tab-controls"><ExpandOnFocusButton panelId={api.id} />{children}</span>
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

/** Turns expand on focus on or off for this kind of window, in every layout. */
function ExpandOnFocusButton({ panelId }: { panelId: string | undefined }) {
  const key = panelId ? expansionKeyForPanel(panelId) : '';
  const on = usePanelExpansionPreferences((state) => Boolean(key && state.enabled[key]));
  const toggle = usePanelExpansionPreferences((state) => state.toggle);
  if (!key) return null;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className="dh-dock-tab-button"
      data-expand-on-focus-toggle=""
      title={on
        ? 'Expand on focus is on: the window grows over its neighbours while you work in it. Click to turn off.'
        : 'Expand on focus: grow over neighbouring windows while you work in this one. Double-click the tab to expand it once.'}
      aria-label="Expand on focus"
      onPointerDown={stopTabEvent}
      onDoubleClick={stopTabEvent}
      onClick={(event) => {
        stopTabEvent(event);
        toggle(key);
      }}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10 2h4v4M6 14H2v-4M14 2 9.5 6.5M2 14l4.5-4.5" />
      </svg>
    </button>
  );
}

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
