import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DroneSummary } from '../src/droneHub/types';
import {
  DroneCard,
  SidebarItemStateIndicator,
  sidebarChatDisplayState,
  sidebarDroneDisplayState,
  sidebarDroneStateLabel,
  sidebarItemStateToneClass,
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
    expect(sidebarDroneDisplayState(drone(), true, '', true)).toBe('approval');
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
    expect(sidebarDroneStateLabel('approval', false)).toBe('Approval required');
  });

  test('derives chat state from the selected chat while preserving runtime failures', () => {
    expect(sidebarChatDisplayState(drone({ busyChats: ['other'] }), false)).toBe('idle');
    expect(sidebarChatDisplayState(drone(), true)).toBe('working');
    expect(sidebarChatDisplayState(drone(), true, true)).toBe('approval');
    expect(sidebarChatDisplayState(drone({ hubPhase: 'error' }), false)).toBe('blocked');
    expect(sidebarItemStateToneClass('idle', true)).toContain('--green');
    expect(sidebarItemStateToneClass('blocked', true)).toContain('--red');
    expect(sidebarItemStateToneClass('approval', false)).toContain('--yellow');
    expect(sidebarItemStateToneClass('starting', false)).toContain('--yellow');
  });

  test('keeps runtime metadata neutral while the state changes color', () => {
    const html = renderToStaticMarkup(
      createElement(DroneCard, {
        drone: drone({ runtime: 'container', busyChats: ['default'] }),
        selected: false,
        onClick: () => {},
      }),
    );

    expect(html).toContain('text-[var(--yellow)]');
    expect(html).toContain('text-[var(--muted)]"> · container</span>');
  });

  test('matches the mobile working indicator geometry and baseline slot', () => {
    const html = renderToStaticMarkup(
      createElement(SidebarItemStateIndicator, { state: 'working' }),
    );

    expect(html).toContain('h-3 w-3 flex-shrink-0 self-center');
    expect(html).toContain('stroke-width="2.4"');
    expect(html).toContain('M21 12a9 9 0 1 1-6.219-8.56');
  });

  test('uses a static pause mark while approval is required', () => {
    const html = renderToStaticMarkup(
      createElement(SidebarItemStateIndicator, { state: 'approval' }),
    );

    expect(html).toContain('M4 2.5v7M8 2.5v7');
    expect(html).not.toContain('animate-spin');
  });

  test('keeps starting in the working color and motion language', () => {
    const html = renderToStaticMarkup(
      createElement(SidebarItemStateIndicator, { state: 'starting' }),
    );

    expect(html).toContain('animate-spin');
    expect(html).toContain('text-[var(--yellow)]');
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
