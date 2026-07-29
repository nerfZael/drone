import { describe, expect, test } from 'bun:test';
import type { AgentRunFileChangeEntry, AgentRunFileChanges } from '@blip/protocol';
import {
  createMobileChangedFilesReviewState,
  mobileChangedFilesReviewEntries,
  mobileChangedFilesReviewNeighbor,
  mobileChangedFilesReviewReducer,
  mobileChangedFilesReviewSelectedEntry,
  mobileChangedFilesReviewSelectionIndex,
} from '../src/local-assistant/mobile-changed-files-review-model';

const firstEntry = changedFile('src/a.ts', 'modified');
const secondEntry = changedFile('src/b.ts', 'added');
const thirdEntry = changedFile('docs/readme.md', 'deleted');
const fileChanges: AgentRunFileChanges = {
  version: 2,
  capturedAt: '2026-07-29T00:00:00.000Z',
  counts: { changed: 3, additions: 3, deletions: 2 },
  workspaces: [
    {
      targetId: 'workspace-a',
      label: 'App',
      diffArtifactId: 'artifact-a',
      counts: { changed: 2, additions: 3, deletions: 1 },
      previewEntries: [firstEntry],
    },
    {
      targetId: 'workspace-b',
      label: 'Docs',
      diffArtifactId: 'artifact-b',
      counts: { changed: 1, additions: 0, deletions: 1 },
      previewEntries: [thirdEntry],
    },
  ],
};

describe('mobile changed files review state', () => {
  test('keeps the chat-selected file available until the full page arrives', () => {
    const state = createMobileChangedFilesReviewState(fileChanges, {
      workspaceTargetId: 'workspace-a',
      entry: secondEntry,
    });

    expect(state.selection).toEqual({
      workspaceTargetId: 'workspace-a',
      path: secondEntry.path,
    });
    expect(mobileChangedFilesReviewSelectedEntry(fileChanges, state)?.entry).toEqual(secondEntry);

    const loaded = mobileChangedFilesReviewReducer(state, {
      type: 'files-loaded',
      workspaceTargetId: 'workspace-a',
      entries: [firstEntry],
      nextOffset: 100,
      metadataTruncated: false,
      append: false,
    });
    expect(loaded.workspaces['workspace-a']?.entries).toEqual([firstEntry, secondEntry]);
    expect(mobileChangedFilesReviewSelectedEntry(fileChanges, loaded)?.entry).toEqual(secondEntry);
  });

  test('moves through loaded files across workspaces', () => {
    let state = createMobileChangedFilesReviewState(fileChanges);
    state = mobileChangedFilesReviewReducer(state, {
      type: 'files-loaded',
      workspaceTargetId: 'workspace-a',
      entries: [firstEntry, secondEntry],
      nextOffset: null,
      metadataTruncated: false,
      append: false,
    });

    expect(
      mobileChangedFilesReviewEntries(fileChanges, state).map(({ entry }) => entry.path),
    ).toEqual([firstEntry.path, secondEntry.path, thirdEntry.path]);
    expect(mobileChangedFilesReviewNeighbor(fileChanges, state, -1)).toBeNull();
    expect(mobileChangedFilesReviewNeighbor(fileChanges, state, 1)).toEqual({
      workspaceTargetId: 'workspace-a',
      path: secondEntry.path,
    });
    state = mobileChangedFilesReviewReducer(state, {
      type: 'select',
      selection: { workspaceTargetId: 'workspace-b', path: thirdEntry.path },
    });
    expect(mobileChangedFilesReviewNeighbor(fileChanges, state, -1)).toEqual({
      workspaceTargetId: 'workspace-a',
      path: secondEntry.path,
    });
    expect(mobileChangedFilesReviewNeighbor(fileChanges, state, 1)).toBeNull();
    expect(mobileChangedFilesReviewSelectionIndex(fileChanges, state)).toEqual({
      current: 3,
      total: 3,
    });
  });

  test('tracks file loading, errors, retries, and paginated results', () => {
    let state = createMobileChangedFilesReviewState(fileChanges);
    state = mobileChangedFilesReviewReducer(state, {
      type: 'files-loading',
      workspaceTargetId: 'workspace-a',
      append: false,
    });
    expect(state.workspaces['workspace-a']).toMatchObject({
      status: 'loading',
      error: '',
      operation: 'refresh',
    });

    state = mobileChangedFilesReviewReducer(state, {
      type: 'files-error',
      workspaceTargetId: 'workspace-a',
      message: 'offline',
    });
    expect(state.workspaces['workspace-a']).toMatchObject({
      status: 'error',
      error: 'offline',
    });

    state = mobileChangedFilesReviewReducer(state, {
      type: 'files-loaded',
      workspaceTargetId: 'workspace-a',
      entries: [firstEntry, secondEntry],
      nextOffset: 2,
      metadataTruncated: true,
      append: false,
    });
    expect(state.workspaces['workspace-a']).toMatchObject({
      status: 'loaded',
      entries: [firstEntry, secondEntry],
      nextOffset: 2,
      metadataTruncated: true,
      error: '',
    });

    const appendedEntry = changedFile('src/c.ts', 'modified');
    state = mobileChangedFilesReviewReducer(state, {
      type: 'files-loaded',
      workspaceTargetId: 'workspace-a',
      entries: [secondEntry, appendedEntry],
      nextOffset: null,
      metadataTruncated: false,
      append: true,
    });
    expect(state.workspaces['workspace-a']?.entries).toEqual([
      firstEntry,
      secondEntry,
      appendedEntry,
    ]);
  });

  test('ignores stale diff responses after selection changes', () => {
    let state = createMobileChangedFilesReviewState(fileChanges);
    state = mobileChangedFilesReviewReducer(state, {
      type: 'diff-loading',
      key: 'workspace-a\u0000src/a.ts',
    });
    const unchanged = mobileChangedFilesReviewReducer(state, {
      type: 'diff-loaded',
      key: 'workspace-a\u0000src/old.ts',
      model: { kind: 'empty', message: 'empty', truncated: false },
    });
    expect(unchanged).toBe(state);

    state = mobileChangedFilesReviewReducer(state, {
      type: 'select',
      selection: { workspaceTargetId: 'workspace-a', path: secondEntry.path },
    });
    const staleAfterSelection = mobileChangedFilesReviewReducer(state, {
      type: 'diff-loaded',
      key: 'workspace-a\u0000src/a.ts',
      model: { kind: 'empty', message: 'empty', truncated: false },
    });
    expect(staleAfterSelection).toBe(state);

    state = mobileChangedFilesReviewReducer(state, {
      type: 'diff-loading',
      key: 'workspace-a\u0000src/b.ts',
    });
    state = mobileChangedFilesReviewReducer(state, {
      type: 'diff-error',
      key: 'workspace-a\u0000src/b.ts',
      error: { kind: 'error', message: 'offline', retryable: true },
    });
    expect(state.diff).toEqual({
      status: 'error',
      key: 'workspace-a\u0000src/b.ts',
      kind: 'error',
      message: 'offline',
      retryable: true,
    });
  });
});

function changedFile(
  path: string,
  status: AgentRunFileChangeEntry['status'],
): AgentRunFileChangeEntry {
  return {
    path,
    status,
    additions: status === 'deleted' ? 0 : 1,
    deletions: status === 'added' ? 0 : 1,
  };
}
