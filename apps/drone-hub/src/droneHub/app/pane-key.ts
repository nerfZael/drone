/**
 * Identifies one hosted instance of a tool pane so per-pane state (terminal
 * sessions, editor splits) stays separate. The dock uses the fixed slots; a
 * tool opened in its own desktop window gets a `desktop:` key of its own.
 */
export type PaneKey = 'single' | 'top' | 'bottom' | `desktop:${string}`;

export function desktopPaneKey(windowId: string): PaneKey {
  return `desktop:${windowId}`;
}
