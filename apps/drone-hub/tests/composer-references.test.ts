import { expect, test } from 'bun:test';
import { createCanvasChatNodeId, createCanvasDroneNodeId } from '../src/droneHub/app/app-config';
import {
  appendComposerReferences,
  composerReferencesFromDragData,
  composerReferencesFromNodeIds,
  mergeComposerReferences,
} from '../src/droneHub/chat/composer-references';

test('canvas cards become chat and drone references, without drafts or duplicates', () => {
  const refs = composerReferencesFromNodeIds([
    createCanvasChatNodeId('d1', 'plan'), createCanvasDroneNodeId('d2'), 'draft:1', createCanvasChatNodeId('d1', 'plan'),
  ]);
  expect(refs).toEqual([{ kind: 'chat', droneId: 'd1', chatName: 'plan' }, { kind: 'drone', droneId: 'd2' }]);
  expect(mergeComposerReferences(refs, [{ kind: 'drone', droneId: 'd2' }, { kind: 'drone', droneId: 'd3' }])).toHaveLength(3);
});

test('sidebar drags reference the dragged drones or chats', () => {
  expect(composerReferencesFromDragData({ type: 'sidebar-chat', droneId: 'd1', chatName: 'a', chatNames: ['a', 'b'] } as never))
    .toEqual([{ kind: 'chat', droneId: 'd1', chatName: 'a' }, { kind: 'chat', droneId: 'd1', chatName: 'b' }]);
  expect(composerReferencesFromDragData({ type: 'sidebar-drone', droneId: 'd1', droneIds: ['d1', 'd2'] } as never))
    .toEqual([{ kind: 'drone', droneId: 'd1' }, { kind: 'drone', droneId: 'd2' }]);
});

test('references are appended to the prompt with names and IDs', () => {
  const drones = { d1: { name: 'Builder' } };
  expect(appendComposerReferences('  Look  ', [], drones)).toBe('Look');
  expect(appendComposerReferences('Look', [{ kind: 'chat', droneId: 'd1', chatName: 'plan' }, { kind: 'drone', droneId: 'd9' }], drones))
    .toBe('Look\n\nReferenced drones and chats:\n- Chat "plan" in drone "Builder" (drone id: d1, chat: plan)\n- Drone "d9" (drone id: d9)');
});
