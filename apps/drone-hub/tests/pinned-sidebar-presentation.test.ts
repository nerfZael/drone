import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('desktop pinned drone presentation', () => {
  test('shows reorderable pinned shortcuts before the hierarchy', () => {
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
    expect(sidebarSource).toContain('<PinnedDroneReorderItem');
    expect(sidebarSource).toContain('draggable={dragProps.draggable}');
    expect(sidebarSource).toContain('dragging={dragProps.dragging}');
    expect(sidebarSource).not.toContain('leadingIcon={<IconPin');
    expect(sidebarSource).toContain(
      'className="flex min-h-8 items-center gap-1.5 px-1"',
    );
    expect(sidebarSource).toContain(
      '<IconPin className="h-3.5 w-3.5 flex-shrink-0 text-[var(--muted-dim)] opacity-72" />',
    );
    expect(sidebarSource).toContain(
      '<span className="min-w-0 flex-1 truncate text-[length:var(--text-10-5)] font-medium text-[color:var(--muted-dim)] [font-family:var(--sidebar-font)]">',
    );
    expect(sidebarSource).toContain('<div className="flex flex-col gap-0.5 pb-1">');
    expect(sidebarSource).not.toContain('>{pinnedDrones.length}</span>');
    expect(sidebarSource).toContain(
      'onCreateChat={sidebarCapabilities.actions ? () => openDroneChatCreate(drone) : undefined}',
    );
    expect(sidebarSource).toContain(
      'onClone={sidebarCapabilities.actions ? () => onCloneDrone(drone) : undefined}',
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
