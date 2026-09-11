import type { DockviewApi } from 'dockview';

export type WorkspaceLayoutSource = {
  api: DockviewApi; root: HTMLElement;
  transaction(action: () => void): void;
};
export const READ_WORKSPACE_LAYOUT = 'drone-hub:read-workspace-layout';

export function getWorkspaceLayoutSource(workspaceId: string): WorkspaceLayoutSource | null {
  const detail: { workspaceId: string; source: WorkspaceLayoutSource | null } = { workspaceId, source: null };
  window.dispatchEvent(new CustomEvent(READ_WORKSPACE_LAYOUT, { detail }));
  return detail.source;
}
