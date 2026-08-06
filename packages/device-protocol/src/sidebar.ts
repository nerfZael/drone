export type SidebarDropPlacement = 'before' | 'inside' | 'after';

export type SidebarReorderIntent =
  | {
      kind: 'tree-entry';
      parentId: string;
      siblingNodeIds: string[];
      activeNodeId: string;
      overNodeId: string;
      placement: Exclude<SidebarDropPlacement, 'inside'>;
    }
  | {
      kind: 'drone';
      parentId: string;
      siblingDroneIds: string[];
      activeDroneId: string;
      overDroneId: string;
      placement: Exclude<SidebarDropPlacement, 'inside'>;
    }
  | {
      kind: 'chat';
      droneId: string;
      chatNames: string[];
      activeChatName: string;
      overChatName: string;
      placement: Exclude<SidebarDropPlacement, 'inside'>;
    }
  | {
      kind: 'pinned-drone';
      visibleDroneIds: string[];
      activeDroneId: string;
      overDroneId: string;
      placement: Exclude<SidebarDropPlacement, 'inside'>;
    };

export type SidebarMoveIntoFolderIntent =
  | {
      kind: 'move-into-folder';
      itemKind: 'drone';
      repoPath: string;
      droneId: string;
      sourceParentId: string;
      sourceSiblingNodeIds: string[];
      targetGroup: string | null;
      targetParentId: string;
      targetSiblingNodeIds: string[];
      targetOverNodeId?: string;
      placement?: SidebarDropPlacement;
    }
  | {
      kind: 'move-into-folder';
      itemKind: 'folder';
      repoPath: string;
      sourceGroup: string;
      sourceNodeId: string;
      sourceParentId: string;
      sourceSiblingNodeIds: string[];
      targetGroup: string | null;
      targetParentId: string;
      targetSiblingNodeIds: string[];
      targetOverNodeId?: string;
      placement?: SidebarDropPlacement;
    };

export type SidebarMoveIntent = SidebarReorderIntent | SidebarMoveIntoFolderIntent;

export type SidebarLayoutState = {
  sidebarNodeOrderByParent: Record<string, string[]>;
  sidebarChatOrderByDrone: Record<string, string[]>;
  pinnedDroneIds: string[];
};

export type SidebarLayoutPatch = Partial<SidebarLayoutState>;

function cleanStrings(values: unknown): string[] {
  return Array.isArray(values)
    ? [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]
    : [];
}

function cleanStringMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([keyRaw, entries]) => {
      const key = keyRaw.trim();
      const list = cleanStrings(entries);
      return key && list.length ? [[key, list] as const] : [];
    }),
  );
}

export function normalizeSidebarLayout(value: unknown): SidebarLayoutState {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    sidebarNodeOrderByParent: cleanStringMap(source.sidebarNodeOrderByParent),
    sidebarChatOrderByDrone: cleanStringMap(source.sidebarChatOrderByDrone),
    pinnedDroneIds: cleanStrings(source.pinnedDroneIds),
  };
}

export function sidebarLayoutPatch(
  layout: SidebarLayoutState,
  intent: SidebarMoveIntent,
): SidebarLayoutPatch {
  if (intent.kind === 'chat') return { sidebarChatOrderByDrone: layout.sidebarChatOrderByDrone };
  if (intent.kind === 'pinned-drone') return { pinnedDroneIds: layout.pinnedDroneIds };
  return { sidebarNodeOrderByParent: layout.sidebarNodeOrderByParent };
}

export function firstSidebarInsertionTarget(
  childNodeIds: readonly string[] | undefined,
  activeNodeId: string,
): string | undefined {
  return childNodeIds?.find((nodeId) => nodeId !== activeNodeId);
}

export function reorderSidebarEntries(
  currentOrder: readonly string[],
  visibleEntries: readonly string[],
  activeEntry: string,
  overEntry: string,
  dropPlacement: Exclude<SidebarDropPlacement, 'inside'>,
): string[] {
  const active = String(activeEntry ?? '').trim();
  const over = String(overEntry ?? '').trim();
  const visible = cleanStrings(visibleEntries);
  const current = cleanStrings(currentOrder);
  if (!active || !over || active === over || !visible.includes(active) || !visible.includes(over)) {
    return current;
  }
  const visibleSet = new Set(visible);
  const complete = completeSidebarOrder(current, visible);
  const reorderedVisible = complete
    .filter((entry) => visibleSet.has(entry))
    .filter((entry) => entry !== active);
  const overIndex = reorderedVisible.indexOf(over);
  if (overIndex < 0) return current;
  reorderedVisible.splice(dropPlacement === 'before' ? overIndex : overIndex + 1, 0, active);
  let visibleIndex = 0;
  const merged = complete.map((entry) =>
    visibleSet.has(entry) ? (reorderedVisible[visibleIndex++] ?? entry) : entry,
  );
  return [...merged, ...reorderedVisible.slice(visibleIndex)];
}

