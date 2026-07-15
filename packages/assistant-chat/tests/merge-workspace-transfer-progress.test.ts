import { describe, expect, test } from 'bun:test';
import { mergeWorkspaceTransferProgress } from '../src';

describe('workspace transfer progress', () => {
  test('merges changed-file deltas into the original manifest', () => {
    const initial = {
      type: 'workspace_transfer',
      phase: 'transferring',
      completedFiles: 0,
      files: [
        { sourcePath: 'a.txt', destinationPath: 'copy/a.txt', status: 'pending' },
        { sourcePath: 'b.txt', destinationPath: 'copy/b.txt', status: 'pending' },
      ],
    };
    const merged = mergeWorkspaceTransferProgress(initial, {
      type: 'workspace_transfer',
      phase: 'transferring',
      completedFiles: 1,
      filesPartial: true,
      files: [
        {
          sourcePath: 'a.txt',
          destinationPath: 'copy/a.txt',
          status: 'completed',
        },
      ],
    });

    expect(merged).toMatchObject({
      completedFiles: 1,
      filesPartial: false,
      files: [{ status: 'completed' }, { status: 'pending' }],
    });
  });
});
