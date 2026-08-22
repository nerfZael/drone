import {
  buildLineagePath,
  resolveLineageEndpoint,
  type CanvasRect,
} from './lineage-geometry';

export type CanvasRelationshipEdge = {
  key: string;
  path: string;
  variant: 'lineage' | 'assigned' | 'chat-owner';
};

type RelationshipCanvasNode = {
  droneId: string;
};

type BuildCanvasRelationshipEdgesParams = {
  preferredNodeByDroneId: Record<string, RelationshipCanvasNode>;
  droneNodeByDroneId?: Record<string, RelationshipCanvasNode>;
  chatNodesByDroneId?: Record<string, RelationshipCanvasNode[]>;
  renderedNodeBoundsById: Record<string, CanvasRect>;
  fallbackNodeBoundsById: Record<string, CanvasRect>;
  fleetParentIdByDroneId: Record<string, string>;
  fleetAssignedIdsByDroneId: Record<string, string[]>;
};

export function buildCanvasRelationshipEdges({
  preferredNodeByDroneId,
  droneNodeByDroneId = {},
  chatNodesByDroneId = {},
  renderedNodeBoundsById,
  fallbackNodeBoundsById,
  fleetParentIdByDroneId,
  fleetAssignedIdsByDroneId,
}: BuildCanvasRelationshipEdgesParams): CanvasRelationshipEdge[] {
  const edges: CanvasRelationshipEdge[] = [];

  for (const [droneId, droneNode] of Object.entries(droneNodeByDroneId)) {
    const source = renderedNodeBoundsById[droneNode.droneId] ?? fallbackNodeBoundsById[droneNode.droneId];
    if (!source) continue;
    for (const chatNode of chatNodesByDroneId[droneId] ?? []) {
      const target = renderedNodeBoundsById[chatNode.droneId] ?? fallbackNodeBoundsById[chatNode.droneId];
      if (!target) continue;
      const { startX, startY, endX, endY } = resolveLineageEndpoint(source, target);
      edges.push({
        key: `${droneNode.droneId}~>${chatNode.droneId}`,
        path: buildLineagePath(startX, startY, endX, endY),
        variant: 'chat-owner',
      });
    }
  }

  for (const [childDroneId, parentDroneId] of Object.entries(fleetParentIdByDroneId)) {
    const childNode = preferredNodeByDroneId[childDroneId];
    const parentNode = preferredNodeByDroneId[parentDroneId];
    if (!childNode || !parentNode) continue;
    const source = renderedNodeBoundsById[parentNode.droneId] ?? fallbackNodeBoundsById[parentNode.droneId];
    const target = renderedNodeBoundsById[childNode.droneId] ?? fallbackNodeBoundsById[childNode.droneId];
    if (!source || !target) continue;
    const { startX, startY, endX, endY } = resolveLineageEndpoint(source, target);
    edges.push({
      key: `${parentDroneId}->${childDroneId}`,
      path: buildLineagePath(startX, startY, endX, endY),
      variant: 'lineage',
    });
  }

  for (const [ownerDroneId, assignedDroneIds] of Object.entries(fleetAssignedIdsByDroneId)) {
    const ownerNode = preferredNodeByDroneId[ownerDroneId];
    if (!ownerNode) continue;
    for (const assignedDroneId of assignedDroneIds) {
      const targetNode = preferredNodeByDroneId[assignedDroneId];
      if (!targetNode) continue;
      const source = renderedNodeBoundsById[ownerNode.droneId] ?? fallbackNodeBoundsById[ownerNode.droneId];
      const target = renderedNodeBoundsById[targetNode.droneId] ?? fallbackNodeBoundsById[targetNode.droneId];
      if (!source || !target) continue;
      const { startX, startY, endX, endY } = resolveLineageEndpoint(source, target);
      edges.push({
        key: `${ownerDroneId}=>${assignedDroneId}`,
        path: buildLineagePath(startX, startY, endX, endY),
        variant: 'assigned',
      });
    }
  }

  return edges;
}
