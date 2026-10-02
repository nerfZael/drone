import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { readLargeHtmlSource } from '../src/droneHub/files/use-large-html-source';

function chunk(bytes: Uint8Array, offset: number, eof: boolean) {
  return Response.json({ ok: true, dataBase64: Buffer.from(bytes).toString('base64'), offset, nextOffset: offset + bytes.length, eof });
}

test('loads every HTML chunk and preserves UTF-8 split across byte boundaries', async () => {
  const original = globalThis.fetch;
  const bytes = new TextEncoder().encode('<h1>Ž🙂</h1>');
  const offsets: number[] = [];
  globalThis.fetch = (async (url: string) => {
    const offset = Number(new URL(url, 'http://localhost').searchParams.get('offset'));
    offsets.push(offset);
    return chunk(bytes.slice(offset, offset + 5), offset, offset + 5 >= bytes.length);
  }) as typeof fetch;
  try {
    expect(await readLargeHtmlSource('drone', '/index.html', new AbortController().signal)).toBe('<h1>Ž🙂</h1>');
    expect(offsets).toEqual([0, 5, 10]);
  } finally { globalThis.fetch = original; }
});

test('rejects failures and chunks that make no progress, and respects cancellation', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  try {
    globalThis.fetch = (async () => chunk(new Uint8Array(), 0, false)) as typeof fetch;
    await expect(readLargeHtmlSource('drone', '/index.html', controller.signal)).rejects.toThrow('invalid file chunk');
    globalThis.fetch = (async () => Response.json({ ok: false, error: 'File missing' })) as typeof fetch;
    await expect(readLargeHtmlSource('drone', '/index.html', controller.signal)).rejects.toThrow('File missing');
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      controller.abort();
      return chunk(new TextEncoder().encode('partial'), 0, false);
    }) as typeof fetch;
    await expect(readLargeHtmlSource('drone', '/index.html', controller.signal)).rejects.toThrow();
    expect(requests).toBe(1);
  } finally { globalThis.fetch = original; }
});

test('large HTML opens as an isolated preview, switches to source, and retries failed loads', async () => {
  const dom = new Window();
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'ResizeObserver', 'MutationObserver', 'DOMParser', 'localStorage', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'fetch', 'IS_REACT_ACT_ENVIRONMENT']) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    if (key !== 'fetch') Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom as any)[key] });
  }
  const host = dom.document.createElement('div');
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  let fail = true;
  globalThis.fetch = (async (url: string) => {
    if (url.includes('/fs/chunk?')) {
      if (fail) return Response.json({ ok: false, error: 'Temporary read failure' });
      return chunk(new TextEncoder().encode('<h1>Complete page</h1>'), 0, true);
    }
    if (url.includes('/fs/text-chunk?')) return Response.json({ ok: true, content: '<h1>Complete page</h1>', nextOffset: 26, eof: true });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  try {
    const { OpenedDroneFilePanel } = await import('../src/droneHub/files/OpenedDroneFilePanel');
    const file = { path: '/index.html', name: 'index.html', kind: 'large-text' as const, mime: 'text/html', size: 15_000_000, content: '', loading: false, saving: false, error: null, dirty: false, mtimeMs: null, targetLine: null, targetColumn: null, navigationSeq: 0 };
    await act(async () => { root.render(<OpenedDroneFilePanel droneId="test" droneName="test" file={file} />); });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Temporary read failure');
    fail = false;
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="Reload preview"]')!.click(); });
    expect(host.querySelector('iframe')?.getAttribute('srcdoc')).toContain('<h1>Complete page</h1>');
    expect(host.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
    const source = Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Source');
    expect(source).toBeDefined();
    await act(async () => { source!.click(); });
    expect(host.querySelector('iframe')).toBeNull();
    expect(host.textContent).toContain('Large file');
    const preview = Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Preview');
    await act(async () => { preview!.click(); });
    expect(host.querySelector('iframe')?.getAttribute('srcdoc')).toContain('<h1>Complete page</h1>');
  } finally {
    await act(async () => root.unmount());
    await dom.happyDOM.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
  }
});
