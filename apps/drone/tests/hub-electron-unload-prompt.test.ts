import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';

const { installUnloadPrompt } = require('../desktop/hub-electron-unload-prompt.cjs');

function harness({ choice = 0, quitting = false } = {}) {
  const webContents = Object.assign(new EventEmitter(), { mainFrame: { name: 'main' } });
  const window = Object.assign(new EventEmitter(), { webContents, isDestroyed: () => false });
  const ipcMain = new EventEmitter();
  const prompts: Array<Record<string, any>> = [];
  const dialog = {
    showMessageBoxSync(owner: unknown, options: Record<string, any>) {
      expect(owner).toBe(window);
      prompts.push(options);
      return choice;
    },
  };
  installUnloadPrompt({ window, dialog, ipcMain, isQuitting: () => quitting });
  const report = (labels: unknown, sender = webContents, senderFrame: unknown = webContents.mainFrame) =>
    ipcMain.emit('drone-hub:unsaved-changes', { sender, senderFrame }, labels);
  // Electron unloads the page anyway when the will-prevent-unload handler calls preventDefault().
  const unload = () => {
    let leaves = false;
    window.webContents.emit('will-prevent-unload', { preventDefault: () => { leaves = true; } });
    return leaves;
  };
  return { window, prompts, unload, report };
}

describe('Drone Hub Electron unload prompt', () => {
  test('asks before closing over unsaved changes and closes on discard', () => {
    const { window, prompts, unload } = harness({ choice: 0 });
    window.emit('close');
    expect(unload()).toBe(true);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].message).toBe('Close Drone Hub without saving?');
    expect(prompts[0].detail).toBe("Changes you haven't saved will be lost.");
    expect(prompts[0].buttons).toEqual(['Discard and Close', 'Keep Editing']);
    // Enter and Escape both keep the changes.
    expect(prompts[0].defaultId).toBe(1);
    expect(prompts[0].cancelId).toBe(1);
  });

  test('keeps the window when the user keeps editing, and the next reload asks about reloading', () => {
    const { window, prompts, unload } = harness({ choice: 1 });
    window.emit('close');
    expect(unload()).toBe(false);
    expect(unload()).toBe(false);
    expect(prompts.map((prompt) => prompt.buttons[0])).toEqual(['Discard and Close', 'Discard and Reload']);
  });

  test('names what the page reports as unsaved, and only the main page may report', () => {
    const { window, prompts, unload, report } = harness({ choice: 1 });
    report(['notes.md', 'Companion settings']);
    report(['spoofed.md'], new EventEmitter());
    report(['framed.md'], window.webContents, { name: 'iframe' });
    window.emit('close');
    unload();
    expect(prompts[0].detail).toBe('Unsaved changes in:\n• notes.md\n• Companion settings\n\nThey will be lost.');
  });

  test('lists the first eight changes and counts the rest', () => {
    const { prompts, unload, report } = harness({ choice: 1 });
    report(Array.from({ length: 11 }, (_, index) => `file-${index + 1}.ts`));
    unload();
    expect(prompts[0].detail.split('\n').slice(1, 11)).toEqual([
      ...Array.from({ length: 8 }, (_, index) => `• file-${index + 1}.ts`), '• and 3 more', '',
    ]);
  });

  test('forgets the list when a new document loads', () => {
    const { window, prompts, unload, report } = harness({ choice: 1 });
    report(['notes.md']);
    window.webContents.emit('did-navigate');
    unload();
    expect(prompts[0].detail).toBe("Changes you haven't saved will be lost.");
  });

  test('lets a quit through without asking, since the desktop proxy is already stopping', () => {
    const { window, prompts, unload } = harness({ choice: 1, quitting: true });
    window.emit('close');
    expect(unload()).toBe(true);
    expect(prompts).toHaveLength(0);
  });

  test('is installed on the main window and shipped with the desktop build', () => {
    const mainSource = readFileSync(new URL('../desktop/hub-electron-main.cjs', import.meta.url), 'utf8');
    const postbuild = readFileSync(new URL('../scripts/postbuild.cjs', import.meta.url), 'utf8');
    expect(mainSource).toContain('installUnloadPrompt({ window: mainWindow, dialog, ipcMain, isQuitting: () => isQuitting })');
    expect(postbuild).toContain("'hub-electron-unload-prompt.cjs'");
  });
});
