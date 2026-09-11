type PanelGroupLike = { api: { location: { type: string } }; panels: readonly unknown[] };

/**
 * Panels docked in the workspace grid. Floating side chats and popouts have
 * their own frames and headers, so they do not decide whether the docked main
 * chat is alone; counting them made the main chat's tab bar pop in and out
 * every time a side chat was forked or deleted.
 */
export function workspaceGridPanelCount(groups: readonly PanelGroupLike[]): number {
  return groups.reduce(
    (count, group) => (group.api.location.type === 'grid' ? count + group.panels.length : count),
    0,
  );
}
