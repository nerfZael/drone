import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  createDirectoryRefreshThrottle,
  subscribeDirectoryEvents,
  type DirectoryEventsRuntime,
} from '../src/droneHub/files/directory-events';

function fakeRuntime() {
  const sockets: Array<{ sent: string[]; closed: boolean; onopen: any; onmessage: any; onclose: any; send(data: string): void; close(): void }> = [];
  const timers: Array<{ run: () => void; ms: number }> = [];
  const runtime: DirectoryEventsRuntime = {
    openSocket: () => {
      const socket = { sent: [] as string[], closed: false, onopen: null, onmessage: null, onclose: null,
        send(data: string) { this.sent.push(data); }, close() { this.closed = true; } };
      sockets.push(socket);
      return socket;
    },
    setTimeout: (run, ms) => { timers.push({ run, ms }); return timers.length; },
    clearTimeout: () => {},
  };
  return { runtime, sockets, timers };
}

describe('explorer folder events', () => {
  test('tells the Hub which folders are shown, again whenever that changes, on one socket', () => {
    const { runtime, sockets } = fakeRuntime();
    const events = subscribeDirectoryEvents('drone-a', ['/work'], { onChanged() {}, onResync() {} }, runtime);
    // Folders expanded before the socket opens are not lost.
    events.setDirectories(['/work', '/work/src']);
    expect(sockets[0].sent).toEqual([]);
    sockets[0].onopen({});
    expect(sockets[0].sent.map((raw) => JSON.parse(raw))).toEqual([{ paths: ['/work', '/work/src'] }]);
    events.setDirectories(['/work']);
    expect(JSON.parse(sockets[0].sent[1])).toEqual({ paths: ['/work'] });
    expect(sockets.length).toBe(1);
    events.close();
    expect(sockets[0].closed).toBe(true);
  });

  test('reports the folder that changed and ignores anything malformed', () => {
    const { runtime, sockets } = fakeRuntime();
    const changed: string[] = [];
    let resyncs = 0;
    subscribeDirectoryEvents('drone-a', ['/work'], { onChanged: (path) => changed.push(path), onResync: () => { resyncs += 1; } }, runtime);
    sockets[0].onopen({});
    sockets[0].onmessage({ data: JSON.stringify({ type: 'changed', path: '/work/src' }) });
    sockets[0].onmessage({ data: 'not json' });
    sockets[0].onmessage({ data: JSON.stringify({ type: 'changed' }) });
    sockets[0].onmessage({ data: JSON.stringify({ type: 'resync' }) });
    expect(changed).toEqual(['/work/src']);
    expect(resyncs).toBe(1);
  });

  test('reconnects with growing pauses, asks for the current folders and reads everything again', () => {
    const { runtime, sockets, timers } = fakeRuntime();
    let resyncs = 0;
    const events = subscribeDirectoryEvents('drone-a', ['/work'], { onChanged() {}, onResync: () => { resyncs += 1; } }, runtime);
    sockets[0].onopen({});
    expect(resyncs).toBe(0);
    sockets[0].onclose({});
    events.setDirectories(['/work', '/work/docs']);
    expect(timers.map((timer) => timer.ms)).toEqual([2_000]);
    timers[0].run();
    sockets[1].onclose({});
    expect(timers.map((timer) => timer.ms)).toEqual([2_000, 4_000]);
    timers[1].run();
    sockets[2].onopen({});
    expect(JSON.parse(sockets[2].sent[0])).toEqual({ paths: ['/work', '/work/docs'] });
    expect(resyncs).toBe(1);
    // A closed subscription stays closed.
    events.close();
    sockets[2].onclose({});
    expect(timers.length).toBe(2);
  });
});

describe('folder refresh throttle', () => {
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

test('the explorer follows the folders on screen and still re-reads expanded folders now and then', () => {
  const dock = readFileSync(new URL('../src/droneHub/files/DroneFilesDock.tsx', import.meta.url), 'utf8');
  expect(dock).toContain('subscribeDirectoryEvents(droneId, shownDirectoriesRef.current');
  expect(dock).toContain('directoryEventsRef.current?.setDirectories(shownDirectoriesRef.current)');
  expect(dock).toContain("if (document.visibilityState !== 'visible') return;");
  expect(dock).toContain('DIRECTORY_BACKSTOP_INTERVAL_MS = 30_000');
});

test('re-reading a folder that is already shown does not blank it or flash a spinner', () => {
  const paneState = readFileSync(new URL('../src/droneHub/app/use-files-and-ports-pane-state.ts', import.meta.url), 'utf8');
  expect(paneState).toContain('} else if (refreshingShownListing) {');
  expect(paneState).toContain('|| refreshingShownListing, Boolean(cached) || forceInitialLoad);');
  const dock = readFileSync(new URL('../src/droneHub/files/DroneFilesDock.tsx', import.meta.url), 'utf8');
  expect(dock).toContain('if (!cached && !showsEntries) setChildLoadingByPath');
});
