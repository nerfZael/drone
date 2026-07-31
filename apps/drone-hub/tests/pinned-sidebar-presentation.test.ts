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
    const viewPropsSource = readFileSync(
      new URL('../src/droneHub/app/use-drone-hub-view-props.ts', import.meta.url),
      'utf8',
    );
    const appModelSource = readFileSync(
      new URL('../src/use-drone-hub-app-model.tsx', import.meta.url),
      'utf8',
    );

    expect(sidebarSource).toContain(
      'resolvePinnedSidebarDrones(allDrones, pinnedDroneIds)',
    );
    expect(sidebarSource).not.toContain('resolvePinnedSidebarDronesForRepo(');
    expect(sidebarSource).toContain('globalPinnedDrones.map((drone) =>');
    expect(sidebarSource).toContain('optimisticSidebarGroups,');
    expect(sidebarSource).not.toContain('excludePinnedSidebarGroupItems');
    expect(viewPropsSource).toContain('allDrones: drones,');
    expect(appModelSource).toContain('for (const droneId of pinnedDroneIds)');
    expect(appModelSource).toContain('selectableIds.add(droneId)');
    expect(appModelSource).toContain('retainedDroneIds: pinnedDroneIds');
    expect(sidebarSource).toContain(
      "(drone) => String(drone.repoPath ?? '').trim() === repoPath",
    );
    expect(sidebarSource).toContain('aria-label="Pinned drones"');
    expect(sidebarSource).toContain(
      'className="border-b border-[var(--border-subtle)]" aria-label="Pinned drones"',
    );
    expect(sidebarSource).toContain('key={`pinned:${droneId}`}');
    expect(sidebarSource).toContain('<PinnedDroneReorderItem');
    expect(sidebarSource).toContain('draggable={dragProps.draggable}');
    expect(sidebarSource).toContain('dragging={dragProps.dragging}');
    expect(sidebarSource).toContain('orderedDroneIds: globalPinnedDroneIds');
    expect(sidebarSource).not.toContain('leadingIcon={<IconPin');
    expect(sidebarSource).toContain(
      'className="flex min-h-8 items-center gap-1.5 px-1"',
    );
    expect(sidebarSource).toContain(
      '<IconPin className="h-3.5 w-3.5 flex-shrink-0 text-[var(--muted-dim)] opacity-72" />',
    );
    expect(sidebarSource).toContain(
      '<span className="min-w-0 flex-1 truncate text-[length:var(--text-10-5)] font-normal text-[color:var(--muted-dim)] [font-family:var(--sidebar-font)]">',
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
