import { expect, test } from 'bun:test';
const { captureCursorPoint } = require('../desktop/hub-capture-cursor.cjs');

test('X11 capture ignores stale Electron position and converts live physical coordinates to DIP', async () => {
  let query = 0;
  const screen = {
    getCursorScreenPoint: () => { throw new Error('Stale position must not be used'); },
    screenToDipPoint: ({ x, y }: any) => ({ x: x / 2, y: y / 2 }),
  };
  const options = { platform: 'linux', env: { DISPLAY: ':0', XDG_SESSION_TYPE: 'x11' }, run: async (command: string, args: string[], options: any) => {
    expect(command).toBe('python3'); expect(args[0]).toEndWith('hub-x11-cursor.py'); expect(options.timeout).toBe(2000);
    return { stdout: JSON.stringify({ x: ++query === 1 ? 200 : 5400, y: 400 }) };
  } };
  expect(await captureCursorPoint(screen, options)).toEqual({ x: 100, y: 200 });
  expect(await captureCursorPoint(screen, options)).toEqual({ x: 2700, y: 200 });
});

test('other platforms use native cursor API and X11 failures never fall back to stale coordinates', async () => {
  const point = { x: -100, y: 200 };
  const screen = { getCursorScreenPoint: () => point };
  for (const platform of ['darwin', 'win32']) expect(await captureCursorPoint(screen, { platform })).toBe(point);
  expect(await captureCursorPoint(screen, { platform: 'linux', env: { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' } })).toBe(point);
  for (const run of [async () => { throw new Error('No Python'); }, async () => ({ stdout: '{"x":null,"y":1}' })]) {
    await expect(captureCursorPoint(screen, { platform: 'linux', env: { DISPLAY: ':0' }, run })).rejects.toThrow('Cannot read the current X11 cursor position');
  }
});
