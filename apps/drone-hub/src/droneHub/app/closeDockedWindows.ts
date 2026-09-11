import type { DockviewApi } from 'dockview';

/** Close workspace panes without touching floating/popout groups or the main chat. */
export function closeDockedWindows(api: DockviewApi): void {
  for (const group of [...api.groups]) {
    if (group.api.location.type !== 'grid') continue;
    for (const panel of [...group.panels]) {
      if (panel.id !== 'agent-chat') api.removePanel(panel);
    }
    // Remove intentional empty split regions too, leaving the chat the full grid.
    if (!group.panels.length && api.groups.includes(group)) api.removeGroup(group);
  }
}
