import { describe, expect, test } from 'bun:test';
import {
  dirtyDroneApplyFileLabel,
  dirtyDroneApplyRequestBody,
  reconcileDirtyDroneApplyModal,
} from '../src/droneHub/app/dirty-drone-apply';

describe('dirty drone apply helpers', () => {
  test('formats dirty file counts for modal copy', () => {
    expect(dirtyDroneApplyFileLabel(1)).toBe('1 file');
    expect(dirtyDroneApplyFileLabel(3)).toBe('3 files');
    expect(dirtyDroneApplyFileLabel(null)).toBe('one or more files');
  });

  test('builds request bodies for commit and keep-dirty apply paths', () => {
    expect(dirtyDroneApplyRequestBody('commit', 'snapshot')).toEqual({ commitDirty: true, commitMessage: 'snapshot' });
    expect(dirtyDroneApplyRequestBody('keep', 'ignored')).toEqual({ allowDirty: true });
  });

  test('drops the modal when startup leaves no active drone or modal state', () => {
    expect(reconcileDirtyDroneApplyModal(null, 'drone-1')).toBeNull();
    expect(
      reconcileDirtyDroneApplyModal(
        {
          autoCommitMessage: 'snapshot',
          dirtyFileCount: 2,
          droneId: 'drone-1',
          droneLabel: 'Drone 1',
        },
        null,
      ),
    ).toBeNull();
  });

  test('keeps the modal only for the matching active drone id', () => {
    const modal = {
      autoCommitMessage: 'snapshot',
      dirtyFileCount: 2,
      droneId: 'drone-1',
      droneLabel: 'Drone 1',
    };

    expect(reconcileDirtyDroneApplyModal(modal, 'drone-1')).toEqual(modal);
    expect(reconcileDirtyDroneApplyModal(modal, 'drone-2')).toBeNull();
  });
});
