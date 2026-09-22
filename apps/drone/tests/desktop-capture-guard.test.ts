import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';

test('capture lease renews only on heartbeat and expires before Hub recovery', async () => {
  const guard = await loadGuard();
  const firstLease = guard.timer(30_000);
  guard.stdin.emit('data', Buffer.from('heart'));
  expect(guard.timer(30_000)).toBe(firstLease);
  guard.stdin.emit('data', Buffer.from('beat\n'));
  expect(guard.timers.has(firstLease)).toBe(false);
  guard.expire(30_000);
  expect(guard.writes).toEqual(['q\n']);
  guard.stdin.emit('data', Buffer.from('heartbeat\n'));
  expect([...guard.timers.values()].some(timer => timer.delay === 30_000)).toBe(false);
  guard.expire(8000);
  expect(guard.signals).toEqual(['SIGKILL']);
});

test('a broken desktop logging pipe stops capture and child exit clears watchdogs', async () => {
  const guard = await loadGuard();
  guard.stderr.emit('error', Object.assign(new Error('broken pipe'), { code: 'EPIPE' }));
  guard.stdin.emit('end');
  expect(guard.writes).toEqual(['q\n']);
  guard.child.emit('close', 0);
  expect(guard.timers.size).toBe(0);
  expect(guard.exits).toEqual([0]);
});

async function loadGuard() {
  const source = await fs.readFile(new URL('../desktop/hub-audio-capture.cjs', import.meta.url), 'utf8');
  const writes: string[] = [], signals: string[] = [], exits: number[] = [];
  const timers = new Map<number, { delay: number; callback: () => void }>();
  let nextTimer = 0;
  const stdin = Object.assign(new EventEmitter(), { resume() {} });
  const stderr = Object.assign(new EventEmitter(), { write() {} });
  const child = Object.assign(new EventEmitter(), {
    stdin: Object.assign(new EventEmitter(), { write(value: string) { writes.push(value); } }),
    stderr: { pipe() {} }, kill(signal: string) { signals.push(signal); },
  });
  const runtime = Object.assign(new EventEmitter(), { argv: ['node', 'guard', 'mic', 'monitor'], stdin, stderr, exit(code: number) { exits.push(code); } });
  runInNewContext(source, {
    require(name: string) { return name === 'node:child_process' ? { spawn: () => child } : { captureArgs: () => [] }; },
    process: runtime,
    setTimeout(callback: () => void, delay: number) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id: number) { timers.delete(id); },
  });
  const timer = (delay: number) => {
    const entry = [...timers].find(([, value]) => value.delay === delay);
    if (!entry) throw new Error(`Missing ${delay}ms timer`);
    return entry[0];
  };
  return { stdin, stderr, child, writes, signals, exits, timers, timer,
    expire(delay: number) { const id = timer(delay); const callback = timers.get(id)!.callback; timers.delete(id); callback(); },
  };
}
