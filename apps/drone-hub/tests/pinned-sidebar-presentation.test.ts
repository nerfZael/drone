import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('desktop pinned drone presentation', () => {
  test('shows pinned shortcuts before the hierarchy and keeps them out of drag ordering', () => {
    const sidebarSource = readFileSync(
      new URL('../src/droneHub/app/DroneSidebar.tsx', import.meta.url),
      'utf8',
    );
    const cardSource = readFileSync(
      new URL('../src/droneHub/overview/DroneCard.tsx', import.meta.url),
      'utf8',
    );

    expect(sidebarSource).toContain(
      'resolvePinnedSidebarDronesForRepo(',
    );
    expect(sidebarSource).toContain('repositoryOverviewOpen || !activeRepositoryNavigationItem');
    expect(sidebarSource).toContain('activeRepositoryNavigationItem.repoPath');
    expect(sidebarSource).toContain('activeRepositoryPinnedDrones.map((drone) =>');
    expect(sidebarSource).toContain('aria-label="Pinned drones"');
    expect(sidebarSource).toContain(
      'className="border-b border-[var(--border-subtle)]" aria-label="Pinned drones"',
    );
    expect(sidebarSource).toContain('key={`pinned:${droneId}`}');
    expect(sidebarSource).toContain('draggable={false}');
    expect(sidebarSource).not.toContain('leadingIcon={<IconPin');
    expect(sidebarSource).toContain(
      'min-h-7 items-center gap-1.5 px-2.5 py-1.5 text-[var(--text-9)] font-[var(--weight-semibold)] tracking-[0.02em] text-[var(--muted-dim)] [font-family:var(--sidebar-font)]',
    );
    expect(sidebarSource).toContain('<span className="opacity-60">Pinned</span>');
    expect(sidebarSource).not.toContain('>{pinnedDrones.length}</span>');
    expect(sidebarSource).toContain(
      'onCreateChat={sidebarCapabilities.actions ? () => openDroneChatCreate(drone) : undefined}',
    );
    expect(sidebarSource).toContain(
      'onClone={sidebarCapabilities.actions ? () => onOpenCloneModal(drone) : undefined}',
    );
    expect(sidebarSource).toContain(
      'onDelete={sidebarCapabilities.actions ? () => onDeleteDrone(droneId) : undefined}',
    );
    expect(cardSource).toContain("pinned ? 'Unpin from top' : 'Pin to top'");
  });

  test('does not render drone totals on group and folder rows', () => {
    const sidebarSource = readFileSync(
      new URL('../src/droneHub/app/DroneSidebar.tsx', import.meta.url),
      'utf8',
    );
    const groupedTreeSource = readFileSync(
      new URL('../src/droneHub/app/GroupedSidebarTree.tsx', import.meta.url),
      'utf8',
    );

    expect(sidebarSource).not.toContain('sidebarCountClass');
    expect(groupedTreeSource).not.toContain('sidebarCountClass');
  });
});
