import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { changesQueryKeys, useChangesQueries } from '../src/droneHub/changes/useChangesQueries';
import { useRepoLiveUpdates } from '../src/droneHub/changes/useRepoLiveUpdates';

function Panel({ droneId }: { droneId: string }) {
  const repoWatched = useRepoLiveUpdates(droneId, '/work/repo', true);
  const { changes } = useChangesQueries({
    droneId, repoPath: '/work/repo', repoAttached: true, disabled: false, dataMode: 'working-tree',
    contextMode: 'branch', primaryView: 'changes', pullRequestNumber: null, selectedCommitSha: null, repoWatched,
  });
  return <p>{repoWatched ? 'watched' : 'polling'} {changes?.counts.changed ?? '-'}</p>;
}

test('the changes panel reads again when the Hub reports a change, and polls slowly only while the Hub watches', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const sockets: Array<{ url: string; sent: string[]; onopen: any; onmessage: any; onclose: any; send(data: string): void; close(): void }> = [];
  class FakeWebSocket {
    sent: string[] = []; onopen: any = null; onmessage: any = null; onclose: any = null;
    constructor(public url: string) { sockets.push(this); }
    send(data: string) { this.sent.push(data); }
    close() {}
  }
  let reads = 0;
  const fetch = async (url: string) => {
    expect(String(url)).toContain('/api/drones/drone-a/repo/changes');
    reads += 1;
    return Response.json({ ok: true, id: 'drone-a', name: 'drone-a', repoRoot: '/work/repo', reviewScopeId: 's', branch: {}, counts: { changed: reads }, entries: [] });
  };
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, CustomEvent: dom.CustomEvent, WebSocket: FakeWebSocket, fetch, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element = dom.document.createElement('div');
  const root = createRoot(element as unknown as HTMLElement);
  const flush = () => new Promise((resolve) => setTimeout(resolve, 10));
  // A read comes back in one turn and is rendered in the next.
  const step = async (run: () => void) => {
    await act(async () => { run(); await flush(); });
    await act(async () => { await flush(); });
  };
  const pollInterval = () =>
    (client.getQueryCache().find({ queryKey: changesQueryKeys.workingTree('drone-a', '/work/repo') })!.observers[0].options as any).refetchInterval;
  try {
    await step(() => { root.render(<QueryClientProvider client={client}><Panel droneId="drone-a" /></QueryClientProvider>); });
    expect(element.textContent).toBe('polling 1');
    expect(pollInterval()).toBe(5_000);
    expect(sockets.length).toBe(1);
    expect(sockets[0].url).toContain('/api/drones/drone-a/fs/events');

    await step(() => { sockets[0].onopen({}); });
    expect(JSON.parse(sockets[0].sent[0])).toEqual({ directories: [], files: [], repo: true });
    // Until the Hub says it is watching, nothing changes: that is all an older Hub ever does.
    expect(pollInterval()).toBe(5_000);

    await step(() => { sockets[0].onmessage({ data: JSON.stringify({ type: 'repo-watch', live: true }) }); });
    expect(element.textContent).toBe('watched 1');
    expect(pollInterval()).toBe(60_000);

    await step(() => { sockets[0].onmessage({ data: JSON.stringify({ type: 'repo-changed' }) }); });
    expect(element.textContent).toBe('watched 2');

    // The Hub can no longer watch, or the connection is gone: back to checking every few seconds.
    await step(() => { sockets[0].onmessage({ data: JSON.stringify({ type: 'repo-watch', live: false }) }); });
    expect(pollInterval()).toBe(5_000);
    await step(() => { sockets[0].onmessage({ data: JSON.stringify({ type: 'repo-watch', live: true }) }); });
    await step(() => { sockets[0].onclose({}); });
    expect(element.textContent).toBe('polling 2');
    expect(pollInterval()).toBe(5_000);
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
