const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { DRONE_HUB_ELECTRON_FILES } = require('../../scripts/postbuild.cjs');

const desktop = path.join(__dirname, '../../desktop');

/** Every desktop file a file names: its requires, the preloads, pages and helpers it passes by name, and a page's scripts. */
function referencedFiles(filename) {
  const source = fs.readFileSync(path.join(desktop, filename), 'utf8');
  const names = new Set();
  for (const match of source.matchAll(/['"`](?:\.\/)?([\w.-]+\.(?:cjs|js|py|html))['"`]/g)) {
    if (fs.existsSync(path.join(desktop, match[1]))) names.add(match[1]);
  }
  return names;
}

test('the build copies every file the desktop app loads, so the app it runs from dist can start', () => {
  const needed = new Set();
  const pending = ['hub-electron-main.cjs'];
  while (pending.length) {
    const filename = pending.pop();
    if (needed.has(filename)) continue;
    needed.add(filename);
    if (/\.(cjs|js|html)$/.test(filename)) pending.push(...referencedFiles(filename));
  }
  const missing = [...needed].filter((filename) => !DRONE_HUB_ELECTRON_FILES.includes(filename));
  assert.deepEqual(missing, [], 'Add these to DRONE_HUB_ELECTRON_FILES in scripts/postbuild.cjs');
  for (const filename of DRONE_HUB_ELECTRON_FILES) {
    assert.ok(fs.existsSync(path.join(desktop, filename)), `${filename} is copied but does not exist`);
  }
});
