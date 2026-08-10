import type { HubRouter } from '../hub-router';
import type { HubServices } from '../application/hub-services';

export interface FleetRouteDependencies {
  fleet: HubServices['fleet'];
}

export function registerFleetRoutes(apiRouter: HubRouter, deps: FleetRouteDependencies): void {
  const { fleet } = deps;

  apiRouter.get('/api/fleet/actors/:droneRef', async ({ params, json }) => {
    json(200, await fleet.get(params.droneRef));
  });

  apiRouter.post('/api/fleet/actors/:droneRef/parent', async ({ params, readJson, json }) => {
    const body = await readJson<any>();
    const parentRef =
      body?.parent == null
        ? ''
        : typeof body?.parent === 'string'
          ? body.parent.trim()
          : String(body.parent ?? '').trim();
    json(
      200,
      await fleet.setDroneParent({ droneRef: params.droneRef, parentRef: parentRef || null }),
    );
  });

  apiRouter.post(
    '/api/fleet/actors/:droneRef/assigned',
    async ({ params, readJson, json }) => {
      const body = await readJson<any>();
      json(
        200,
        await fleet.assign({
          droneRef: params.droneRef,
          targetRef: String(body?.target ?? '').trim(),
        }),
      );
    },
  );

  apiRouter.delete(
    '/api/fleet/actors/:droneRef/assigned/:targetRef',
    async ({ params, json }) => {
      json(
        200,
        await fleet.unassign({ droneRef: params.droneRef, targetRef: params.targetRef }),
      );
    },
  );
}
