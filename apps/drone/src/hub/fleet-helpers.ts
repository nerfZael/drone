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
  for (const [id, entry] of Object.entries(regAny?.drones ?? {})) {
    if (fleetActorConfig(entry).createdBy !== actorId) continue;
    out.push({ id: String(id), name: String((entry as any)?.name ?? id), kind: 'real', phase: null });
  }
  for (const [id, entry] of Object.entries(regAny?.pending ?? {})) {
    if (fleetActorConfig(entry).createdBy !== actorId) continue;
    out.push({
      id: String(id),
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
  const actorEntry = regAny?.drones?.[actorId];
  if (!actorEntry) throw new Error(`unknown drone: ${actorId}`);
  const actorConfig = fleetActorConfig(actorEntry);
  const children = fleetChildrenForActor(regAny, actorId);
  const assigned = actorConfig.assigned
    .map((targetId) => {
      const target = regAny?.drones?.[targetId] ?? regAny?.pending?.[targetId] ?? null;
      if (!target) return null;
      return {
        id: targetId,
        name: String(target?.name ?? targetId),
        kind: regAny?.drones?.[targetId] ? ('real' as const) : ('pending' as const),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item != null);
  const availableTargets = Object.entries(regAny?.drones ?? {})
    .filter(([id]) => String(id) !== actorId)
    .map(([id, entry]) => ({
      id: String(id),
      name: String((entry as any)?.name ?? id),
      assigned: actorConfig.assigned.includes(String(id)),
      child: children.some((item) => item.id === id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    ok: true,
    actor: { id: actorId, name: String(actorEntry?.name ?? actorId) },
    relationships: { children, assigned },
    availableTargets,
  };
}
