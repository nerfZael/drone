import { expect, test } from 'bun:test';
import { setCompanionClipboard } from '../src/droneHub/companion/companion-clipboard';

function withWindow(value: object, run: () => Promise<void>) {
  const originals = ['window', 'navigator'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  Object.defineProperty(globalThis, 'window', { configurable: true, value });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: (value as any).navigator });
  return run().finally(() => { for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } });
}

test('set_clipboard writes natively in the desktop app, which works while the Hub window is unfocused', async () => {
  const written: string[] = [];
  await withWindow({ droneHubDesktop: { writeClipboardText: async (text: string) => { written.push(text); return true; } }, navigator: { clipboard: { writeText: async () => { throw new Error('must not be used'); } } } }, async () => {
    expect(await setCompanionClipboard('git status')).toEqual({ copied: true, characters: 10 });
    expect(written).toEqual(['git status']);
  });
});

test('set_clipboard falls back to the web clipboard, reports a refusal, and validates its text', async () => {
  const written: string[] = [];
  let focused = true;
  await withWindow({ navigator: { clipboard: { writeText: async (text: string) => { if (!focused) throw new Error('Document is not focused'); written.push(text); } } } }, async () => {
    expect(await setCompanionClipboard('héllo')).toEqual({ copied: true, characters: 5 });
    focused = false;
    await expect(setCompanionClipboard('x')).rejects.toThrow('CLIPBOARD_UNAVAILABLE');
    await expect(setCompanionClipboard('')).rejects.toThrow('CLIPBOARD_TEXT_REQUIRED');
    await expect(setCompanionClipboard(42)).rejects.toThrow('CLIPBOARD_TEXT_REQUIRED');
    await expect(setCompanionClipboard('x'.repeat(100_001))).rejects.toThrow('CLIPBOARD_TEXT_TOO_LONG');
    expect(written).toEqual(['héllo']);
  });
});