const droneNodeId = (droneId: string) => `drone:${String(droneId ?? '').trim()}`;

export function applySidebarReorder<T extends SidebarLayoutState>(
  layout: T,
  intent: SidebarReorderIntent,
): T {
  if (intent.kind === 'tree-entry') {
    return {
      ...layout,
      sidebarNodeOrderByParent: {
        ...layout.sidebarNodeOrderByParent,
        [intent.parentId]: reorderSidebarEntries(
          layout.sidebarNodeOrderByParent[intent.parentId] ?? [],
          intent.siblingNodeIds,
          intent.activeNodeId,
          intent.overNodeId,
          intent.placement,
        ),
      },
    };
  }
  if (intent.kind === 'chat') {
    return {
      ...layout,
      sidebarChatOrderByDrone: {
        ...layout.sidebarChatOrderByDrone,
        [intent.droneId]: reorderSidebarEntries(
          layout.sidebarChatOrderByDrone[intent.droneId] ?? [],
          intent.chatNames,
          intent.activeChatName,
          intent.overChatName,
          intent.placement,
        ),
      },
    };
  }
  if (intent.kind === 'pinned-drone') {
    return {
      ...layout,
      pinnedDroneIds: reorderSidebarEntries(
        layout.pinnedDroneIds,
        intent.visibleDroneIds,
        intent.activeDroneId,
        intent.overDroneId,
        intent.placement,
      ),
    };
  }
  const visibleNodeIds = intent.siblingDroneIds.map(droneNodeId);
  return {
    ...layout,
    sidebarNodeOrderByParent: {
      ...layout.sidebarNodeOrderByParent,
      [intent.parentId]: reorderSidebarEntries(
        layout.sidebarNodeOrderByParent[intent.parentId] ?? [],
        visibleNodeIds,
        droneNodeId(intent.activeDroneId),
        droneNodeId(intent.overDroneId),
        intent.placement,
      ),
    },
  };
}

