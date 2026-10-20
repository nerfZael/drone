import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { DroneChangesDock } from '../src/droneHub/changes/DroneChangesDock';
import { ChangesExplorerContext } from '../src/droneHub/changes/changes-explorer-context';

test('the worktree picker heads the Changes Explorer, even with nothing changed, and falls back to the toolbar without one', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  class FakeWebSocket { send() {} close() {} }
  const droneId = 'worktree-switcher-placement-test';
  let entries: unknown[] = [{
    path: 'first.ts', originalPath: null, code: ' M', stagedChar: ' ', unstagedChar: 'M',
    stagedType: null, unstagedType: 'modified', isUntracked: false, isIgnored: false, isConflicted: false,
  }];
  const fetch = async (url: string) => {
    if (String(url).includes('/repo/worktrees')) {
      return Response.json({
        ok: true, id: droneId, runtime: 'host', chatWorktree: null,
        worktrees: [
          { path: '/work/repo', branch: 'main', head: 'a'.repeat(40), main: true },
          { path: '/work/feature', branch: 'feature', head: 'b'.repeat(40), main: false },
        ],
      });
    }
    if (String(url).includes('/changes')) {
      return Response.json({
        ok: true, id: droneId, name: droneId, repoRoot: '/work/repo', reviewScopeId: 'scope', branch: {}, entries,
        counts: { changed: entries.length, staged: 0, unstaged: entries.length, untracked: 0, conflicted: 0, additions: 0, deletions: 0, modified: 0 },
      });
    }
    return Response.json({ ok: true, diff: '', truncated: false, fromUntracked: false, commits: [] });
  };
  for (const [key, value] of Object.entries({
    window: dom, document: dom.document, localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement, CustomEvent: dom.CustomEvent, ResizeObserver: dom.ResizeObserver,
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    WebSocket: FakeWebSocket, fetch, IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const main = dom.document.createElement('div');
  const explorer = dom.document.createElement('div');
  dom.document.body.append(main, explorer);
  const root = createRoot(main as unknown as HTMLElement);
  const render = (host: typeof explorer | null | undefined) =>
    root.render(
      <QueryClientProvider client={client}>
        <ChangesExplorerContext.Provider value={host as unknown as HTMLElement | null | undefined}>
          <DroneChangesDock droneId={droneId} chatName="agent" repoAttached repoPath="/work/repo" disabled={false}
            initialViewMode="stacked" persistViewPreferences={false}
            onRevealFileInFiles={() => {}} onOpenFileInEditor={() => {}} />
        </ChangesExplorerContext.Provider>
      </QueryClientProvider>,
    );
  const step = async (action: () => void) => {
    await act(async () => { action(); await new Promise((resolve) => setTimeout(resolve, 10)); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  };
  const switcher = '[data-changes-worktree-switcher]';
  try {
    await step(() => render(explorer));
    expect(explorer.querySelector(switcher)).not.toBeNull();
    expect(main.querySelector(switcher)).toBeNull();

    // A worktree with nothing changed keeps the picker, so it can still be switched away from.
    entries = [];
    await step(() => { void client.invalidateQueries(); });
    expect(explorer.querySelectorAll('[role="treeitem"]')).toHaveLength(0);
    expect(explorer.querySelector(switcher)).not.toBeNull();
    expect(main.querySelector(switcher)).toBeNull();

    // The docked Changes Explorer is closed: the picker moves to the Changes toolbar.
    await step(() => render(null));
    expect(main.querySelector(switcher)).not.toBeNull();

    // No separate explorer and the stacked view shows none inline.
    await step(() => render(undefined));
    expect(main.querySelector(switcher)).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    client.clear();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
  }
});
