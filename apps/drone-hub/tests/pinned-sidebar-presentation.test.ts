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
    expect(sidebarSource).toContain('key={`pinned:${droneId}`}');
    expect(sidebarSource).toContain('draggable={false}');
    expect(sidebarSource).not.toContain('leadingIcon={<IconPin');
    expect(cardSource).toContain("pinned ? 'Unpin from top' : 'Pin to top'");
  });
});
