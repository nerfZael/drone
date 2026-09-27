import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { DroneChangesDock } from '../src/droneHub/changes/DroneChangesDock';
import { ChangesExplorerContext } from '../src/droneHub/changes/changes-explorer-context';
import { changesQueryKeys } from '../src/droneHub/changes/useChangesQueries';
import { AgentRunHistoricalChangesView } from '../src/droneHub/changes/AgentRunHistoricalChangesView';

test('the separate changes explorer selects the main diff, survives moving and reopening, and keeps embedded views combined', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const requests: string[] = [];
  class FakeWebSocket { send() {} close() {} }
  const fetch = async (url: string) => {
    requests.push(String(url));
    return Response.json({ ok: true, diff: '', truncated: false, fromUntracked: false });
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
  const droneId = 'separate-explorer-test';
  const entries = ['first.ts', 'second.ts'].map((path) => ({
    path, originalPath: null, code: ' M', stagedChar: ' ', unstagedChar: 'M',
    stagedType: null, unstagedType: 'modified', isUntracked: false, isIgnored: false, isConflicted: false,
  }));
  client.setQueryData(changesQueryKeys.workingTree(droneId, '/work/repo'), {
    ok: true, id: droneId, name: droneId, repoRoot: '/work/repo', reviewScopeId: 'scope', branch: {}, entries,
    counts: { changed: 2, staged: 0, unstaged: 2, untracked: 0, conflicted: 0, additions: 2, deletions: 0, modified: 0 },
  });
  const main = dom.document.createElement('div');
  const explorer = dom.document.createElement('div');
  const movedExplorer = dom.document.createElement('div');
  dom.document.body.append(main, explorer, movedExplorer);
  const root = createRoot(main as unknown as HTMLElement);
  const openedFiles: string[] = [];
  let editorCallbackVersion = 0;
  const render = (host: typeof explorer | null | undefined) => {
    const version = editorCallbackVersion;
    root.render(
      <QueryClientProvider client={client}>
        <ChangesExplorerContext.Provider value={host as unknown as HTMLElement | null | undefined}>
          <DroneChangesDock droneId={droneId} repoAttached repoPath="/work/repo" disabled={false}
            initialViewMode="stacked" persistViewPreferences={false}
            onRevealFileInFiles={() => {}} onOpenFileInEditor={(path) => openedFiles.push(`${version}:${path}`)} />
        </ChangesExplorerContext.Provider>
      </QueryClientProvider>,
    );
  };
  const step = async (action: () => void) => {
    await act(async () => { action(); await new Promise((resolve) => setTimeout(resolve, 10)); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  };
  try {
    await step(() => render(explorer));
    expect(explorer.querySelectorAll('[role="treeitem"]')).toHaveLength(2);
    expect(main.querySelector('[role="tree"]')).toBeNull();
    await step(() => explorer.querySelector<HTMLButtonElement>('[role="treeitem"][title="second.ts"]')!.click());
    expect(explorer.querySelector('[aria-selected="true"]')?.getAttribute('title')).toBe('second.ts');
    expect(main.textContent).toContain('second.ts');
    expect(main.textContent).not.toContain('first.ts');
    expect(main.querySelector('[aria-label="Resize changes explorer"]')).toBeNull();
    expect(requests.some((url) => url.includes('second.ts'))).toBe(true);

    // Focus changes recreate workspace callbacks without changing the pane's data.
    editorCallbackVersion = 1;
    await step(() => render(explorer));
    await step(() => main.querySelector<HTMLButtonElement>('[aria-label="Open file in editor"]')!.click());
    expect(openedFiles).toEqual(['1:second.ts']);

    await step(() => render(movedExplorer));
    expect(explorer.children.length).toBe(0);
    expect(movedExplorer.querySelector('[aria-selected="true"]')?.getAttribute('title')).toBe('second.ts');
    await step(() => render(null));
    expect(movedExplorer.children.length).toBe(0);
    expect(main.textContent).toContain('second.ts');
    await step(() => render(explorer));
    expect(explorer.querySelector('[aria-selected="true"]')?.getAttribute('title')).toBe('second.ts');

    await step(() => render(undefined));
    expect(explorer.children.length).toBe(0);
    expect(main.querySelectorAll('[role="treeitem"]')).toHaveLength(2);
    expect(main.querySelector('[aria-label="Resize changes explorer"]')).not.toBeNull();

    const commit = { sha: 'a'.repeat(40), parents: [], subject: 'Example commit', authorName: 'Test', authoredAt: '2026-09-27T00:00:00Z' };
    client.setQueryData(changesQueryKeys.branchCommits(droneId, '/work/repo'), { ok: true, id: droneId, commits: [commit] });
    client.setQueryData(changesQueryKeys.branchCommit(droneId, '/work/repo', commit.sha), {
      ok: true, id: droneId, commit, counts: { changed: 2, additions: 2, deletions: 0 },
      entries: entries.map(({ path }) => ({ path, originalPath: null, statusChar: 'M', statusType: 'modified', additions: 1, deletions: 0, changes: 1 })),
    });
    await step(() => render(explorer));
    await step(() => Array.from(main.querySelectorAll('button')).find((button) => button.textContent === 'Commits')!.click());
    expect(explorer.textContent).toContain('Select a commit');
    await step(() => main.querySelector<HTMLButtonElement>('button[title="Example commit"]')!.click());
    expect(explorer.querySelectorAll('[role="treeitem"]')).toHaveLength(2);
    expect(main.querySelector('.dh-changes-split-resize-handle')).toBeNull();
    await step(() => explorer.querySelector<HTMLButtonElement>('[role="treeitem"][title="second.ts"]')!.click());
    expect(explorer.querySelector('[aria-selected="true"]')?.getAttribute('title')).toBe('second.ts');
    expect(main.textContent).toContain('second.ts');

    await step(() => root.render(
      <ChangesExplorerContext.Provider value={explorer as unknown as HTMLElement}>
        <AgentRunHistoricalChangesView onClose={() => {}}
          initialSelection={{ workspaceTargetId: 'repo', path: 'first.ts' }}
          fileChanges={{ version: 1, capturedAt: '2026-09-27T00:00:00Z',
            counts: { changed: 2, additions: 2, deletions: 0 },
            workspaces: [{ targetId: 'repo', label: 'Repository', counts: { changed: 2, additions: 2, deletions: 0 },
              entries: entries.map(({ path }) => ({ path, status: 'modified', additions: 1, deletions: 0 })),
            }],
          }} />
      </ChangesExplorerContext.Provider>,
    ));
    expect(main.querySelector('aside')).toBeNull();
    expect(explorer.querySelector('aside')).not.toBeNull();
    await step(() => explorer.querySelector<HTMLButtonElement>('button[title="second.ts"]')!.click());
    expect(main.textContent).toContain('second.ts');

    let reviewRenders = 0;
    const reviewOverride = {
      kind: 'change-request' as const, number: 1, revisionKey: 'revision-1',
      payload: null, loading: true, error: null,
      renderHeader: () => { reviewRenders += 1; return <span>Review header</span>; },
      loadDiff: async () => ({ diff: '', truncated: false }),
    };
    const renderReview = (override = reviewOverride) => root.render(
      <QueryClientProvider client={client}>
        <DroneChangesDock droneId={droneId} repoAttached repoPath="/work/repo" disabled={false}
          fixedContextMode="pull-request" reviewOverride={override}
          onRevealFileInFiles={() => {}} onOpenFileInEditor={() => {}} onReviewBack={() => {}} />
      </QueryClientProvider>,
    );
    await step(() => renderReview());
    const initialReviewRenders = reviewRenders;
    expect(initialReviewRenders).toBeGreaterThan(0);
    for (let i = 0; i < 3; i += 1) await step(() => renderReview());
    expect(reviewRenders).toBe(initialReviewRenders);
    await step(() => renderReview({ ...reviewOverride, revisionKey: 'revision-2' }));
    expect(reviewRenders).toBeGreaterThan(initialReviewRenders);
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
