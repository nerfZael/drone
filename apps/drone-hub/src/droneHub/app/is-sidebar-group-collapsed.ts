export function isSidebarGroupCollapsed(
  value: Record<string, boolean>,
  groupRaw: string,
): boolean {
  const group = String(groupRaw ?? '').trim();
  // Missing entries are collapsed so new groups start closed. An explicit false
  // records the viewer's choice to keep a group open across app restarts.
  return Boolean(group) && value[group] !== false;
}
