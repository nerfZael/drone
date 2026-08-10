import { loadRegistry } from '../../host/registry';
import { findDroneIdByRef } from '../drone-lifecycle-registry';
import { resolveDroneOrPendingForReadRef } from '../drone-lifecycle-service';
import { updateDroneFleetMetadata } from '../drone-metadata-commands';
import { fleetActorConfig, fleetActorPayload } from '../fleet-helpers';
import { DomainConflictError, InvalidRequestError, ResourceNotFoundError } from '../domain-errors';

export type FleetActorService = ReturnType<typeof createFleetActorService>;

export type FleetActorDependencies = {
  resolveDrone(ref: string): Promise<{ id: string; kind: 'real' | 'pending' } | null>;
  loadRegistry(): Promise<any>;
  findDroneIdByRef(registry: any, ref: string): { id: string } | null | undefined;
  updateDroneFleetMetadata(input: {
    droneId: string;
    transform(fleet: Record<string, any>): Record<string, any>;
  }): Promise<unknown>;
  fleetActorConfig(entry: any): { assigned: string[] };
  fleetActorPayload(registry: any, actorId: string): any;
};

const defaultDependencies: FleetActorDependencies = {
  resolveDrone: resolveDroneOrPendingForReadRef,
  loadRegistry,
  findDroneIdByRef,
  updateDroneFleetMetadata,
  fleetActorConfig,
  fleetActorPayload,
};

export function createFleetActorService(overrides: Partial<FleetActorDependencies> = {}) {
  const dependencies: FleetActorDependencies = { ...defaultDependencies, ...overrides };
  return {
    get: async (droneRef: string) => {
      const actorId = await resolveActorId(droneRef, dependencies);
      return dependencies.fleetActorPayload(await dependencies.loadRegistry(), actorId);
    },
    assign: async (input: { droneRef: string; targetRef: string }) => {
      const actorId = await resolveActorId(input.droneRef, dependencies);
      const targetRef = String(input.targetRef ?? '').trim();
      if (!targetRef) throw new InvalidRequestError('missing target');
      const registry = await dependencies.loadRegistry();
      const target = dependencies.findDroneIdByRef(registry, targetRef);
      if (!target) throw new ResourceNotFoundError(`unknown drone: ${targetRef}`);
      if (target.id === actorId) throw new InvalidRequestError('cannot assign actor to itself');
      await dependencies.updateDroneFleetMetadata({
        droneId: actorId,
        transform: (fleet) => {
          const current = dependencies.fleetActorConfig({ fleet });
          return {
            ...fleet,
            assigned: Array.from(new Set([...current.assigned, target.id])),
          };
        },
      });
      return dependencies.fleetActorPayload(await dependencies.loadRegistry(), actorId);
    },
    unassign: async (input: { droneRef: string; targetRef: string }) => {
      const actorId = await resolveActorId(input.droneRef, dependencies);
      const registry = await dependencies.loadRegistry();
      const target = dependencies.findDroneIdByRef(registry, input.targetRef);
      const targetId = target?.id ?? input.targetRef;
      await dependencies.updateDroneFleetMetadata({
        droneId: actorId,
        transform: (fleet) => {
          const current = dependencies.fleetActorConfig({ fleet });
          return {
            ...fleet,
            assigned: current.assigned.filter((id) => id !== targetId),
          };
        },
      });
      return dependencies.fleetActorPayload(await dependencies.loadRegistry(), actorId);
    },
  };
}

async function resolveActorId(
  droneRef: string,
  dependencies: Pick<FleetActorDependencies, 'resolveDrone'>,
): Promise<string> {
  const ref = String(droneRef ?? '').trim();
  if (!ref) throw new InvalidRequestError('missing drone');
  const resolved = await dependencies.resolveDrone(ref);
  if (!resolved) throw new ResourceNotFoundError(`unknown drone: ${ref}`);
  if (resolved.kind === 'pending') {
    throw new DomainConflictError(`drone "${ref}" is still starting`);
  }
  return resolved.id;
}
