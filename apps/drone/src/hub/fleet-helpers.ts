export type FleetRelationshipConfig = {
  assigned: string[];
  createdBy: string | null;
  createdAt: string | null;
};

function normalizeUniqueStringList(raw: unknown): string[] {
  return Array.isArray(raw)
    ? Array.from(new Set(raw.map((item) => String(item ?? '').trim()).filter(Boolean)))
    : [];
}

function lifecycleEntryByRef(
  regAny: any,
  refRaw: unknown,
): { key: string; entry: any; kind: 'real' | 'pending' } | null {
  const ref = String(refRaw ?? '').trim();
  if (!ref) return null;
  if (regAny?.drones?.[ref]) return { key: ref, entry: regAny.drones[ref], kind: 'real' };
  if (regAny?.pending?.[ref]) return { key: ref, entry: regAny.pending[ref], kind: 'pending' };
  for (const [key, entry] of Object.entries(regAny?.drones ?? {})) {
    if (String((entry as any)?.id ?? '').trim() === ref) {
      return { key, entry, kind: 'real' };
    }
  }
  for (const [key, entry] of Object.entries(regAny?.pending ?? {})) {
    if (String((entry as any)?.id ?? '').trim() === ref) {
      return { key, entry, kind: 'pending' };
    }
  }
  return null;
}

function stableLifecycleId(key: string, entry: any): string {
  return String(entry?.id ?? '').trim() || key;
}

export function fleetActorConfig(entry: any): FleetRelationshipConfig {
  const raw = entry?.fleet && typeof entry.fleet === 'object' ? entry.fleet : {};
  return {
    assigned: normalizeUniqueStringList(raw.assigned),
    createdBy: typeof raw.createdBy === 'string' && raw.createdBy.trim() ? raw.createdBy.trim() : null,
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt.trim() ? raw.createdAt.trim() : null,
  };
}

export function setFleetActorConfig(entry: any, config: FleetRelationshipConfig): any {
  entry.fleet = {
    assigned: normalizeUniqueStringList(config.assigned),
    createdBy: typeof config.createdBy === 'string' && config.createdBy.trim() ? config.createdBy.trim() : null,
    createdAt: typeof config.createdAt === 'string' && config.createdAt.trim() ? config.createdAt.trim() : null,
  };
  return entry;
}

export function fleetChildrenForActor(
  regAny: any,
  actorId: string,
): Array<{ id: string; name: string; kind: 'real' | 'pending'; phase?: string | null }> {
  const out: Array<{ id: string; name: string; kind: 'real' | 'pending'; phase?: string | null }> = [];
  const actor = lifecycleEntryByRef(regAny, actorId);
  const actorRefs = new Set(
    [actorId, actor?.key, actor ? stableLifecycleId(actor.key, actor.entry) : ''].filter(Boolean),
  );
  for (const [key, entry] of Object.entries(regAny?.drones ?? {})) {
    if (!actorRefs.has(fleetActorConfig(entry).createdBy ?? '')) continue;
    const id = stableLifecycleId(key, entry);
    out.push({ id, name: String((entry as any)?.name ?? id), kind: 'real', phase: null });
  }
  for (const [key, entry] of Object.entries(regAny?.pending ?? {})) {
    if (!actorRefs.has(fleetActorConfig(entry).createdBy ?? '')) continue;
    const id = stableLifecycleId(key, entry);
    out.push({
      id,
      name: String((entry as any)?.name ?? id),
      kind: 'pending',
      phase: typeof (entry as any)?.phase === 'string' ? String((entry as any).phase) : null,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function fleetDescendantIdsForActor(regAny: any, actorIdRaw: unknown): string[] {
  const actorId = String(actorIdRaw ?? '').trim();
  if (!actorId) return [];
  const descendants = new Set<string>();
  const visited = new Set<string>();
  const visit = (parentIdRaw: unknown) => {
    const parentId = String(parentIdRaw ?? '').trim();
    if (!parentId || visited.has(parentId)) return;
    visited.add(parentId);
    for (const child of fleetChildrenForActor(regAny, parentId)) {
      const childId = String(child.id ?? '').trim();
      if (!childId || childId === actorId || descendants.has(childId)) continue;
      descendants.add(childId);
      visit(childId);
    }
  };
  visit(actorId);
  return Array.from(descendants);
}

export function fleetActorPayload(regAny: any, actorId: string) {
  const actor = lifecycleEntryByRef(regAny, actorId);
  if (!actor || actor.kind !== 'real') throw new Error(`unknown drone: ${actorId}`);
  const actorEntry = actor.entry;
  const actorStableId = stableLifecycleId(actor.key, actorEntry);
  const actorConfig = fleetActorConfig(actorEntry);
  const children = fleetChildrenForActor(regAny, actorStableId);
  const assigned = actorConfig.assigned
    .map((targetRef) => {
      const target = lifecycleEntryByRef(regAny, targetRef);
      if (!target) return null;
      return {
        id: stableLifecycleId(target.key, target.entry),
        name: String(target.entry?.name ?? target.key),
        kind: target.kind,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item != null);
  const availableTargets = Object.entries(regAny?.drones ?? {})
    .map(([key, entry]) => ({ key, entry, id: stableLifecycleId(key, entry) }))
    .filter(({ id }) => id !== actorStableId)
    .map(({ key, entry, id }) => ({
      id,
      name: String((entry as any)?.name ?? id),
      assigned: actorConfig.assigned.some((ref) => {
        const target = lifecycleEntryByRef(regAny, ref);
        return target ? stableLifecycleId(target.key, target.entry) === id : ref === key;
      }),
      child: children.some((item) => item.id === id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    ok: true,
    actor: { id: actorStableId, name: String(actorEntry?.name ?? actorStableId) },
    relationships: { children, assigned },
    availableTargets,
  };
}
