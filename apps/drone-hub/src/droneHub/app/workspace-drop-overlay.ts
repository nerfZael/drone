import type { DockviewApi, DockviewWillShowOverlayLocationEvent } from 'dockview';

/**
 * Decides which Dockview drop highlights to hide because releasing there
 * would not change the layout, or because another highlight for the very
 * same result is already available. Dockview shows a highlight for every
 * geometric drop zone and only decides on drop whether it does anything, so
 * a highlight that leads nowhere is a broken promise to the user.
 */

export type DropOverlayKind = 'content' | 'tab' | 'header_space' | 'edge';
export type DropOverlayPosition = 'top' | 'bottom' | 'left' | 'right' | 'center';

export type DropOverlayRect = { left: number; top: number; right: number; bottom: number };

export type DropOverlayContext = {
  kind: DropOverlayKind;
  position: DropOverlayPosition | undefined;
  /** Workspace instance the overlay belongs to; drags from other instances are left to Dockview. */
  viewId: string;
  /** Payload of the drag, undefined for drags that did not start on a Dockview tab. */
  data: { viewId: string; groupId: string; panelId: string | null; tabGroupId?: string | null } | undefined;
  /** Group whose zone would be highlighted; undefined for workspace-edge overlays. */
  targetGroup?: { id: string; panelCount: number };
  /** Tab under the pointer for `tab` overlays. */
  targetPanelId?: string | null;
  /** Grid area and its docked groups, used to spot redundant workspace-edge overlays. */
  workspaceRect?: DropOverlayRect;
  gridGroupRects?: DropOverlayRect[];
};

/** Slack for group gaps and borders when checking whether a group reaches an edge. */
const EDGE_TOLERANCE_PX = 12;

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= EDGE_TOLERANCE_PX;
}

/**
 * A workspace-edge drop creates a new group along that edge spanning the
 * whole workspace. When a docked group already spans the whole workspace at
 * that edge, its own edge zone produces exactly that layout, so the second
 * highlight only competes with it.
 */
export function isRedundantEdgeOverlay(
  position: DropOverlayPosition | undefined,
  workspace: DropOverlayRect | undefined,
  groups: DropOverlayRect[] | undefined,
): boolean {
  if (!position || position === 'center' || !workspace || !groups?.length) return false;
  const horizontal = position === 'left' || position === 'right';
  return groups.some((group) => {
    const touchesEdge = near(group[position], workspace[position]);
    const spansOtherAxis = horizontal
      ? near(group.top, workspace.top) && near(group.bottom, workspace.bottom)
      : near(group.left, workspace.left) && near(group.right, workspace.right);
    return touchesEdge && spansOtherAxis;
  });
}

export type EmptySlotDirection = 'above' | 'below' | 'left' | 'right';

const EMPTY_SLOT_DIRECTION: Record<Exclude<DropOverlayPosition, 'center'>, EmptySlotDirection> = {
  bottom: 'above',
  top: 'below',
  left: 'right',
  right: 'left',
};

/**
 * Dropping everything a pane holds onto one edge of that same pane means
 * "shrink me into this half and leave the other half empty". Dockview
 * ignores that drop, so the workspace performs it itself by inserting an
 * empty slot on the opposite side; this names that side, or undefined when
 * the drop is not of that shape.
 */
export function emptySlotDirectionForDrop(context: DropOverlayContext): EmptySlotDirection | undefined {
  const { data, kind, position, targetGroup } = context;
  if (!data || data.viewId !== context.viewId) return undefined;
  if (kind !== 'content' || !position || position === 'center') return undefined;
  if (!targetGroup || targetGroup.id !== data.groupId) return undefined;
  const dragsWholeGroup = data.panelId === null && !data.tabGroupId;
  const dragsOnlyPanel = data.panelId !== null && targetGroup.panelCount === 1;
  if (!dragsWholeGroup && !dragsOnlyPanel) return undefined;
  return EMPTY_SLOT_DIRECTION[position];
}

export function isNoOpDropOverlay(context: DropOverlayContext): boolean {
  const { data, kind, position, targetGroup } = context;
  if (!data || data.viewId !== context.viewId) return false;

  if (kind === 'edge') {
    return isRedundantEdgeOverlay(position, context.workspaceRect, context.gridGroupRects);
  }

  if (!targetGroup || targetGroup.id !== data.groupId) return false;
  // Edge drops of a pane's whole content onto itself are handled by the
  // workspace (see emptySlotDirectionForDrop), so their highlight stays.
  if (emptySlotDirectionForDrop(context)) return false;

  const isWholeGroupDrag = data.panelId === null && !data.tabGroupId;
  // Dockview ignores a group dropped onto its own centre or header.
  if (isWholeGroupDrag) return true;
  if (data.panelId === null) return false;

  // The only panel of a group dropped on its own centre or header stays put.
  if (targetGroup.panelCount === 1) return true;

  if (kind === 'content') return position === 'center';
  if (kind === 'tab') return context.targetPanelId === data.panelId;
  return false;
}

function rectOf(element: Element | null | undefined): DropOverlayRect | undefined {
  if (!element) return undefined;
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

/** Shape shared by Dockview's will-show-overlay and will-drop events. */
export type DropLocationEventLike = Pick<DockviewWillShowOverlayLocationEvent, 'kind' | 'position' | 'group' | 'panel' | 'getData'>;

export function dropOverlayContextFromEvent(
  event: DropLocationEventLike,
  api: DockviewApi,
  workspaceRoot: HTMLElement | null,
): DropOverlayContext {
  const data = event.getData();
  const context: DropOverlayContext = {
    kind: event.kind,
    position: event.position,
    viewId: api.id,
    data: data ? { viewId: data.viewId, groupId: data.groupId, panelId: data.panelId, tabGroupId: data.tabGroupId } : undefined,
    targetGroup: event.group ? { id: event.group.id, panelCount: event.group.panels.length } : undefined,
    targetPanelId: event.panel?.id,
  };
  if (event.kind === 'edge') {
    const gridElement = workspaceRoot?.querySelector('.dv-dockview') ?? workspaceRoot;
    context.workspaceRect = rectOf(gridElement);
    context.gridGroupRects = api.groups
      .filter((group) => group.api.location.type === 'grid')
      .map((group) => rectOf(group.element))
      .filter((rect): rect is DropOverlayRect => Boolean(rect));
  }
  return context;
}

/** Below this size along either axis an empty slot counts as dragged shut. */
export const EMPTY_SLOT_COLLAPSE_PX = 24;

/**
 * An empty slot has no chrome, so the only way to squeeze it out is to drag
 * the divider until nothing is left. Reports whether that happened; a
 * workspace with no size (hidden tab, mobile layout) never collapses slots,
 * since every group measures zero there.
 */
export function isCollapsedEmptySlot(
  slot: { width: number; height: number },
  workspace: { width: number; height: number },
): boolean {
  if (!(workspace.width > 0 && workspace.height > 0)) return false;
  return slot.width < EMPTY_SLOT_COLLAPSE_PX || slot.height < EMPTY_SLOT_COLLAPSE_PX;
}