function normalizeGroupPath(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/[\\/]+/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

function groupBaseName(value: string): string {
  const parts = normalizeGroupPath(value).split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

function containsGroup(pathValue: string | null, parentValue: string): boolean {
  const path = normalizeGroupPath(pathValue);
  const parent = normalizeGroupPath(parentValue);
  return Boolean(path && parent && (path === parent || path.startsWith(`${parent}/`)));
}

export function sidebarMoveDestination(
  intent: SidebarMoveIntoFolderIntent,
): { targetGroup: string | null; nextGroup: string | null } | null {
  const targetGroup = normalizeGroupPath(intent.targetGroup) || null;
  if (intent.itemKind === 'drone') return { targetGroup, nextGroup: null };
  const sourceGroup = normalizeGroupPath(intent.sourceGroup);
  if (!sourceGroup || (targetGroup != null && containsGroup(targetGroup, sourceGroup))) return null;
  const nextGroup = [targetGroup, groupBaseName(sourceGroup)].filter(Boolean).join('/');
  return nextGroup && nextGroup !== sourceGroup ? { targetGroup, nextGroup } : null;
}

function withoutNode(values: readonly string[], nodeId: string): string[] {
  return cleanStrings(values).filter((value) => value !== nodeId);
}

function completeSidebarOrder(
  currentValues: readonly string[],
  visibleValues: readonly string[],
): string[] {
  const current = cleanStrings(currentValues);
  const visible = cleanStrings(visibleValues);
  if (visible.length === 0) return current;
  const visibleSet = new Set(visible);
  const orderedVisible = current.filter((entry) => visibleSet.has(entry));
  if (orderedVisible.length === 0) return [...current, ...visible];

  // Persisted order is authoritative for rows it knows about. Rows that have never been
  // persisted retain their visible gaps around those anchors instead of all jumping to the end.
  const orderedSet = new Set(orderedVisible);
  const gaps = Array.from({ length: orderedVisible.length + 1 }, () => [] as string[]);
  let anchorsSeen = 0;
  for (const entry of visible) {
    if (orderedSet.has(entry)) anchorsSeen += 1;
    else gaps[Math.min(anchorsSeen, gaps.length - 1)]!.push(entry);
  }
  const authoritativeVisible: string[] = [];
  for (let index = 0; index < orderedVisible.length; index += 1) {
    authoritativeVisible.push(...gaps[index]!, orderedVisible[index]!);
  }
  authoritativeVisible.push(...gaps[orderedVisible.length]!);

  let visibleIndex = 0;
  const merged = current.map((entry) =>
    visibleSet.has(entry) ? (authoritativeVisible[visibleIndex++] ?? entry) : entry,
  );
  return [...merged, ...authoritativeVisible.slice(visibleIndex)];
}

function moveNodeOrderIntoFolder(
  map: Record<string, string[]>,
  intent: SidebarMoveIntoFolderIntent,
  sourceNodeId: string,
  targetNodeId: string,
): Record<string, string[]> {
  const next = { ...map };
  const nextSource = withoutNode(
    completeSidebarOrder(map[intent.sourceParentId] ?? [], intent.sourceSiblingNodeIds),
    sourceNodeId,
  );
  if (nextSource.length) next[intent.sourceParentId] = nextSource;
  else delete next[intent.sourceParentId];
  const targetOrder = withoutNode(
    withoutNode(
      completeSidebarOrder(map[intent.targetParentId] ?? [], intent.targetSiblingNodeIds),
      sourceNodeId,
    ),
    targetNodeId,
  );
  const overIndex = intent.targetOverNodeId ? targetOrder.indexOf(intent.targetOverNodeId) : -1;
  const insertIndex =
    intent.placement === 'inside' || overIndex < 0
      ? targetOrder.length
      : overIndex + (intent.placement === 'after' ? 1 : 0);
  targetOrder.splice(insertIndex, 0, targetNodeId);
  next[intent.targetParentId] = targetOrder;
  return next;
}

function rewriteFolderNodeOrder(
  map: Record<string, string[]>,
  sourceNodeId: string,
  targetNodeId: string,
): Record<string, string[]> {
  const rewrite = (nodeId: string) =>
    nodeId === sourceNodeId
      ? targetNodeId
      : nodeId.startsWith(`${sourceNodeId}/`)
        ? `${targetNodeId}/${nodeId.slice(sourceNodeId.length + 1)}`
        : nodeId;
  const result: Record<string, string[]> = {};
  for (const [parentId, entries] of Object.entries(map)) {
    const nextParentId = rewrite(parentId);
    result[nextParentId] = cleanStrings([...(result[nextParentId] ?? []), ...entries.map(rewrite)]);
  }
  return result;
}

export function applySidebarMoveIntoFolder<T extends SidebarLayoutState>(
  layout: T,
  intent: SidebarMoveIntoFolderIntent,
): T {
  const destination = sidebarMoveDestination(intent);
  if (!destination) return layout;
  if (intent.itemKind === 'drone') {
    const nodeId = droneNodeId(intent.droneId);
    return {
      ...layout,
      sidebarNodeOrderByParent: moveNodeOrderIntoFolder(
        layout.sidebarNodeOrderByParent,
        intent,
        nodeId,
        nodeId,
      ),
    };
  }
  const sourceGroup = normalizeGroupPath(intent.sourceGroup);
  const sourceNodePrefix = intent.sourceNodeId.endsWith(sourceGroup)
    ? intent.sourceNodeId.slice(0, -sourceGroup.length)
    : 'folder:';
  const targetNodeId = `${sourceNodePrefix}${destination.nextGroup!}`;
  return {
    ...layout,
    sidebarNodeOrderByParent: rewriteFolderNodeOrder(
      moveNodeOrderIntoFolder(
        layout.sidebarNodeOrderByParent,
        intent,
        intent.sourceNodeId,
        targetNodeId,
      ),
      intent.sourceNodeId,
      targetNodeId,
    ),
  };
}

export function applySidebarMove<T extends SidebarLayoutState>(
  layout: T,
  intent: SidebarMoveIntent,
): T {
  return intent.kind === 'move-into-folder'
    ? applySidebarMoveIntoFolder(layout, intent)
    : applySidebarReorder(layout, intent);
}

/**
 * One user gesture, expressed as intent rather than client-computed persisted state.
 * The destination applies this intent to its latest sidebar revision.
 */
export type SidebarMoveCommandRequest = {
  mutationId: string;
  intent: SidebarMoveIntent;
  expectedVersion?: number | null;
};

export type SidebarMoveCommandResult = {
  ok: true;
  mutationId: string;
  version: number | null;
  uiPreferences: SidebarLayoutState & Record<string, unknown>;
};

function invalidSidebarMove(message: string): never {
  throw Object.assign(new Error(message), { code: 'INVALID_REQUEST' });
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidSidebarMove('sidebar move intent must be an object');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) invalidSidebarMove(`${field} is required`);
  return result;
}

function texts(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) invalidSidebarMove(`${field} must be an array`);
  if (value.some((item) => typeof item !== 'string')) {
    invalidSidebarMove(`${field} must contain only strings`);
  }
  return [...new Set((value as string[]).map((item) => item.trim()).filter(Boolean))];
}

function nullableText(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') invalidSidebarMove(`${field} must be a string or null`);
  return value.trim() || null;
}

function textValue(value: unknown, field: string): string {
  if (typeof value !== 'string') invalidSidebarMove(`${field} must be a string`);
  return value.trim();
}

