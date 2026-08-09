import type { HubRouter } from '../hub-router';
import type { SidebarCommandService } from '../sidebar-command-service';
import { describeHubError } from '../domain-errors';

export function registerSidebarRoutes(
  router: HubRouter,
  sidebarCommands: SidebarCommandService,
): void {
  router.post('/api/sidebar/move', async ({ readJson, json }) => {
    try {
      json(200, await sidebarCommands.move(await readJson<unknown>()));
    } catch (error: any) {
      if (error?.code === 'INVALID_REQUEST' || error?.code === 'OPERATION_FAILED') {
        json(error.code === 'INVALID_REQUEST' ? 400 : 422, {
          ok: false,
          error: error?.message ?? String(error),
        });
        return;
      }
      const descriptor = describeHubError(error);
      json(descriptor.statusCode, descriptor.body);
    }
  });
}
