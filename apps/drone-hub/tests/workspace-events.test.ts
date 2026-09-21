import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  createDirectoryRefreshThrottle,
  subscribeDirectoryEvents,
  subscribeFileEvents,
  subscribeRepoEvents,
  type WorkspaceEventsRuntime,
  type WorkspaceFileEvent,
} from '../src/droneHub/files/workspace-events';

function fakeRuntime() {
  const sockets: Array<{ sent: string[]; closed: boolean; onopen: any; onmessage: any; onclose: any; send(data: string): void; close(): void }> = [];
  const timers: Array<{ run: () => void; ms: number }> = [];
  const runtime: WorkspaceEventsRuntime = {
    openSocket: () => {
      const socket = { sent: [] as string[], closed: false, onopen: null, onmessage: null, onclose: null,
        send(data: string) { this.sent.push(data); }, close() { this.closed = true; } };
      sockets.push(socket);
      return socket;
    },
    setTimeout: (run, ms) => { timers.push({ run, ms }); return timers.length; },
    clearTimeout: () => {},
  };
  const sent = (index: number) => sockets[index].sent.map((raw) => JSON.parse(raw));
  return { runtime, sockets, timers, sent };
}
const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('workspace events channel', () => {
  test('the explorer and the editor share one connection, and say together what they want', async () => {
    const { runtime, sockets, sent } = fakeRuntime();
    const explorer = subscribeDirectoryEvents('drone-a', ['/work'], { onChanged() {}, onResync() {} }, runtime);
    const stopFile = subscribeFileEvents('drone-a', '/work/notes.md', () => {}, runtime);
    // Folders expanded before the socket opens are not lost.
    explorer.setDirectories(['/work', '/work/src']);
    await flush();
    expect(sockets.length).toBe(1);
    expect(sockets[0].sent).toEqual([]);
    sockets[0].onopen({});
    expect(sent(0)).toEqual([{ directories: ['/work', '/work/src'], files: ['/work/notes.md'] }]);

    explorer.setDirectories(['/work']);
    stopFile();
    const stopOther = subscribeFileEvents('drone-a', '/work/other.md', () => {}, runtime);
    await flush();
    // Switching tabs and collapsing a folder in one go is one message.
    expect(sent(0).slice(1)).toEqual([{ directories: ['/work'], files: ['/work/other.md'] }]);
    // Saying the same thing again is not sent.
    explorer.setDirectories(['/work']);
    await flush();
    expect(sockets[0].sent.length).toBe(2);
    expect(sockets.length).toBe(1);
    stopOther();
    explorer.close();
  });

  test('another drone gets its own connection', async () => {
    const { runtime, sockets } = fakeRuntime();
    const a = subscribeFileEvents('drone-a', '/a.md', () => {}, runtime);
    const b = subscribeFileEvents('companion-home', '/b.md', () => {}, runtime);
    await flush();
    expect(sockets.length).toBe(2);
    a();
    b();
  });

  test('hands each answer to whoever asked for that folder or file', async () => {
    const { runtime, sockets } = fakeRuntime();
    const changed: string[] = [];
    let resyncs = 0;
    const fileEvents: WorkspaceFileEvent[] = [];
    const explorer = subscribeDirectoryEvents('drone-a', ['/work'], { onChanged: (path) => changed.push(path), onResync: () => { resyncs += 1; } }, runtime);
    const stopFile = subscribeFileEvents('drone-a', '/work/notes.md', (event) => fileEvents.push(event), runtime);
    sockets[0].onopen({});
    const receive = (message: unknown) => sockets[0].onmessage({ data: typeof message === 'string' ? message : JSON.stringify(message) });
    receive({ type: 'directory-changed', path: '/work' });
    receive({ type: 'directory-changed', path: '/elsewhere' });
    receive('not json');
    receive({ type: 'file', event: 'changed', path: '/work/notes.md', revision: 'sha256:abc', size: 3, mtimeMs: 5 });
    receive({ type: 'file', event: 'changed', path: '/work/unopened.md', revision: 'sha256:def' });
    receive({ type: 'resync' });
    expect(changed).toEqual(['/work']);
    expect(resyncs).toBe(1);
    expect(fileEvents.map((event) => [event.event, event.path, event.revision])).toEqual([['changed', '/work/notes.md', 'sha256:abc']]);
    stopFile();
    explorer.close();
  });

  test('reconnects with growing pauses, asks again for what is wanted now, and has folders read again', async () => {
    const { runtime, sockets, timers, sent } = fakeRuntime();
    let resyncs = 0;
    const explorer = subscribeDirectoryEvents('drone-a', ['/work'], { onChanged() {}, onResync: () => { resyncs += 1; } }, runtime);
    sockets[0].onopen({});
    expect(resyncs).toBe(0);
    sockets[0].onclose({});
    explorer.setDirectories(['/work', '/work/docs']);
    await flush();
    expect(timers.map((timer) => timer.ms)).toEqual([2_000]);
    timers[0].run();
    sockets[1].onclose({});
    expect(timers.map((timer) => timer.ms)).toEqual([2_000, 4_000]);
    timers[1].run();
    sockets[2].onopen({});
    // Open files need nothing here: the Hub opens each with a fresh snapshot.
    expect(sent(2)).toEqual([{ directories: ['/work', '/work/docs'], files: [] }]);
    expect(resyncs).toBe(1);
    explorer.close();
  });

  test('outlives a tab switch, then closes once nobody is listening', async () => {
    const { runtime, sockets, timers } = fakeRuntime();
    const stopFirst = subscribeFileEvents('drone-a', '/one.md', () => {}, runtime);
    sockets[0].onopen({});
    stopFirst();
    const stopSecond = subscribeFileEvents('drone-a', '/two.md', () => {}, runtime);
    expect(timers.map((timer) => timer.ms)).toEqual([1_000]);
    timers[0].run();
    expect(sockets[0].closed).toBe(false);
    expect(sockets.length).toBe(1);

    stopSecond();
    timers[1].run();
    expect(sockets[0].closed).toBe(true);
    // A later subscriber starts a new connection.
    const stopThird = subscribeFileEvents('drone-a', '/three.md', () => {}, runtime);
    expect(sockets.length).toBe(2);
    stopThird();
  });
});

