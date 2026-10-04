import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const { installRendererRecovery, RECOVERY_CHANNEL, recoveryPage } = require('../desktop/hub-electron-recovery.cjs');

test('crashes offer an explicit recovery, remember interrupted sessions, and reject untrusted recovery IPC', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'drone-recovery-'));
  const markerPath = path.join(dir, 'recover');
  let url = 'http://127.0.0.1:1234/';
  const loads: string[] = [];
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: {}, getURL: () => url,
    loadURL: async (next: string) => { loads.push(next); url = next; },
  });
  const window = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false });
  const ipcMain = new EventEmitter();
  let quitting = false;
  const recovery = installRendererRecovery({ window, ipcMain, markerPath, getUiUrl: () => 'http://127.0.0.1:1234/', diagnostics: { write() {} }, isQuitting: () => quitting });
  try {
    contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 133 });
    expect(loads).toHaveLength(0); // Navigation waits for Chromium teardown.
    expect(existsSync(markerPath)).toBe(true);
    expect(recovery.startupUrl('http://127.0.0.1:1234/')).toContain('droneRecovery=source');
    await new Promise(resolve => setImmediate(resolve));
    expect(loads).toEqual([recoveryPage]);
    ipcMain.emit(RECOVERY_CHANNEL, { sender: {}, senderFrame: contents.mainFrame });
    ipcMain.emit(RECOVERY_CHANNEL, { sender: contents, senderFrame: {} });
    expect(loads).toHaveLength(1);
    ipcMain.emit(RECOVERY_CHANNEL, { sender: contents, senderFrame: contents.mainFrame });
    expect(url).toBe('http://127.0.0.1:1234/?droneRecovery=source');
    contents.emit('did-finish-load');
    expect(existsSync(markerPath)).toBe(true);
    quitting = true;
    contents.emit('render-process-gone', {}, { reason: 'killed' });
    window.emit('closed');
    expect(existsSync(markerPath)).toBe(false);
    expect(ipcMain.listenerCount(RECOVERY_CHANNEL)).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
