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

  test('puts the state indicator before a compact single-line title', () => {
    const html = renderToStaticMarkup(
      createElement(DroneCard, {
        drone: drone({ runtime: 'container', busyChats: ['default'] }),
        selected: false,
        onClick: () => {},
      }),
    );

    expect(html).toContain('text-[var(--yellow)]');
    expect(html.indexOf('animate-[spin_1.6s_linear_infinite]')).toBeLessThan(html.indexOf('>worker</span>'));
    expect(html).not.toContain('data-sidebar-drone-metadata="true"');
    expect(html).toContain('· Working · created');
    expect(html).not.toContain('data-sidebar-runtime');
    expect(html).not.toContain('aria-label="container runtime"');
    expect(html).not.toContain('>container</span>');
  });

  test('shows a persistent to do label at the right of tagged drone rows', () => {
    const source = readFileSync(
      new URL('../src/droneHub/overview/DroneCard.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('data-sidebar-drone-label="to-do"');
    expect(source).toContain('absolute right-1 top-1/2');
    expect(source).toContain('border-[var(--yellow-border)]');
    expect(source).toContain('bg-[var(--yellow-subtle)]');
    expect(source).toContain('text-[var(--yellow)] opacity-70');
    expect(source).not.toContain('group-hover/drone:opacity-0 group-focus-within/drone:opacity-0');
    expect(source).toContain('aria-label="TODO"');
    expect(source).toContain('TODO');
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
    expect(html).toContain('text-[var(--yellow)]');
    expect(html).not.toContain('animate-[spin_1.6s_linear_infinite]');
  });

  test('uses a quiet leaf accent for blocked triangles and reserves red for emphasis', () => {
    const quietHtml = renderToStaticMarkup(
      createElement(SidebarItemStateIndicator, { state: 'blocked' }),
    );
    const emphasizedHtml = renderToStaticMarkup(
      createElement(SidebarItemStateIndicator, { state: 'blocked', emphasized: true }),
    );

    expect(quietHtml).toContain('data-sidebar-blocked-indicator="quiet"');
    expect(quietHtml).toContain('text-[var(--sidebar-item-icon)] opacity-70');
    expect(quietHtml).toContain('group-hover/drone:text-[var(--sidebar-blocked-indicator)]');
    expect(emphasizedHtml).toContain('data-sidebar-blocked-indicator="emphasized"');
    expect(emphasizedHtml).toContain('text-[var(--sidebar-blocked-indicator)] opacity-100');
    expect(emphasizedHtml).toContain('M6 1.25 11 10.25H1L6 1.25Z');
    expect(emphasizedHtml).toContain('M6 4.15v2.75');
    expect(emphasizedHtml).toContain('cx="6" cy="8.5"');
    expect(quietHtml).not.toContain('rounded-full');
    expect(quietHtml).not.toContain('bg-[var(--green)]');
  });

  test('gives ready drones a quiet leaf accent while preserving unread emphasis', () => {
    const readyHtml = renderToStaticMarkup(
      createElement(SidebarItemStateIndicator, { state: 'idle' }),
    );
    const anchoredReadyHtml = renderToStaticMarkup(
      createElement(SidebarItemStateIndicator, { state: 'idle', showReadyAnchor: true }),
    );
    const unreadHtml = renderToStaticMarkup(
      createElement(SidebarItemStateIndicator, { state: 'idle', unread: true }),
    );

    expect(readyHtml).toContain('h-3 w-3 flex-shrink-0 self-center');
    expect(readyHtml).not.toContain('rounded-full');
    expect(readyHtml).not.toContain('bg-[var(--muted)]');
    expect(anchoredReadyHtml).toContain('data-sidebar-ready-anchor="true"');
    expect(anchoredReadyHtml).toContain('h-1.5 w-1.5 rounded-full border');
    expect(anchoredReadyHtml).toContain('border-[var(--sidebar-item-icon)] opacity-70');
    expect(anchoredReadyHtml).not.toContain('bg-[var(--muted)]');
    expect(unreadHtml).toContain('rounded-full');
    expect(unreadHtml).toContain('bg-[var(--green)]');
    expect(unreadHtml).toContain('shadow-[0_0_5px_var(--green-border)]');
  });

  test('keeps starting in the working color and motion language', () => {
    const html = renderToStaticMarkup(
      createElement(SidebarItemStateIndicator, { state: 'starting' }),
    );

    expect(html).toContain('animate-[spin_1.6s_linear_infinite]');
    expect(html).toContain('text-[var(--yellow)]');
  });

  test('keeps destructive drone actions out of the hover rail', () => {
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

    expect(html).not.toContain('aria-label="Delete &quot;worker&quot;"');
    expect(html).not.toContain('data-onboarding-id="sidebar.droneCard.actions"');
    expect(html).not.toContain('aria-label="More actions for &quot;worker&quot;"');
    expect(html).not.toContain('aria-label="Create chat on');
    expect(html).not.toContain('aria-label="Clone &quot;worker&quot;"');
  });

  test('opens secondary drone actions from a right-click menu', () => {
    const cardSource = readFileSync(
      new URL('../src/droneHub/overview/DroneCard.tsx', import.meta.url),
      'utf8',
    );
    const menuSource = readFileSync(
      new URL('../src/droneHub/app/SidebarContextMenu.tsx', import.meta.url),
      'utf8',
    );
    const dropdownSource = readFileSync(
      new URL('../src/ui/dropdown.ts', import.meta.url),
      'utf8',
    );

    expect(cardSource).toContain('onContextMenu={(event) => {');
    expect(cardSource).toContain(
      'setActionMenuPosition({ x: event.clientX, y: event.clientY });',
    );
    expect(cardSource).toContain("label: 'Delete drone'");
    expect(cardSource).toContain("tone: 'danger'");
    expect(cardSource).not.toContain('<IconMore');
    expect(menuSource).toContain('createPortal(menu, document.body)');
    expect(menuSource).toContain('fixed z-[200]');
    expect(menuSource).toContain('role="separator"');
    expect(menuSource).toContain('contextMenuItemBaseClass');
    expect(menuSource).toContain('contextMenuPanelBaseClass');
    expect(dropdownSource).toContain('dh-type-menu-item');
    expect(menuSource).toContain('{item.shortcut}');
    expect(menuSource).toContain('text-[var(--muted-dim)] opacity-75');
    expect(cardSource).toContain("shortcut: 'F2'");
    expect(cardSource).toContain("shortcut: 'Delete'");
  });

  test('renames drones through a borderless inline editor that cancels on blur', () => {
    const source = readFileSync(
      new URL('../src/droneHub/overview/DroneCard.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('inlineRenameOpen');
    expect(source).toContain('inlineRenameInputRef.current?.select()');
    expect(source).toContain("if (event.key === 'Enter')");
    expect(source).toContain("if (event.key === 'Escape')");
    expect(source).toContain('onBlur={() => {');
    expect(source).toContain('setInlineRenameOpen(false)');
    expect(source).toContain('appearance-none rounded-none border-0 bg-transparent');
    expect(source).toContain("style={{ border: 0, outline: 'none', boxShadow: 'none' }}");
  });

  test('uses one compact explorer row without secondary metadata', () => {
    const html = renderToStaticMarkup(
      createElement(DroneCard, {
        drone: drone({ lastMessageAt: '2026-07-20T11:00:00.000Z' }),
        selected: false,
        onClick: () => {},
        onDelete: () => {},
        onRename: () => {},
      }),
    );

    expect(html).toContain('h-7 px-1.5');
    expect(html).not.toContain('grid-rows-[1fr_1fr]');
    expect(html).not.toContain('flex min-w-0 flex-1 flex-col');
    expect(html).not.toContain('group-hover/drone:pr-7 group-focus-within/drone:pr-7');
    expect(html).not.toContain('data-onboarding-id="sidebar.droneCard.actions"');
    expect(html).not.toContain('data-sidebar-drone-metadata="true"');
    expect(html).toContain('· Ready · created');
    expect(html).not.toContain('min-w-[2.75rem]');
    expect(html).not.toContain('data-sidebar-runtime');
    expect(html).not.toContain('absolute right-1 top-1/2');
    expect(html).not.toContain('Last message');
  });

  test('uses a rem-based 24/28/32px drone density scale', () => {
    const renderDensity = (density: 'compact' | 'default' | 'comfortable') =>
      renderToStaticMarkup(
        createElement(DroneCard, {
          drone: drone(),
          selected: false,
          density,
          onClick: () => {},
        }),
      );

    expect(renderDensity('compact')).toContain('h-6 px-1');
    expect(renderDensity('default')).toContain('h-7 px-1.5');
    expect(renderDensity('comfortable')).toContain('h-8 px-2');
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
    expect(html).toContain('focus:outline-none');
    expect(html).not.toContain('focus-visible:ring-');
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