describe('folder refresh throttle', () => {
  test('a changes panel shares the connection, and asks for git status only while it is open', async () => {
    const { runtime, sockets, sent } = fakeRuntime();
    const explorer = subscribeDirectoryEvents('drone-a', ['/work'], { onChanged() {}, onResync() {} }, runtime);
    await flush();
    sockets[0].onopen({});
    const seen: string[] = [];
    const stopPanel = subscribeRepoEvents('drone-a', { onChanged: () => seen.push('changed'), onLive: (live) => seen.push(`live ${live}`) }, runtime);
    await flush();
    expect(sockets.length).toBe(1);
    // An explorer on its own sends what it always has, which is what an older Hub expects.
    expect(sent(0)).toEqual([{ directories: ['/work'], files: [] }, { directories: ['/work'], files: [], repo: true }]);

    sockets[0].onmessage({ data: JSON.stringify({ type: 'repo-watch', live: true }) });
    sockets[0].onmessage({ data: JSON.stringify({ type: 'repo-changed' }) });
    expect(seen).toEqual(['live true', 'changed']);

    // A second panel on the same drone does not wait for an answer the Hub already gave.
    const late: string[] = [];
    const stopLate = subscribeRepoEvents('drone-a', { onChanged() {}, onLive: (live) => late.push(`live ${live}`) }, runtime);
    expect(late).toEqual(['live true']);
    stopLate();

    stopPanel();
    await flush();
    expect(sent(0).at(-1)).toEqual({ directories: ['/work'], files: [] });
    // The Hub has stopped watching; a panel opened now waits to hear that it watches again.
    const reopened: string[] = [];
    const stopReopened = subscribeRepoEvents('drone-a', { onChanged() {}, onLive: (live) => reopened.push(`live ${live}`) }, runtime);
    expect(reopened).toEqual([]);
    stopReopened();
    explorer.close();
  });

  test('a changes panel closed and reopened in one render keeps what the Hub said about the watch', async () => {
    const { runtime, sockets, sent } = fakeRuntime();
    const stopFirst = subscribeRepoEvents('drone-a', { onChanged() {}, onLive() {} }, runtime);
    await flush();
    sockets[0].onopen({});
    sockets[0].onmessage({ data: JSON.stringify({ type: 'repo-watch', live: true }) });
    stopFirst();
    const seen: string[] = [];
    const stopSecond = subscribeRepoEvents('drone-a', { onChanged() {}, onLive: (live) => seen.push(`live ${live}`) }, runtime);
    await flush();
    // Nothing new was asked of the Hub, so it will not answer again.
    expect(sent(0)).toEqual([{ directories: [], files: [], repo: true }]);
    expect(seen).toEqual(['live true']);
    stopSecond();
  });

  test('a lost connection puts the changes panel back on its own, and a new one has it read again', async () => {
    const { runtime, sockets, timers } = fakeRuntime();
    const seen: string[] = [];
    const stop = subscribeRepoEvents('drone-a', { onChanged: () => seen.push('changed'), onLive: (live) => seen.push(`live ${live}`) }, runtime);
    await flush();
    sockets[0].onopen({});
    sockets[0].onmessage({ data: JSON.stringify({ type: 'repo-watch', live: true }) });
    sockets[0].onclose({});
    expect(seen).toEqual(['live true', 'live false']);
    timers.at(-1)!.run();
    sockets[1].onopen({});
    expect(JSON.parse(sockets[1].sent[0])).toEqual({ directories: [], files: [], repo: true });
    expect(seen).toEqual(['live true', 'live false', 'changed']);
    stop();
  });

  test('reads a folder right away, then once more per interval while changes keep coming', () => {
    const pending: Array<() => void> = [];
    const refreshed: string[] = [];
    const throttle = createDirectoryRefreshThrottle((directory) => refreshed.push(directory), 1_000, {
      setTimeout: (run) => { pending.push(run); return pending.length; },
      clearTimeout: () => {},
    });
    throttle.request('/work/src');
    expect(refreshed).toEqual(['/work/src']);
    for (let index = 0; index < 50; index += 1) throttle.request('/work/src');
    // Another folder is not held back by a busy one.
    throttle.request('/work/docs');
    expect(refreshed).toEqual(['/work/src', '/work/docs']);
    pending.shift()!();
    expect(refreshed).toEqual(['/work/src', '/work/docs', '/work/src']);
    // Quiet again: the interval ends without another read.
    pending.shift()!();
    pending.shift()!();
    expect(refreshed.length).toBe(3);
    expect(pending.length).toBe(0);
  });
});

