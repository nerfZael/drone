import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActiveComposerProvider, useActiveComposer } from '../src/droneHub/chat/ActiveComposerContext';
import {
  CompanionWorkspaceProvider,
  useCompanionWorkspace,
  type CompanionWorkspaceTarget,
} from '../src/droneHub/companion/CompanionWorkspaceContext';

function harness() {
  let workspace!: NonNullable<ReturnType<typeof useCompanionWorkspace>>;
  let composers!: ReturnType<typeof useActiveComposer>;
  function Capture() {
    workspace = useCompanionWorkspace()!;
    composers = useActiveComposer();
    return null;
  }
  renderToStaticMarkup(<ActiveComposerProvider><CompanionWorkspaceProvider><Capture /></CompanionWorkspaceProvider></ActiveComposerProvider>);
  return { workspace, composers };
}

function workspaceTarget(context: Record<string, unknown>): CompanionWorkspaceTarget {
  return {
    getAppContext: () => context,
    resolveDroneName: () => null,
    resolveDroneCreationDefaults: () => null,
    executeProposal: async () => { throw new Error('unused'); },
    openDroneChat: () => ({}),
    highlightDrones: () => ({}),
  };
}

function textTarget(id: string) {
  let content = 'original';
  let revision = '0';
  return {
    id,
    isEligible: () => true,
    read: () => ({ targetId: id, path: id, content, revision, mode: 'edit' as const }),
    apply: (base: string, next: string) => {
      if (base !== revision) throw new Error('STALE_REVISION');
      content = next;
      revision = String(Number(revision) + 1);
      return { ok: true as const, revision };
    },
  };
}

test('captured repo, drone, chat, and multi-selection survive navigation and later captures', () => {
  const { workspace } = harness();
  const initial = {
    activeRepoPath: '/repo-a', selectedDrone: { id: 'a', repoPath: '/repo-a' },
    selectedChat: 'first', selectedDroneIds: ['a'],
  };
  workspace.registerWorkspaceTarget(workspaceTarget(initial));
  const first = workspace.capture();
  initial.selectedDrone.id = 'mutated';
  initial.selectedDroneIds.push('b');
  workspace.registerWorkspaceTarget(workspaceTarget({ activeRepoPath: '/repo-b', selectedChat: 'second' }));
  const second = workspace.capture();
  expect(first.getAppContext()).toEqual({
    activeRepoPath: '/repo-a', selectedDrone: { id: 'a', repoPath: '/repo-a' },
    selectedChat: 'first', selectedDroneIds: ['a'],
  });
  first.getAppContext().activeRepoPath = '/tampered';
  expect(first.getAppContext().activeRepoPath).toBe('/repo-a');
  expect(second.getAppContext().activeRepoPath).toBe('/repo-b');
});

test('captured text targets keep their identity, read fresh revisions, and never fall back after closing', () => {
  const { workspace, composers } = harness();
  workspace.registerWorkspaceTarget(workspaceTarget({}));
  const composer = textTarget('composer-a');
  const editor = textTarget('file-a');
  const unregisterComposer = composers.registerComposer({
    ...composer, appendTranscript: () => {}, readSnapshot: composer.read, applyContent: composer.apply,
  });
  const unregisterEditor = workspace.registerEditor(editor);
  const captured = workspace.capture();
  const otherComposer = textTarget('composer-b');
  composers.registerComposer({
    ...otherComposer, appendTranscript: () => {}, readSnapshot: otherComposer.read, applyContent: otherComposer.apply,
  });
  composers.focusComposer(otherComposer.id);
  workspace.registerEditor(textTarget('file-b'));
  workspace.focusEditor('file-b');
  expect(captured.readActiveComposer()).toMatchObject({ targetId: 'composer-a' });
  expect(captured.readOpenFile()).toMatchObject({ targetId: 'file-a' });
  captured.applyComposer('composer-a', '0', 'updated composer');
  captured.applyEditor('file-a', '0', 'updated file');
  expect(captured.readActiveComposer()).toMatchObject({ content: 'updated composer', revision: '1' });
  expect(captured.readOpenFile()).toMatchObject({ content: 'updated file', revision: '1' });
  expect(() => captured.applyEditor('file-a', '0', 'stale edit')).toThrow('STALE_REVISION');
  expect(() => captured.applyComposer('composer-b', '0', 'wrong target')).toThrow('STALE_COMPOSER_TARGET');
  expect(() => captured.applyEditor('file-b', '0', 'wrong target')).toThrow('STALE_EDITOR_TARGET');
  unregisterComposer();
  unregisterEditor();
  expect(() => captured.readActiveComposer()).toThrow('STALE_COMPOSER_TARGET');
  expect(() => captured.readOpenFile()).toThrow('STALE_EDITOR_TARGET');
  expect(otherComposer.read().content).toBe('original');
});

test('absence of a text target at capture does not select one opened later', () => {
  const { workspace, composers } = harness();
  workspace.registerWorkspaceTarget(workspaceTarget({ activeRepoPath: null, selectedDrone: null }));
  const captured = workspace.capture();
  const composer = textTarget('later');
  composers.registerComposer({ ...composer, appendTranscript: () => {}, readSnapshot: composer.read });
  workspace.registerEditor(textTarget('later-file'));
  expect(() => captured.readActiveComposer()).toThrow('NO_ACTIVE_COMPOSER');
  expect(() => captured.readOpenFile()).toThrow('STALE_EDITOR_TARGET');
  expect(captured.getAppContext().activeRepoPath).toBeNull();
});

test('capture tolerates a missing workspace without adopting a later selection', () => {
  const { workspace } = harness();
  const captured = workspace.capture();
  workspace.registerWorkspaceTarget(workspaceTarget({ activeRepoPath: '/later' }));
  expect(() => captured.getAppContext()).toThrow('NO_ACTIVE_WORKSPACE');
  expect(workspace.capture().getAppContext().activeRepoPath).toBe('/later');
});

test('captured composers reject a reused component before its registry entry is refreshed', () => {
  const { workspace, composers } = harness();
  workspace.registerWorkspaceTarget(workspaceTarget({}));
  let currentTarget = textTarget('original');
  composers.registerComposer({
    id: 'original', isEligible: () => true, appendTranscript: () => {},
    readSnapshot: () => currentTarget.read(),
    applyContent: (revision, content) => currentTarget.apply(revision, content),
  });
  const captured = workspace.capture();
  // ChatInput updates its read/apply refs on render, before its registration effect runs.
  currentTarget = textTarget('replacement');
  expect(() => captured.readActiveComposer()).toThrow('STALE_COMPOSER_TARGET');
  expect(() => captured.applyComposer('original', '0', 'wrong chat')).toThrow('STALE_COMPOSER_TARGET');
  expect(currentTarget.read().content).toBe('original');
});
