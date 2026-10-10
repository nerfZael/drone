import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { readLargeHtmlSource } from '../src/droneHub/files/read-large-html-source';
import { HTML_COPY_MAX_BYTES } from '../src/droneHub/files/html-preview-limits';

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

test('rejects oversized metadata before fetching and enforces the byte limit when metadata is stale', async () => {
  const original = globalThis.fetch;
  let requests = 0;
  const payload = new Uint8Array(512 * 1024);
  globalThis.fetch = (async (url: string) => {
    requests++;
    const offset = Number(new URL(url, 'http://localhost').searchParams.get('offset'));
    return chunk(payload, offset, false);
  }) as typeof fetch;
  try {
    await expect(readLargeHtmlSource('drone', '/huge.html', new AbortController().signal, 145766804)).rejects.toThrow('20 MiB');
    expect(requests).toBe(0);
    await expect(readLargeHtmlSource('drone', '/growing.html', new AbortController().signal, 1)).rejects.toThrow('20 MiB');
    expect(requests).toBe(HTML_COPY_MAX_BYTES / payload.length + 1);
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

async function withPanelDom(run: (input: { dom: Window; host: HTMLElement; root: ReturnType<typeof createRoot> }) => Promise<void>) {
  const dom = new Window({ url: 'http://127.0.0.1:5173/' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'ResizeObserver', 'MutationObserver', 'DOMParser', 'localStorage', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT']) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom as any)[key] });
  }
  const originalFetch = globalThis.fetch;
  const host = dom.document.createElement('div');
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  try {
    await run({ dom, host: host as unknown as HTMLElement, root });
  } finally {
    await act(async () => root.unmount());
    await dom.happyDOM.close();
    globalThis.fetch = originalFetch;
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
  }
}

const SESSION_URL = '/api/drones/test/fs/html-preview/token-1/work/index.html';

test('a large HTML file loads inside its sandboxed frame by URL, never into the Hub page', async () => {
  await withPanelDom(async ({ host, root }) => {
    const requests: Array<{ url: string; method: string; body: any }> = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      requests.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url === '/api/drones/test/fs/html-preview') return Response.json({ ok: true, url: SESSION_URL });
      if (init?.method === 'DELETE') return Response.json({ ok: true });
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;
    const { OpenedDroneFilePanel } = await import('../src/droneHub/files/OpenedDroneFilePanel');
    const file = { path: '/work/index.html', name: 'index.html', kind: 'large-text' as const, mime: 'text/html', size: 145_766_804, content: '', loading: false, saving: false, error: null, dirty: false, mtimeMs: null, targetLine: null, targetColumn: null, navigationSeq: 0 };
    await act(async () => { root.render(<OpenedDroneFilePanel droneId="test" droneName="test" file={file} />); });
    const frame = host.querySelector('iframe');
    expect(frame?.getAttribute('src')).toBe(SESSION_URL);
    expect(frame?.hasAttribute('srcdoc')).toBe(false);
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(requests.map(request => request.url).filter(url => url.startsWith('/api/drones/'))).toEqual(['/api/drones/test/fs/html-preview']);
    const { body } = requests[0];
    expect(body.path).toBe('/work/index.html');
    expect(body.contentSecurityPolicy).toContain("connect-src 'none'");
    expect(body.contentSecurityPolicy).toContain('img-src data: blob: http://127.0.0.1:5173/api/drones/test/fs/html-preview/;');
    expect(body.documentPrefix).toContain("document.addEventListener('click'");
    await act(async () => { root.render(<OpenedDroneFilePanel droneId="test" droneName="test" file={{ ...file, path: '/work/other.html' }} />); });
    expect(requests.find(request => request.method === 'DELETE')?.url).toBe('/api/drones/test/fs/html-preview/token-1');
  });
});

test('an open buffer renders in place and resolves its local images through the preview URL', async () => {
  await withPanelDom(async ({ host, root }) => {
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (url === '/api/drones/test/fs/html-preview') return Response.json({ ok: true, url: SESSION_URL });
      if (init?.method === 'DELETE') return Response.json({ ok: true });
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;
    const { IsolatedHtmlPreview } = await import('../src/droneHub/files/IsolatedHtmlPreview');
    await act(async () => { root.render(<IsolatedHtmlPreview source={'<img src="shot.png">'} droneId="test" filePath="/work/index.html" />); });
    const document = host.querySelector('iframe')?.getAttribute('srcdoc') ?? '';
    expect(document.startsWith(`<!doctype html><base href="${SESSION_URL}">`)).toBe(true);
    expect(document.indexOf('<base')).toBeLessThan(document.indexOf("base-uri 'none'"));
    expect(document).toEndWith('<img src="shot.png">');
  });
});
