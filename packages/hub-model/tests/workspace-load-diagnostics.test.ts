import { expect, test } from 'bun:test';
import { WorkspaceLoadDiagnostics, type WorkspaceLoadRecord } from '../src/workspace-load-diagnostics';
import { readWorkspaceFileFirst } from '../src/path-navigation';

const target = { targetDeviceId: 'desktop', droneId: 'drone', chatName: 'default', path: '/private/file.txt' };

test('media readiness remains independent of file readiness and preserves the click identity', () => {
  const { loads, saved, frames } = fixture();
  const parent = { ...target, parentNavigationId: 'chat-click' };
  const file = loads.start('file-open', parent);
  const image1 = loads.start('media-load', { ...parent, path: '/private/image1.png' });
  const image2 = loads.start('media-load', { ...parent, path: '/private/image2.png' });
  loads.accumulate(file, 'reactRenderMs', 3);
  loads.accumulate(file, 'reactRenderMs', 4);
  loads.committed(file);
  while (frames.length) frames.shift()!();
  expect(saved).toHaveLength(1);
  expect(saved[0].parentNavigationId).toBe('chat-click');
  expect(saved[0].milestones.reactRenderMs).toBe(7);
  expect(loads.find('media-load', { path: '/private/image1.png' })).toBe(image1);
  loads.finish(image1, 'completed');
  loads.finish(image2, 'error');
  expect(saved).toHaveLength(3);
  expect(JSON.stringify(saved)).not.toContain('/private/');
});
function fixture() {
  let time = 0;
  let seq = 0;
  const saved: WorkspaceLoadRecord[] = [];
  const frames: Array<() => void> = [];
  const loads = new WorkspaceLoadDiagnostics({ uuid: () => String(++seq), platform: 'web', now: () => time,
    save: (record) => { saved.push(record); }, frame: (callback) => frames.push(callback) });
  return { loads, saved, frames, advance: (ms: number) => { time += ms; } };
}

test('file reads avoid directory discovery; directory fallback preserves the original read error', async () => {
  let checks = 0;
  const check = async () => { checks++; return true; };
  expect(await readWorkspaceFileFirst(async () => 'content', check)).toEqual({ directory: false, result: 'content' });
  expect(checks).toBe(0);
  const error = new Error('read denied');
  expect(await readWorkspaceFileFirst(async () => { throw error; }, check)).toEqual({ directory: true });
  for (const fallback of [async () => false, async () => { throw new Error('list denied'); }]) {
    try { await readWorkspaceFileFirst(async () => { throw error; }, fallback); throw new Error('expected failure'); }
    catch (actual) { expect(actual).toBe(error); }
  }
});

test('concurrent directories remain independent and completion waits for rendered frames', () => {
  const f = fixture();
  const file = f.loads.start('file-open', target);
  const dir = f.loads.start('directory-load', { ...target, path: '/private' });
  const request = f.loads.observe(target, 'file.preview', 'mesh-1')!;
  f.advance(15); request.mark('fetchMs'); request.serverId('hub-1'); request.finish('completed');
  f.advance(5); f.loads.committed(file);
  expect(f.saved).toHaveLength(0);
  f.frames.shift()!(); f.advance(10); f.frames.shift()!();
  expect(f.saved[0].durationMs).toBe(30);
  expect(f.saved[0].milestones).toMatchObject({ committed: 20, frame: 30 });
  expect(f.saved[0].requests[0].serverRequestId).toBe('hub-1');
  expect(JSON.stringify(f.saved)).not.toContain('/private');
  expect(f.loads.find('directory-load', { path: '/private' })).toBe(dir);
  f.loads.finishAll('backgrounded');
  expect(f.saved[1].status).toBe('backgrounded');
});

test('late callbacks cannot mutate finished records or complete a newer navigation', () => {
  const f = fixture();
  const old = f.loads.start('file-open', target);
  const request = f.loads.observe(target, 'file.preview', 'old')!;
  f.loads.committed(old);
  const next = f.loads.start('file-open', { ...target, path: '/next' });
  const snapshot = JSON.stringify(f.saved);
  request.mark('late'); request.timing('late', 999); request.serverId('late'); request.finish('completed');
  f.frames.shift()!(); f.frames.shift()!();
  expect(JSON.stringify(f.saved)).toBe(snapshot);
  expect(f.loads.find('file-open', { path: '/next' })).toBe(next);
  f.loads.retarget(next, '/resolved');
  expect(f.loads.find('file-open', { path: '/resolved' })).toBe(next);
  f.loads.finishAll('superseded');
});

test('bounds active loads and request measurements; diagnostics failures cannot escape', () => {
  const f = fixture();
  for (let i = 0; i < 40; i++) f.loads.start('directory-load', { ...target, path: String(i) });
  expect(f.saved).toHaveLength(8);
  const id = f.loads.find('directory-load', { path: '39' })!;
  f.loads.mark(id, 'invalid', NaN);
  for (let i = 0; i < 20; i++) {
    const observation = f.loads.observe({}, 'files.list', String(i), id);
    for (let j = 0; j < 50; j++) observation?.mark(`phase${j}`);
    observation?.finish('completed');
  }
  f.loads.finishAll('backgrounded');
  const record = f.saved.at(-1)!;
  expect(record.requests).toHaveLength(16);
  expect(Object.keys(record.requests[0].timings).length).toBeLessThanOrEqual(33);
  expect(record.milestones.invalid).toBeUndefined();
  const broken = new WorkspaceLoadDiagnostics({ uuid: () => 'broken', platform: 'web', save: () => { throw new Error('storage failed'); } });
  expect(() => broken.finish(broken.start('file-open', target), 'error')).not.toThrow();
});
