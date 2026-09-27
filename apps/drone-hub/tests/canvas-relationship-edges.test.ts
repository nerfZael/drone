import { describe, expect, test } from 'bun:test';
import { createCanvasChatNodeId, createCanvasDroneNodeId } from '../src/droneHub/app/app-config';
import { buildCanvasRelationshipEdges } from '../src/droneHub/canvas/relationship-edges';

describe('canvas relationship edges', () => {
  test('renders assigned edges even when the target is also a child drone', () => {
    const ownerNodeId = createCanvasChatNodeId('owner', 'default');
    const childNodeId = createCanvasChatNodeId('child', 'default');

    const edges = buildCanvasRelationshipEdges({
      preferredNodeByDroneId: {
        owner: { droneId: ownerNodeId },
        child: { droneId: childNodeId },
      },
      renderedNodeBoundsById: {},
      fallbackNodeBoundsById: {
        [ownerNodeId]: { x: 100, y: 100, width: 120, height: 54 },
        [childNodeId]: { x: 320, y: 120, width: 120, height: 54 },
      },
      fleetParentIdByDroneId: { child: 'owner' },
      fleetAssignedIdsByDroneId: { owner: ['child'] },
    });

    expect(edges).toHaveLength(2);
    expect(edges.map((edge) => ({ key: edge.key, variant: edge.variant }))).toEqual([
      { key: 'owner->child', variant: 'lineage' },
      { key: 'owner=>child', variant: 'assigned' },
    ]);
  });

  test('skips relationships when one side has no visible canvas node', () => {
    const ownerNodeId = createCanvasChatNodeId('owner', 'default');

    const edges = buildCanvasRelationshipEdges({
      preferredNodeByDroneId: {
        owner: { droneId: ownerNodeId },
      },
      renderedNodeBoundsById: {},
      fallbackNodeBoundsById: {
        [ownerNodeId]: { x: 100, y: 100, width: 120, height: 54 },
      },
      fleetParentIdByDroneId: { child: 'owner' },
      fleetAssignedIdsByDroneId: { owner: ['child'] },
    });

    expect(edges).toEqual([]);
  });

  test('connects a visible drone card to each visible chat with a distinct edge', () => {
    const droneNodeId = createCanvasDroneNodeId('owner');
    const defaultChatNodeId = createCanvasChatNodeId('owner', 'default');
    const reviewChatNodeId = createCanvasChatNodeId('owner', 'review');
    const edges = buildCanvasRelationshipEdges({
      preferredNodeByDroneId: { owner: { droneId: droneNodeId } },
      droneNodeByDroneId: { owner: { droneId: droneNodeId } },
      chatNodesByDroneId: {
        owner: [{ droneId: defaultChatNodeId }, { droneId: reviewChatNodeId }],
      },
      renderedNodeBoundsById: {},
      fallbackNodeBoundsById: {
        [droneNodeId]: { x: 100, y: 100, width: 150, height: 54 },
        [defaultChatNodeId]: { x: 320, y: 80, width: 110, height: 54 },
        [reviewChatNodeId]: { x: 320, y: 160, width: 110, height: 54 },
      },
      fleetParentIdByDroneId: {},
      fleetAssignedIdsByDroneId: {},
    });

    expect(edges.map((edge) => edge.variant)).toEqual(['chat-owner', 'chat-owner']);
  });

  test('a copy links to the chat it came from, and to the drone only when that chat is off the canvas', () => {
    const droneNodeId = createCanvasDroneNodeId('owner');
    const originalNodeId = createCanvasChatNodeId('owner', 'default');
    const copyNodeId = createCanvasChatNodeId('owner', 'default - Copy');
    const bounds = {
      [droneNodeId]: { x: 100, y: 100, width: 150, height: 44 },
      [originalNodeId]: { x: 100, y: 240, width: 110, height: 38 },
      [copyNodeId]: { x: 300, y: 240, width: 140, height: 38 },
    };
    const build = (withOriginal: boolean) => buildCanvasRelationshipEdges({
      preferredNodeByDroneId: { owner: { droneId: droneNodeId } },
      droneNodeByDroneId: { owner: { droneId: droneNodeId } },
      chatNodesByDroneId: {
        owner: withOriginal ? [{ droneId: originalNodeId }, { droneId: copyNodeId }] : [{ droneId: copyNodeId }],
      },
      renderedNodeBoundsById: {},
      fallbackNodeBoundsById: withOriginal ? bounds : { [droneNodeId]: bounds[droneNodeId], [copyNodeId]: bounds[copyNodeId] },
      fleetParentIdByDroneId: {},
      fleetAssignedIdsByDroneId: {},
      forkSourceNodeIdByNodeId: { [copyNodeId]: originalNodeId },
    });

    expect(build(true).map((edge) => edge.key)).toEqual([`${droneNodeId}~>${originalNodeId}`, `${originalNodeId}|>${copyNodeId}`]);
    expect(build(false).map((edge) => edge.key)).toEqual([`${droneNodeId}~>${copyNodeId}`]);
  });
});
