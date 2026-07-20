import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DroneSummary } from '../src/droneHub/types';
import {
  DroneCard,
  sidebarDroneDisplayState,
  sidebarDroneStateLabel,
} from '../src/droneHub/overview/DroneCard';

function drone(overrides: Partial<DroneSummary> = {}): DroneSummary {
  return {
    id: 'drone-1',
    name: 'worker',
    group: null,
    createdAt: '2026-07-20T10:00:00.000Z',
    repoPath: '/repo',
    containerPort: 3000,
    hostPort: null,
    statusOk: true,
    statusError: null,
    chats: ['default'],
    busyChats: [],
    ...overrides,
  };
}

describe('desktop sidebar drone presentation', () => {
  test('uses the same state priority as the mobile drawer', () => {
    expect(sidebarDroneDisplayState(drone({ busyChats: ['default'] }))).toBe('working');
    expect(sidebarDroneDisplayState(drone({ hubPhase: 'error' }))).toBe('blocked');
    expect(sidebarDroneDisplayState(drone({ statusOk: false }))).toBe('offline');
    expect(sidebarDroneDisplayState(drone({ hubMessage: 'Waiting for agent' }))).toBe('waiting');
    expect(sidebarDroneDisplayState(drone({ hubPhase: 'seeding' }))).toBe('starting');
    expect(sidebarDroneDisplayState(drone())).toBe('idle');
  });

  test('lets explicit lifecycle operations override the runtime state', () => {
    expect(sidebarDroneDisplayState(drone({ busyChats: ['default'] }), true, 'Archiving')).toBe(
      'archiving',
    );
    expect(sidebarDroneDisplayState(drone(), false, 'Deleting')).toBe('deleting');
  });

  test('uses mobile drawer labels, including unread idle drones', () => {
    expect(sidebarDroneStateLabel('idle', false)).toBe('Ready');
    expect(sidebarDroneStateLabel('idle', true)).toBe('Unread');
    expect(sidebarDroneStateLabel('offline', false)).toBe('Unavailable');
    expect(sidebarDroneStateLabel('working', false)).toBe('Working');
  });

  test('reserves hover actions for delete and the context menu', () => {
    const html = renderToStaticMarkup(
      createElement(DroneCard, {
        drone: drone(),
        selected: false,
        onClick: () => {},
        onDelete: () => {},
        onCreateChat: () => {},
        onClone: () => {},
        onRename: () => {},
        onSetBaseImage: () => {},
      }),
    );

    expect(html).toContain('aria-label="Delete &quot;worker&quot;"');
    expect(html).toContain('aria-label="More actions for &quot;worker&quot;"');
    expect(html).not.toContain('aria-label="Create chat on');
    expect(html).not.toContain('aria-label="Clone &quot;worker&quot;"');
  });

  test('keeps the timestamp at the right edge above the in-flow actions', () => {
    const html = renderToStaticMarkup(
      createElement(DroneCard, {
        drone: drone({ lastMessageAt: '2026-07-20T11:00:00.000Z' }),
        selected: false,
        onClick: () => {},
        onDelete: () => {},
        onRename: () => {},
      }),
    );

    expect(html).toContain('grid-cols-[minmax(0,1fr)_auto]');
    expect(html).toContain('col-span-2 row-start-1');
    expect(html).toContain('col-start-2 row-start-2');
  });
});
