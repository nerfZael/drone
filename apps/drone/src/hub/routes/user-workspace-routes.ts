import type { HubRouteContext, HubRouter } from '../hub-router';
import type { HubAssistantService } from '../assistant';
import { localWorkspaceOptions } from '../assistant/chat-workspace-access';
import { listHostWorkspaces } from '../assistant/host-workspaces';
import path from 'node:path';
import { listedFolderWorkspaces } from '../folder-workspaces';
import type { UserWorkspaces } from '../user-workspaces';
import { openWorkspaceFolder } from '../open-folder';

/** One workspace the explorer can show: `browseId` is what the file routes take for it. */
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

/**
 * Settings → Workspaces manages the workspaces the user adds on this device; `/api/workspaces/browse` lists every
 * local workspace the explorer's switcher can point at (folders on other devices are not browsable yet).
 */
export function registerUserWorkspaceRoutes(
  router: HubRouter,
  deps: {
    workspaces: UserWorkspaces;
    inventory: () => ReturnType<HubAssistantService['workspaceInventory']>;
  },
) {
  const { workspaces } = deps;
  const statusOf = (error: any) => (typeof error?.status === 'number' ? error.status : 400);
  const handle = (run: (input: { params: Readonly<Record<string, string>>; body: any }) => Promise<unknown>) =>
    async ({ params, readJson, json, fail, method }: HubRouteContext) => {
      try {
        const body = method === 'GET' || method === 'DELETE' ? null : await readJson();
        const result = await run({ params, body });
        json(200, { ok: true, ...(result && typeof result === 'object' ? result : {}) });
      } catch (error: any) {
        fail(statusOf(error), error?.message ?? String(error));
      }
    };

  router.get('/api/workspaces', handle(async () => await workspaces.state()));
  router.post('/api/workspaces', handle(async ({ body }) => ({ workspace: await workspaces.create(body?.name) })));
  router.post('/api/workspaces/link', handle(async ({ body }) => {
    // A repository or host drone folder is already a workspace: adding it again would list it twice.
    const text = String(body?.path ?? '').trim();
    const existing = path.isAbsolute(text)
      ? (await listHostWorkspaces()).find((item) => !item.userWorkspace && item.path === path.resolve(text))
      : undefined;
    if (existing) {
      throw Object.assign(new Error(`${existing.path} is already a workspace (${existing.repository ? 'repository' : 'folder'} “${existing.name}”). Grant it from the workspace picker.`), { status: 409 });
    }
    return { workspace: await workspaces.link(body?.path, body?.name) };
  }));
  router.post('/api/workspaces/directory', handle(async ({ body }) => await workspaces.setDirectory(body?.directory ?? null, body?.migrate === true)));
  router.post('/api/workspaces/:id/rename', handle(async ({ params, body }) => { await workspaces.rename(params.id, body?.name); }));
  router.delete('/api/workspaces/:id', handle(async ({ params }) => { await workspaces.remove(params.id); }));
  router.get('/api/workspaces/browse', handle(async () => ({ workspaces: await browsableWorkspaces(deps.inventory) })));
  // The File Explorer's "Open in file manager": the folder opens on the device the Hub runs on.
  router.post('/api/workspaces/open-folder', handle(async ({ body }) => await openWorkspaceFolder(String(body?.browseId ?? ''))));
}

export async function browsableWorkspaces(
  inventory: () => ReturnType<HubAssistantService['workspaceInventory']>,
): Promise<BrowsableWorkspace[]> {
  const [state, homes] = await Promise.all([inventory(), listedFolderWorkspaces()]);
  // The device identity only labels grants; browsing never leaves this device.
  const { hostOptions, droneOptions } = localWorkspaceOptions(state, { id: 'local', name: 'This device' });
  const folders: BrowsableWorkspace[] = hostOptions.map((option) => ({
    id: option.id,
    browseId: option.id,
    name: option.name,
    kind: 'folder',
    category: (option as { userWorkspace?: boolean }).userWorkspace
      ? 'Workspaces'
      : option.repository
        ? 'Repositories'
        : option.runtime === 'host'
          ? 'Host drones'
          : 'Folders',
    ...(option.path ? { path: option.path } : {}),
    ...(option.status ? { status: option.status } : {}),
  }));
  const drones: BrowsableWorkspace[] = droneOptions
    .filter((option) => option.runtime !== 'host')
    .map((option) => ({
      id: option.id,
      browseId: option.droneId!,
      name: option.name,
      kind: 'drone',
      category: 'Container drones',
      droneId: option.droneId!,
      ...(option.status ? { status: option.status } : {}),
    }));
  return [
    ...homes.map((home): BrowsableWorkspace => ({ id: home.id, browseId: home.id, name: home.name, kind: 'folder', category: 'Home', path: home.path })),
    ...folders,
    ...drones,
  ];
}
