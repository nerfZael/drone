import { loadRegistry } from '../../host/registry';
import { DomainConflictError, InvalidRequestError, ResourceNotFoundError } from '../domain-errors';
import { fleetDescendantIdsForActor } from '../fleet-helpers';
import {
  findDroneIdByRef,
  resolveStableDroneOrPendingIdFromRef,
} from '../drone-lifecycle-registry';
import { resolveDroneOrPendingForReadRef } from '../drone-lifecycle-service';
import { updateDroneFleetMetadata } from '../drone-metadata-commands';

export type SetDroneParentResult = {
  ok: true;
  id: string;
  parentId: string | null;
};

export type SetDroneParentDependencies = {
  resolveDrone(ref: string): Promise<{ kind: 'real' | 'pending'; id: string } | null>;
  loadRegistry(): Promise<any>;
  findDroneIdByRef(registry: any, ref: string): { id: string } | null | undefined;
  resolveStableDroneOrPendingIdFromRef(registry: any, ref: string): string | null;
  fleetDescendantIdsForActor(registry: any, actorId: string): string[];
  updateDroneFleetMetadata(input: {
    droneId: string;
    transform(fleet: Record<string, any>): Record<string, any>;
  }): Promise<unknown>;
};

const defaultDependencies: SetDroneParentDependencies = {
  resolveDrone: resolveDroneOrPendingForReadRef,
  loadRegistry,
  findDroneIdByRef,
  resolveStableDroneOrPendingIdFromRef,
  fleetDescendantIdsForActor,
  updateDroneFleetMetadata,
};

export async function setDroneParent(
  input: { droneRef: string; parentRef: string | null },
  dependencies: SetDroneParentDependencies = defaultDependencies,
): Promise<SetDroneParentResult> {
  const droneRef = String(input.droneRef ?? '').trim();
  if (!droneRef) throw new InvalidRequestError('missing drone');
  const resolved = await dependencies.resolveDrone(droneRef);
  if (!resolved) throw new ResourceNotFoundError(`unknown drone: ${droneRef}`);
  if (resolved.kind !== 'real') {
    throw new DomainConflictError(`drone "${droneRef}" is still starting`);
  }

  const parentRef = String(input.parentRef ?? '').trim();
  const registry = await dependencies.loadRegistry();
  let parentId: string | null = null;
  if (parentRef) {
    if (!dependencies.findDroneIdByRef(registry, parentRef)) {
      throw new ResourceNotFoundError(`unknown drone: ${parentRef}`);
    }
    parentId = dependencies.resolveStableDroneOrPendingIdFromRef(registry, parentRef);
    if (!parentId) throw new ResourceNotFoundError(`unknown drone: ${parentRef}`);
    if (parentId === resolved.id) {
      throw new InvalidRequestError('cannot make a drone its own parent');
    }
    if (dependencies.fleetDescendantIdsForActor(registry, resolved.id).includes(parentId)) {
      throw new InvalidRequestError('cannot reparent a drone beneath one of its descendants');
    }
  }

  await dependencies.updateDroneFleetMetadata({
    droneId: resolved.id,
    transform: (fleet) => ({ ...fleet, createdBy: parentId }),
  });
  return { ok: true, id: resolved.id, parentId };
}
