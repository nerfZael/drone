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
      'resolvePinnedSidebarDrones(sidebarDrones, pinnedDroneIds)',
    );
    expect(sidebarSource).toContain('aria-label="Pinned drones"');
    expect(sidebarSource).toContain(
      'className="border-b border-[var(--border-subtle)]" aria-label="Pinned drones"',
    );
    expect(sidebarSource).toContain('key={`pinned:${droneId}`}');
    expect(sidebarSource).toContain('draggable={false}');
    expect(sidebarSource).not.toContain('leadingIcon={<IconPin');
    expect(sidebarSource).toContain('flex h-5 items-center gap-1 px-1.5 text-[var(--text-9)]');
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
});
