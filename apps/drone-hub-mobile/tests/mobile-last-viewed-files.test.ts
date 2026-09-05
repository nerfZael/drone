import { describe, expect, test } from 'bun:test';
import { MobileLastViewedFiles } from '../src/drones/mobile-last-viewed-files';

const drone = { targetId: 'desktop', droneId: 'drone-a', chatName: 'default', phoneTarget: false };
const file = { raw: '/repo/readme.md', path: '/repo/readme.md', line: 12, column: null };

describe('last viewed files', () => {
  test('starts without a file and remembers the latest file per drone across chats', () => {
    const history = new MobileLastViewedFiles();
    expect(history.recall(drone)).toBeUndefined();
    history.remember(drone, file);
    expect(history.recall({ ...drone, chatName: 'another-chat' })).toEqual(file);
    const latest = { ...file, path: '/repo/index.ts', line: null };
    history.remember({ ...drone, chatName: 'another-chat' }, latest);
    expect(history.recall(drone)).toEqual(latest);
  });

  test('restores each drone independently and isolates devices', () => {
    const history = new MobileLastViewedFiles();
    const other = { ...drone, droneId: 'drone-b' };
    history.remember(drone, file);
    history.remember(other, { ...file, path: '/other/file.ts' });
    expect(history.recall(drone)).toEqual(file);
    expect(history.recall(other)?.path).toBe('/other/file.ts');
    expect(history.recall({ ...drone, targetId: 'another-device' })).toBeUndefined();
  });

  test('keeps native artifact selections scoped to their chat', () => {
    const history = new MobileLastViewedFiles();
    const native = { ...drone, phoneTarget: true };
    history.remember(native, file);
    expect(history.recall(native)).toEqual(file);
    expect(history.recall({ ...native, chatName: 'another-chat' })).toBeUndefined();
  });
});
