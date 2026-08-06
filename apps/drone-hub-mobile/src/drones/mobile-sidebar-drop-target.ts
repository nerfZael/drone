import type { MobileSidebarDropPlacement } from './mobile-sidebar-reorder';

export type MobileSidebarDragTargetData = {
  parentId?: string;
  parentGroupPath?: string | null;
  siblingItemIds?: string[];
  childItemIds?: string[];
  folderPath?: string;
  insidePosition?: 'start' | 'end';
};

export type MobileSidebarMeasuredDropTarget = {
  key: string;
  scope: string;
  treeScope?: string;
  itemId: string;
  data?: MobileSidebarDragTargetData;
  acceptsInside(activeItemId: string): boolean;
  rect: { top: number; bottom: number };
};

export type MobileSidebarResolvedDropTarget = {
  overTargetKey: string;
  overItemId: string;
  placement: MobileSidebarDropPlacement;
  overData?: MobileSidebarDragTargetData;
};

function containsY(target: MobileSidebarMeasuredDropTarget, absoluteY: number): boolean {
  return absoluteY >= target.rect.top && absoluteY <= target.rect.bottom;
}

function acceptsCrossLevelDrop(
  target: MobileSidebarMeasuredDropTarget,
  treeScope: string | undefined,
  activeItemId: string,
): boolean {
  if (!treeScope || target.treeScope !== treeScope || !target.data?.parentId) return false;
  if (!activeItemId.startsWith('folder:')) return true;
  return (
    target.itemId !== activeItemId &&
    !target.itemId.startsWith(`${activeItemId}/`) &&
    target.data.parentId !== activeItemId &&
    !target.data.parentId.startsWith(`${activeItemId}/`)
  );
}

export function resolveMobileSidebarDropTarget(
  targets: Iterable<MobileSidebarMeasuredDropTarget>,
  scope: string,
  treeScope: string | undefined,
  activeItemId: string,
  absoluteY: number,
): MobileSidebarResolvedDropTarget | null {
  const allTargets = [...targets];
  const activeTarget = allTargets.find(
    (target) => target.scope === scope && target.itemId === activeItemId,
  );
  if (activeTarget && containsY(activeTarget, absoluteY)) {
    return {
      overTargetKey: activeTarget.key,
      overItemId: activeItemId,
      placement: 'after',
      overData: activeTarget.data,
    };
  }

  const hoveredTargets = allTargets.filter(
    (target) => target.itemId !== activeItemId && containsY(target, absoluteY),
  );
  const eligibleHoveredTargets = hoveredTargets.filter(
    (target) => target.scope === scope || acceptsCrossLevelDrop(target, treeScope, activeItemId),
  );
  // A mounted row is under the pointer, but it is not a valid destination (for example a
  // group's own descendant). Do not fall back to an unrelated sibling merely because it is near.
  if (hoveredTargets.length > 0 && eligibleHoveredTargets.length === 0) return null;

  const sameScopeTargets = allTargets.filter(
    (target) => target.itemId !== activeItemId && target.scope === scope,
  );
  const candidates = eligibleHoveredTargets.length > 0 ? eligibleHoveredTargets : sameScopeTargets;
  if (candidates.length === 0) return null;
  const target = candidates.reduce((nearest, candidate) => {
    const candidateCenter = (candidate.rect.top + candidate.rect.bottom) / 2;
    const nearestCenter = (nearest.rect.top + nearest.rect.bottom) / 2;
    return Math.abs(candidateCenter - absoluteY) < Math.abs(nearestCenter - absoluteY)
      ? candidate
      : nearest;
  });
  const height = Math.max(1, target.rect.bottom - target.rect.top);
  const inside =
    target.acceptsInside(activeItemId) &&
    target.treeScope === treeScope &&
    absoluteY >= target.rect.top + height * 0.25 &&
    absoluteY <= target.rect.bottom - height * 0.25;
  const center = (target.rect.top + target.rect.bottom) / 2;
  const placement: MobileSidebarDropPlacement = inside
    ? 'inside'
    : absoluteY < center
      ? 'before'
      : 'after';
  if (target.scope !== scope && !activeItemId.startsWith('folder:')) {
    if (placement !== 'inside' && target.data?.parentId?.startsWith('drone:')) return null;
    const sourceParentId = activeTarget?.data?.parentId ?? '';
    const sourceGroup = activeTarget?.data?.parentGroupPath ?? null;
    const targetGroup =
      placement === 'inside'
        ? (target.data?.folderPath ?? null)
        : (target.data?.parentGroupPath ?? null);
    // Group moves do not rewrite fleet parentage. A child can leave its fleet parent by moving to
    // another group, but a same-group cross-parent drop would be undone when the tree rebuilds.
    if (sourceParentId.startsWith('drone:') && sourceGroup === targetGroup) return null;
  }
  return {
    overTargetKey: target.key,
    overItemId: target.itemId,
    placement,
    overData:
      inside && target.data
        ? { ...target.data, insidePosition: absoluteY < center ? 'start' : 'end' }
        : target.data,
  };
}
