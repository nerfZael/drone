import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function desktopBridge(invoke: (channel: string, mode: string) => Promise<unknown>, send = (..._args: unknown[]) => {}) {
  let bridge: any;
  vm.runInNewContext(fs.readFileSync(path.join(import.meta.dir, '../desktop/hub-electron-preload.cjs'), 'utf8'), {
    require: (name: string) => {
      if (name !== 'electron') throw new Error(`Unexpected module: ${name}`);
      return { contextBridge: { exposeInMainWorld: (_name: string, value: unknown) => { bridge = value; } }, ipcRenderer: { invoke, send } };
    },
    window: { addEventListener: () => {} },
  });
  return bridge;
}

test('new preload tells users to relaunch an older desktop process with no capture handler', async () => {
  const bridge = desktopBridge(async () => {
    throw new Error("Error invoking remote method 'drone-hub:companion-capture': Error: No handler registered for 'drone-hub:companion-capture'");
  });
  await expect(bridge.captureCompanion('region')).rejects.toThrow('Fully quit and reopen Drone Hub');
  await expect(bridge.captureCompanion('screen')).rejects.toThrow('restarting only the Hub server is not enough');
});

test('capture bridge preserves successful captures, cancellation and actual capture failures', async () => {
  const calls: string[][] = [];
  const image = { name: 'capture.png', dataBase64: 'cG5n' };
  const bridge = desktopBridge(async (channel, mode) => {
    calls.push([channel, mode]);
    return mode === 'region' ? null : image;
  });
  expect(await bridge.captureCompanion('screen')).toBe(image);
  expect(await bridge.captureCompanion('region')).toBeNull();
  expect(calls).toEqual([['drone-hub:companion-capture', 'screen'], ['drone-hub:companion-capture', 'region']]);
  const denied = new Error('Screen recording permission denied.');
  await expect(desktopBridge(async () => { throw denied; }).captureCompanion('screen')).rejects.toBe(denied);
});


test('Companion preload forwards recording focus through the allowed control channel', () => {
  const sent: unknown[][] = [];
  const bridge = desktopBridge(async () => undefined, (...args) => { sent.push(args); });
  bridge.companionWindow.control('focus');
  bridge.companionWindow.control('unknown');
  expect(sent).toEqual([['drone-hub:companion-window', 'focus', undefined]]);
});
