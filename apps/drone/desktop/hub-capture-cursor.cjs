const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const runFile = promisify(execFile);

async function captureCursorPoint(screen, { platform = process.platform, env = process.env, run = runFile } = {}) {
  const x11 = platform === 'linux' && env.DISPLAY && env.XDG_SESSION_TYPE !== 'wayland' && !env.WAYLAND_DISPLAY;
  if (!x11) return screen.getCursorScreenPoint();
  // Chromium can cache a stale cursor position while no Electron window
  // receives pointer events. Query X11 directly for background shortcuts.
  let point;
  try {
    const { stdout } = await run('python3', [path.join(__dirname, 'hub-x11-cursor.py')], {
      timeout: 2000, maxBuffer: 4096, encoding: 'utf8', env,
    });
    point = JSON.parse(stdout);
    if (!Number.isInteger(point?.x) || !Number.isInteger(point?.y)) throw new Error('Invalid cursor coordinates');
  } catch (error) {
    throw new Error(`Cannot read the current X11 cursor position. Check that Python 3 and libX11 are installed. ${error.message || error}`);
  }
  // XQueryPointer reports physical pixels; Electron display bounds use DIP.
  return screen.screenToDipPoint(point);
}
module.exports = { captureCursorPoint };
