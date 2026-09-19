export function resolveManualSidebarToggle(state: { sidebarCollapsed: boolean }): {
  sidebarAutoMinimize: false;
  sidebarCollapsed: boolean;
} {
  return {
    sidebarAutoMinimize: false,
    sidebarCollapsed: !state.sidebarCollapsed,
  };
}
