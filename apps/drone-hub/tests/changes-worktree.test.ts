import { expect, test } from 'bun:test';
import { resolveChangesWorktree, type ChatWorktree, type RepoWorktree } from '../src/droneHub/changes/changes-worktree';

const worktrees: RepoWorktree[] = [
  { path: '/repo', branch: 'main', head: null, main: true },
  { path: '/wt/a', branch: 'a', head: null, main: false },
  { path: '/wt/b', branch: 'b', head: null, main: false },
];
const chatOnA: ChatWorktree = { path: '/wt/a', branch: 'a', reportedAt: 'now', available: true, main: false };

test("following shows the chat's reported worktree, else the main checkout", () => {
  expect(resolveChangesWorktree({ mode: 'follow-chat', pinned: null, worktrees, chatWorktree: chatOnA })).toEqual({ path: '/wt/a', source: 'chat' });
  expect(resolveChangesWorktree({ mode: 'follow-chat', pinned: null, worktrees, chatWorktree: null })).toEqual({ path: null, source: 'main' });
  // A reported worktree that was removed falls back to the main checkout.
  expect(resolveChangesWorktree({ mode: 'follow-chat', pinned: null, worktrees, chatWorktree: { ...chatOnA, available: false } })).toEqual({ path: null, source: 'main' });
});

test('main mode ignores the chat; a worktree picked by hand wins until it is gone', () => {
  expect(resolveChangesWorktree({ mode: 'main', pinned: null, worktrees, chatWorktree: chatOnA })).toEqual({ path: null, source: 'main' });
  expect(resolveChangesWorktree({ mode: 'main', pinned: '/wt/b', worktrees, chatWorktree: chatOnA })).toEqual({ path: '/wt/b', source: 'pinned' });
  expect(resolveChangesWorktree({ mode: 'follow-chat', pinned: '/repo', worktrees, chatWorktree: chatOnA })).toEqual({ path: null, source: 'pinned' });
  expect(resolveChangesWorktree({ mode: 'follow-chat', pinned: '/wt/gone', worktrees, chatWorktree: chatOnA })).toEqual({ path: '/wt/a', source: 'chat' });
});
