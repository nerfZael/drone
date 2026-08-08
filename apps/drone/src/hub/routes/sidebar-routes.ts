import type { HubRouter } from '../hub-router';
import type { SidebarCommandService } from '../sidebar-command-service';

export function registerSidebarRoutes(
  router: HubRouter,
  sidebarCommands: SidebarCommandService,
): void {
  router.post('/api/sidebar/move', async ({ readJson, json }) => {
    try {
      json(200, await sidebarCommands.move(await readJson<unknown>()));
    } catch (error: any) {
      const upstreamStatus = /^HUB_(\d{3})$/.exec(String(error?.code ?? ''))?.[1];
      const status =
        error?.code === 'INVALID_REQUEST'
          ? 400
          : error?.code === 'OPERATION_FAILED'
            ? 422
            : Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
              ? Number(error.status)
              : upstreamStatus && Number(upstreamStatus) >= 400 && Number(upstreamStatus) < 500
                ? Number(upstreamStatus)
                : 500;
      json(status, { ok: false, error: error?.message ?? String(error) });
    }
  });
}
