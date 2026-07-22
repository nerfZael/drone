import { readFileSync } from 'node:fs';
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

  test('puts the state indicator before the name without a visible state label', () => {
    const html = renderToStaticMarkup(
      createElement(DroneCard, {
        drone: drone({ runtime: 'container', busyChats: ['default'] }),
        selected: false,
        onClick: () => {},
      }),
    );

    expect(html).toContain('text-[var(--yellow)]');
    expect(html.indexOf('animate-[spin_1.6s_linear_infinite]')).toBeLessThan(html.indexOf('>worker</span>'));
    expect(html).not.toContain('>Working</span>');
    expect(html).not.toContain('data-sidebar-runtime');
    expect(html).not.toContain('aria-label="container runtime"');
    expect(html).not.toContain('>container</span>');
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
    expect(html).not.toContain('animate-[spin_1.6s_linear_infinite]');
  });

  test('leaves ready drones visually quiet while preserving unread emphasis', () => {
    const readyHtml = renderToStaticMarkup(
      createElement(SidebarItemStateIndicator, { state: 'idle' }),
    );
    const unreadHtml = renderToStaticMarkup(
      createElement(SidebarItemStateIndicator, { state: 'idle', unread: true }),
    );

    expect(readyHtml).toContain('h-3 w-3 flex-shrink-0 self-center');
    expect(readyHtml).not.toContain('rounded-full');
    expect(readyHtml).not.toContain('bg-[var(--muted)]');
    expect(unreadHtml).toContain('rounded-full');
    expect(unreadHtml).toContain('bg-[var(--green)]');
  });

  test('keeps starting in the working color and motion language', () => {
    const html = renderToStaticMarkup(
      createElement(SidebarItemStateIndicator, { state: 'starting' }),
    );

    expect(html).toContain('animate-[spin_1.6s_linear_infinite]');
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

  test('raises an open action menu above the isolated drone rows', () => {
    const source = readFileSync(
      new URL('../src/droneHub/overview/DroneCard.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain("actionMenuOpen ? 'z-50' : ''");
  });

  test('uses two rows while hover actions occupy the otherwise empty bottom-right slot', () => {
    const html = renderToStaticMarkup(
      createElement(DroneCard, {
        drone: drone({ lastMessageAt: '2026-07-20T11:00:00.000Z' }),
        selected: false,
        onClick: () => {},
        onDelete: () => {},
        onRename: () => {},
      }),
    );

    expect(html).toContain('min-h-[48px] py-1.5 pl-1.5 pr-1.5');
    expect(html).toContain('grid-rows-[1fr_1fr]');
    expect(html).toContain('col-start-1 row-span-2 flex min-w-0 items-center gap-1.5 self-stretch');
    expect(html).toContain('group-hover/drone:pr-8 group-focus-within/drone:pr-8');
    expect(html).toContain('col-start-2 row-start-1 ml-1.5');
    expect(html).toContain('col-start-2 row-start-2 ml-1.5');
    expect(html).not.toContain('min-w-[2.75rem]');
    expect(html).not.toContain('data-sidebar-runtime');
    expect(html).toContain('absolute right-0 top-1/2');
    expect(html).toContain('Last message');
  });

  test('replaces the message timestamp with a clean draft pill for draft drones', () => {
    const html = renderToStaticMarkup(
      createElement(DroneCard, {
        drone: drone({
          draft: true,
          hubPhase: 'draft',
          lastMessageAt: '2026-07-20T11:00:00.000Z',
        }),
        selected: false,
        unreadAgentMessage: true,
        onClick: () => {},
      }),
    );

    expect(html).toContain('aria-label="Draft drone"');
    expect(html).toContain('rounded-[3px]');
    expect(html).toContain('bg-[var(--accent-subtle)]');
    expect(html).toContain('text-[var(--accent)]');
    expect(html).toContain('normal-case');
    expect(html).not.toContain('border-[var(--accent-muted)]');
    expect(html).not.toContain('h-1 w-1 rounded-full');
    expect(html).not.toContain('h-1.5 w-1.5 rounded-full');
    expect(html).not.toContain('bg-[var(--green)]');
    expect(html).not.toContain('aria-label="Unavailable"');
    expect(html).toContain('data-sidebar-state-spacer="draft"');
    expect(html).toContain('inline-flex h-3 w-3 flex-shrink-0');
    expect(html).toContain('>Draft</span>');
    expect(html).not.toContain('Last message');
  });

  test('uses a faint accent wash and rail for selection', () => {
    const html = renderToStaticMarkup(
      createElement(DroneCard, {
        drone: drone(),
        selected: true,
        onClick: () => {},
      }),
    );

    expect(html).toContain('dh-sidebar-row-selected');
    expect(html).toContain('dh-sidebar-row-interactive');
    expect(html).toContain('bg-[var(--sidebar-row-selected-edge)]');
    expect(html).toContain('focus-visible:ring-[var(--focus-ring)]');
  });

  test('keeps a selected parent drone text-only when its child chat is active', () => {
    const html = renderToStaticMarkup(
      createElement(DroneCard, {
        drone: drone({ chats: ['default', 'notes'] }),
        selected: true,
        selectionTone: 'muted',
        showSelectionEdge: false,
        onClick: () => {},
      }),
    );

    expect(html).toContain('dh-type-sidebar-item-active');
    expect(html).not.toContain('dh-sidebar-row-selected');
    expect(html).not.toContain('bg-[var(--sidebar-row-selected-edge)]');
  });
});