function placement(value: unknown, inside?: false): Exclude<SidebarDropPlacement, 'inside'>;
function placement(value: unknown, inside: true): SidebarDropPlacement;
function placement(value: unknown, inside = false): SidebarDropPlacement {
  if (value === 'before' || value === 'after' || (inside && value === 'inside')) return value;
  if (inside && value == null) return 'inside';
  invalidSidebarMove(
    `placement must be ${inside ? 'before, inside, or after' : 'before or after'}`,
  );
}

export function parseSidebarMoveCommandRequest(value: unknown): SidebarMoveCommandRequest {
  const source = record(value);
  const rawIntent = record(source.intent);
  const kind = text(rawIntent.kind, 'intent.kind');
  let intent: SidebarMoveIntent;
  if (kind === 'tree-entry') {
    intent = {
      kind,
      parentId: text(rawIntent.parentId, 'intent.parentId'),
      siblingNodeIds: texts(rawIntent.siblingNodeIds, 'intent.siblingNodeIds'),
      activeNodeId: text(rawIntent.activeNodeId, 'intent.activeNodeId'),
      overNodeId: text(rawIntent.overNodeId, 'intent.overNodeId'),
      placement: placement(rawIntent.placement),
    };
  } else if (kind === 'drone') {
    intent = {
      kind,
      parentId: text(rawIntent.parentId, 'intent.parentId'),
      siblingDroneIds: texts(rawIntent.siblingDroneIds, 'intent.siblingDroneIds'),
      activeDroneId: text(rawIntent.activeDroneId, 'intent.activeDroneId'),
      overDroneId: text(rawIntent.overDroneId, 'intent.overDroneId'),
      placement: placement(rawIntent.placement),
    };
  } else if (kind === 'chat') {
    intent = {
      kind,
      droneId: text(rawIntent.droneId, 'intent.droneId'),
      chatNames: texts(rawIntent.chatNames, 'intent.chatNames'),
      activeChatName: text(rawIntent.activeChatName, 'intent.activeChatName'),
      overChatName: text(rawIntent.overChatName, 'intent.overChatName'),
      placement: placement(rawIntent.placement),
    };
  } else if (kind === 'pinned-drone') {
    intent = {
      kind,
      visibleDroneIds: texts(rawIntent.visibleDroneIds, 'intent.visibleDroneIds'),
      activeDroneId: text(rawIntent.activeDroneId, 'intent.activeDroneId'),
      overDroneId: text(rawIntent.overDroneId, 'intent.overDroneId'),
      placement: placement(rawIntent.placement),
    };
  } else if (kind === 'move-into-folder') {
    const itemKind = text(rawIntent.itemKind, 'intent.itemKind');
    const common = {
      kind,
      repoPath: textValue(rawIntent.repoPath, 'intent.repoPath'),
      sourceParentId: text(rawIntent.sourceParentId, 'intent.sourceParentId'),
      sourceSiblingNodeIds: texts(rawIntent.sourceSiblingNodeIds, 'intent.sourceSiblingNodeIds'),
      targetGroup: nullableText(rawIntent.targetGroup, 'intent.targetGroup'),
      targetParentId: text(rawIntent.targetParentId, 'intent.targetParentId'),
      targetSiblingNodeIds: texts(rawIntent.targetSiblingNodeIds, 'intent.targetSiblingNodeIds'),
      ...(rawIntent.targetOverNodeId == null
        ? {}
        : { targetOverNodeId: text(rawIntent.targetOverNodeId, 'intent.targetOverNodeId') }),
      placement: placement(rawIntent.placement, true),
    } as const;
    if (itemKind === 'drone') {
      intent = { ...common, itemKind, droneId: text(rawIntent.droneId, 'intent.droneId') };
    } else if (itemKind === 'folder') {
      intent = {
        ...common,
        itemKind,
        sourceGroup: text(rawIntent.sourceGroup, 'intent.sourceGroup'),
        sourceNodeId: text(rawIntent.sourceNodeId, 'intent.sourceNodeId'),
      };
    } else {
      invalidSidebarMove('intent.itemKind must be drone or folder');
    }
  } else {
    invalidSidebarMove('intent.kind is not supported');
  }
  const mutationId = text(source.mutationId, 'mutationId');
  if (mutationId.length > 200) invalidSidebarMove('mutationId is too long');
  const requestedVersion = source.expectedVersion;
  if (
    requestedVersion !== undefined &&
    requestedVersion !== null &&
    (!Number.isSafeInteger(requestedVersion) || Number(requestedVersion) <= 0)
  ) {
    invalidSidebarMove('expectedVersion must be a positive integer or null');
  }
  return {
    mutationId,
    intent,
    ...(requestedVersion === undefined
      ? {}
      : { expectedVersion: requestedVersion as number | null }),
  };
}
