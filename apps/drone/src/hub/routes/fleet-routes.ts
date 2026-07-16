import { errorMessage } from '../hub-http';
import type { HubRouter } from '../hub-router';

type ServiceFunction = (...args: any[]) => any;

export interface FleetRouteDependencies {
  resolveDroneOrRespond: ServiceFunction;
  loadRegistry: ServiceFunction;
  fleetActorPayload: ServiceFunction;
  findDroneIdByRef: ServiceFunction;
  resolveStableDroneOrPendingIdFromRef: ServiceFunction;
  fleetDescendantIdsForActor: ServiceFunction;
  updateDroneFleetMetadata: ServiceFunction;
  fleetActorConfig: ServiceFunction;
  fleetError: ServiceFunction;
}

export function registerFleetRoutes(apiRouter: HubRouter, deps: FleetRouteDependencies): void {
  const {
    resolveDroneOrRespond,
    loadRegistry,
    fleetActorPayload,
    findDroneIdByRef,
    resolveStableDroneOrPendingIdFromRef,
    fleetDescendantIdsForActor,
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

  apiRouter.post('/api/fleet/actors/:droneRef/parent', async ({ res, params, readJson, json }) => {
    const resolved = await resolveDroneOrRespond(res, params.droneRef);
    if (!resolved) return;
    const body = await readJson<any>();
    const parentRef =
      body?.parent == null
        ? ''
        : typeof body?.parent === 'string'
          ? body.parent.trim()
          : String(body.parent ?? '').trim();
    try {
      let nextParentId: string | null = null;
      const registry = await loadRegistry();
      if (parentRef) {
        const parentFound = findDroneIdByRef(registry, parentRef);
        if (!parentFound) throw fleetError(`unknown drone: ${parentRef}`, 404);
        nextParentId = resolveStableDroneOrPendingIdFromRef(registry, parentRef);
        if (!nextParentId) throw fleetError(`unknown drone: ${parentRef}`, 404);
        if (nextParentId === resolved.id) {
          throw fleetError('cannot make a drone its own parent', 400);
        }
        if (fleetDescendantIdsForActor(registry, resolved.id).includes(nextParentId)) {
          throw fleetError('cannot reparent a drone beneath one of its descendants', 400);
        }
      }
      await updateDroneFleetMetadata({
        droneId: resolved.id,
        transform: (fleet: any) => ({ ...fleet, createdBy: nextParentId }),
      });
      json(200, { ok: true, id: resolved.id, parentId: nextParentId });
    } catch (error: any) {
      json(Number(error?.status ?? 500), { ok: false, error: errorMessage(error) });
    }
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
