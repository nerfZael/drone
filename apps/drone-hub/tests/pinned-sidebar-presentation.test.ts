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
    expect(sidebarSource).toContain('data-sidebar-pinned-section="true"');
    expect(sidebarSource).toContain('function PinnedSidebarPlacementSlot({');
    expect(sidebarSource).toContain(
      "placement === 'top') return topTarget ? createPortal(children, topTarget) : null",
    );
    expect(sidebarSource).toContain('bottomTarget ? createPortal(children, bottomTarget) : null');
    expect(sidebarSource).toContain('data-sidebar-pinned-top-slot="true"');
    expect(sidebarSource).toContain('data-sidebar-pinned-bottom-slot="true"');
    expect(sidebarSource).toContain(
      'repositoryOverviewOpen || !activeRepositoryNavigationItem',
    );
    expect(sidebarSource).toContain(
      "? 'border-b border-[var(--border-subtle)]'",
    );
    expect(sidebarSource).toContain(
      "pinnedSidebarPlacement === 'top' && globalPinnedDrones.length > 0",
    );
    expect(sidebarSource.indexOf('data-sidebar-pinned-top-slot="true"')).toBeLessThan(
      sidebarSource.indexOf('dh-sidebar-scrollbar flex-1 min-h-0 overflow-x-hidden'),
    );
    expect(sidebarSource.indexOf('data-sidebar-pinned-section="true"')).toBeLessThan(
      sidebarSource.indexOf('data-sidebar-active-repository-header="true"'),
    );
    expect(sidebarSource).toContain('group/active-repository sticky top-0 z-20');
    expect(sidebarSource).toContain('data-sidebar-pinned-placement-toggle="true"');
    expect(sidebarSource).toContain("current === 'top' ? 'bottom' : 'top'");
    expect(sidebarSource).toContain("? 'Move pinned drones to bottom'");
    expect(sidebarSource).toContain(": 'Move pinned drones to top'");
    expect(sidebarSource).toContain("pinnedSidebarPlacement === 'bottom' ? 'rotate-180' : ''");
    expect(sidebarSource).toContain("? 'border-t border-[var(--border-subtle)]'");
    expect(sidebarSource).not.toContain(": 'border-b border-[var(--border-subtle)]'");
    expect(sidebarSource).toContain('key={`pinned:${droneId}`}');
    expect(sidebarSource).toContain('<PinnedDroneReorderItem');
    expect(sidebarSource).toContain('draggable={dragProps.draggable}');
    expect(sidebarSource).toContain('dragging={dragProps.dragging}');
    expect(sidebarSource).toContain('orderedDroneIds: globalPinnedDroneIds');
    const pinnedSelectionStart = sidebarSource.indexOf('const selectPinnedDroneCard');
    const pinnedSelectionEnd = sidebarSource.indexOf('const createDroneInRepository', pinnedSelectionStart);
    const pinnedSelectionSource = sidebarSource.slice(pinnedSelectionStart, pinnedSelectionEnd);
    expect(pinnedSelectionSource).not.toContain('openRepositoryNavigationItem');
    expect(pinnedSelectionSource).not.toContain('setActiveRepoPath');
    expect(sidebarSource).not.toContain('leadingIcon={<IconPin');
    expect(sidebarSource).toContain(
      'className="flex min-h-8 items-center gap-1.5 border-b border-[var(--border-subtle)] px-1"',
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
    expect(cardSource).toContain("data-sidebar-status-hint={pinned ? 'pinned-repository' : 'status'}");
    expect(cardSource).toContain(
      "'max-w-[4.75rem] rounded-[2px] border-[var(--border)] bg-[var(--surface-inset)] px-0.5 py-px text-[.4375rem] font-[var(--weight-medium)] tracking-[0.01em] text-[var(--fg-secondary)]'",
    );
    expect(cardSource).toContain(
      'if (summary.approval <= 0 && summary.unread <= 0 && summary.working <= 0) return null;',
    );
    const pinnedCountsIndex = cardSource.indexOf('pinned && effectiveChatStateSummary ? (');
    const pinnedRepositoryHintIndex = cardSource.indexOf(
      "data-sidebar-status-hint={pinned ? 'pinned-repository' : 'status'}",
    );
    const regularCountsIndex = cardSource.indexOf('!pinned && effectiveChatStateSummary ? (');
    expect(pinnedCountsIndex).toBeGreaterThan(-1);
    expect(pinnedCountsIndex).toBeLessThan(pinnedRepositoryHintIndex);
    expect(regularCountsIndex).toBeGreaterThan(pinnedRepositoryHintIndex);
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
