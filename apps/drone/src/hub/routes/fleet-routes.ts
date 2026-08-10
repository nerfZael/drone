import { errorMessage } from '../hub-http';
import type { HubRouter } from '../hub-router';

type ServiceFunction = (...args: any[]) => any;

export interface FleetRouteDependencies {
  resolveDroneOrRespond: ServiceFunction;
  loadRegistry: ServiceFunction;
  fleetActorPayload: ServiceFunction;
  setDroneParent: ServiceFunction;
  findDroneIdByRef: ServiceFunction;
  updateDroneFleetMetadata: ServiceFunction;
  fleetActorConfig: ServiceFunction;
  fleetError: ServiceFunction;
}

export function registerFleetRoutes(apiRouter: HubRouter, deps: FleetRouteDependencies): void {
  const {
    resolveDroneOrRespond,
    loadRegistry,
    fleetActorPayload,
    setDroneParent,
    findDroneIdByRef,
    updateDroneFleetMetadata,
    fleetActorConfig,
    fleetError,
  } = deps;

  apiRouter.get('/api/fleet/actors/:droneRef', async ({ res, params, json }) => {
    const resolved = await resolveDroneOrRespond(res, params.droneRef);
    if (!resolved) return;
    try {
      const registry = await loadRegistry();
      json(200, fleetActorPayload(registry, resolved.id));
    } catch (error) {
      json(500, { ok: false, error: errorMessage(error) });
    }
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
      await setDroneParent({ droneRef: params.droneRef, parentRef: parentRef || null }),
    );
  });

  apiRouter.post(
    '/api/fleet/actors/:droneRef/assigned',
    async ({ res, params, readJson, json }) => {
      const resolved = await resolveDroneOrRespond(res, params.droneRef);
      if (!resolved) return;
      const body = await readJson<any>();
      const targetRef = String(body?.target ?? '').trim();
      if (!targetRef) {
        json(400, { ok: false, error: 'missing target' });
        return;
      }
      try {
        const registry = await loadRegistry();
        const targetFound = findDroneIdByRef(registry, targetRef);
        if (!targetFound) throw fleetError(`unknown drone: ${targetRef}`, 404);
        if (targetFound.id === resolved.id) throw fleetError('cannot assign actor to itself', 400);
        await updateDroneFleetMetadata({
          droneId: resolved.id,
          transform: (fleet: any) => {
            const current = fleetActorConfig({ fleet });
            return {
              ...fleet,
              assigned: Array.from(new Set([...current.assigned, targetFound.id])),
            };
          },
        });
        json(200, fleetActorPayload(await loadRegistry(), resolved.id));
      } catch (error: any) {
        json(Number(error?.status ?? 500), { ok: false, error: errorMessage(error) });
      }
    },
  );

  apiRouter.delete(
    '/api/fleet/actors/:droneRef/assigned/:targetRef',
    async ({ res, params, json }) => {
      const resolved = await resolveDroneOrRespond(res, params.droneRef);
      if (!resolved) return;
      try {
        const registry = await loadRegistry();
        const targetFound = findDroneIdByRef(registry, params.targetRef);
        const targetId = targetFound?.id ?? params.targetRef;
        await updateDroneFleetMetadata({
          droneId: resolved.id,
          transform: (fleet: any) => {
            const current = fleetActorConfig({ fleet });
            return {
              ...fleet,
              assigned: current.assigned.filter((id: string) => id !== targetId),
            };
          },
        });
        json(200, fleetActorPayload(await loadRegistry(), resolved.id));
      } catch (error: any) {
        json(Number(error?.status ?? 500), { ok: false, error: errorMessage(error) });
      }
    },
  );
}
