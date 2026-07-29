import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const overlaySource = readFileSync(
  join(import.meta.dir, '../src/droneHub/app/DroneHubOverlays.tsx'),
  'utf8',
);
const groupMultiChatColumnSource = readFileSync(
  join(import.meta.dir, '../src/droneHub/app/GroupMultiChatColumn.tsx'),
  'utf8',
);
const sidebarSource = readFileSync(
  join(import.meta.dir, '../src/droneHub/app/DroneSidebar.tsx'),
  'utf8',
);
const emptyStateSource = readFileSync(
  join(import.meta.dir, '../src/droneHub/app/NoDroneSelectedState.tsx'),
  'utf8',
);

const modalImports = [
  { name: 'ReposModal', path: './ReposModal' },
  { name: 'DirtyDroneApplyModal', path: './DirtyDroneApplyModal' },
  { name: 'DroneErrorModal', path: './DroneErrorModal' },
  { name: 'DroneDropActionModal', path: './DroneDropActionModal' },
  { name: 'CustomAgentsModal', path: './CustomAgentsModal' },
  { name: 'DraftCreateDroneModal', path: './DraftCreateDroneModal' },
];

describe('DroneHubOverlays modal loading', () => {
  test('keeps rare modal components behind dynamic imports', () => {
    for (const modal of modalImports) {
      expect(overlaySource).toContain(`import('${modal.path}')`);
      expect(overlaySource).not.toContain(`import { ${modal.name} } from '${modal.path}'`);
    }
  });

  test('renders lazy modals only when their existing open state is active', () => {
    expect(overlaySource).toContain('draftCreateDroneModalProps.open && <DraftCreateDroneModal');
    expect(overlaySource).toContain('customAgentsModalProps.open && <CustomAgentsModal');
    expect(overlaySource).toContain('reposModalProps && <ReposModal');
    expect(overlaySource).toContain('dirtyDroneApplyModalProps && <DirtyDroneApplyModal');
    expect(overlaySource).toContain('droneRenameModalProps && <DroneRenameModal');
    expect(overlaySource).toContain('droneErrorModalProps && <DroneErrorModal');
    expect(overlaySource).toContain('droneDropActionModalProps && <DroneDropActionModal');
  });

  test('keeps group chat dirty apply modal behind its local open state', () => {
    expect(groupMultiChatColumnSource).toContain("import('./DirtyDroneApplyModal')");
    expect(groupMultiChatColumnSource).not.toContain("import { DirtyDroneApplyModal } from './DirtyDroneApplyModal'");
    expect(groupMultiChatColumnSource).toContain('dirtyDroneApplyModal ? (');
    expect(groupMultiChatColumnSource).toContain('<React.Suspense fallback={null}>');
  });

  test('does not retain the removed batch-create modal or its entry points', () => {
    expect(
      existsSync(join(import.meta.dir, '../src/droneHub/app/CreateDronesModal.tsx')),
    ).toBe(false);
    expect(overlaySource).not.toContain('CreateDronesModal');
    expect(sidebarSource).not.toContain('Create multiple drones');
    expect(emptyStateSource).not.toContain('Create multiple');
  });
});