test('the explorer follows the folders on screen, and open tabs use the same connection', () => {
  const dock = readFileSync(new URL('../src/droneHub/files/DroneFilesDock.tsx', import.meta.url), 'utf8');
  expect(dock).toContain('subscribeDirectoryEvents(droneId, shownDirectoriesRef.current');
  expect(dock).toContain('directoryEventsRef.current?.setDirectories(shownDirectoriesRef.current)');
  expect(dock).toContain("if (document.visibilityState !== 'visible') return;");
  expect(dock).toContain('DIRECTORY_BACKSTOP_INTERVAL_MS = 30_000');
  const editorState = readFileSync(new URL('../src/droneHub/app/use-file-editor-state.ts', import.meta.url), 'utf8');
  expect(editorState).toContain('subscribeFileEvents(watchedTab.droneId, watchedTab.path');
  expect(editorState).not.toContain('EventSource');
});

test('re-reading a folder that is already shown does not blank it or flash a spinner', () => {
  const paneState = readFileSync(new URL('../src/droneHub/app/use-files-and-ports-pane-state.ts', import.meta.url), 'utf8');
  expect(paneState).toContain('} else if (refreshingShownListing) {');
  expect(paneState).toContain('|| refreshingShownListing, Boolean(cached) || forceInitialLoad);');
  const dock = readFileSync(new URL('../src/droneHub/files/DroneFilesDock.tsx', import.meta.url), 'utf8');
  expect(dock).toContain('if (!cached && !showsEntries) setChildLoadingByPath');
});
