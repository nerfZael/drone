import { requestJson } from '../http';
import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';
import { subscribeDesktopEvents } from '../app/desktop-events';

/** A workspace the user added on this device (apps/drone/src/hub/user-workspaces.ts). */
export type UserWorkspace = {
  id: string;
  name: string;
  createdAt: string;
  root: string;
  missing: boolean;
} & ({ kind: 'created'; folder: string } | { kind: 'linked'; path: string });

export type UserWorkspacesState = {
  directory: string;
  defaultDirectory: string;
  customDirectory: boolean;
  workspaces: UserWorkspace[];
};

/** A local workspace the explorer can show; `browseId` is the id the file routes take. */
export type BrowsableWorkspace = {
  id: string;
  browseId: string;
  name: string;
  kind: 'folder' | 'drone';
  category: 'Home' | 'Workspaces' | 'Repositories' | 'Folders' | 'Host drones' | 'Container drones';
  path?: string;
  droneId?: string;
  status?: string;
};

const post = <T>(url: string, body: unknown) =>
  requestJson<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const loadUserWorkspaces = () => requestJson<UserWorkspacesState>('/api/workspaces');
export const loadBrowsableWorkspaces = async () => (await requestJson<{ workspaces: BrowsableWorkspace[] }>('/api/workspaces/browse')).workspaces;

export async function createWorkspace(name: string): Promise<UserWorkspace> {
  const { workspace } = await post<{ workspace: UserWorkspace }>('/api/workspaces', { name });
  notifyWorkspacesChanged();
  return workspace;
}

export async function linkWorkspace(path: string, name?: string): Promise<UserWorkspace> {
  const { workspace } = await post<{ workspace: UserWorkspace }>('/api/workspaces/link', { path, ...(name ? { name } : {}) });
  notifyWorkspacesChanged();
  return workspace;
}

export async function renameWorkspace(id: string, name: string): Promise<void> {
  await post(`/api/workspaces/${encodeURIComponent(id)}/rename`, { name });
  notifyWorkspacesChanged();
}

export async function removeWorkspace(id: string): Promise<void> {
  await requestJson(`/api/workspaces/${encodeURIComponent(id)}`, { method: 'DELETE' });
  notifyWorkspacesChanged();
}

export async function setWorkspacesDirectory(directory: string | null, migrate: boolean) {
  const result = await post<{ moved: string[]; failed: Array<{ name: string; error: string }> }>('/api/workspaces/directory', { directory, migrate });
  notifyWorkspacesChanged();
  return result;
}

/** Opens a workspace's folder in the system file manager of the device the Hub runs on. */
export async function openWorkspaceFolder(browseId: string): Promise<void> {
  await post('/api/workspaces/open-folder', { browseId });
}

/** The id the workspace pickers and grants use for a workspace the user added. */
export const userWorkspaceTargetId = (id: string) => `host:workspace-${id}`;

const CHANGED_EVENT = 'drone-hub:workspaces-changed';

/** Tells open pickers and switchers in this window that the list of workspaces changed. */
export function notifyWorkspacesChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED_EVENT));
}

/** Changes made in this window at once, and changes made anywhere else through the Hub's event stream. */
export function subscribeWorkspacesChanged(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(CHANGED_EVENT, callback);
  const unsubscribeHub = subscribeDesktopEvents({ handlers: { workspaces_changed: () => callback() } });
  return () => {
    window.removeEventListener(CHANGED_EVENT, callback);
    unsubscribeHub();
  };
}

/** The desktop app's folder dialog, when this window has one. */
export function folderDialog(): ((options?: { title?: string; defaultPath?: string }) => Promise<string | null>) | null {
  const choose = typeof window !== 'undefined' ? window.droneHubDesktop?.chooseFolder : undefined;
  return choose ? (options) => choose(options) : null;
}

export function openWorkspacesSettings(): void {
  const ui = useDroneHubUiStore.getState();
  ui.setSettingsActiveTab('workspaces');
  ui.setAppView('settings');
}
