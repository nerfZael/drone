import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { embedHtmlPreviewImages, resolveHtmlPreviewImagePath, readHtmlPreviewImage, htmlPreviewImageBridge, HTML_PREVIEW_IMAGE_RESPONSE } from '../src/droneHub/files/html-preview-images';
import { buildIsolatedHtmlPreviewDocument } from '../src/droneHub/files/html-preview-security';

test('resolves images relative to the HTML file without treating URLs as filesystem requests', () => {
  expect(resolveHtmlPreviewImagePath('/reviews/index.html', '01-hud-desktop/desktop-combat.png')).toBe('/reviews/01-hud-desktop/desktop-combat.png');
  expect(resolveHtmlPreviewImagePath('/reviews/index.html', '../assets/unit%20portrait.png?v=2')).toBe('/assets/unit portrait.png');
  expect(resolveHtmlPreviewImagePath('/reviews/index.html', '/tmp/combat.png')).toBe('/tmp/combat.png');
  for (const url of ['https://example.com/image.png', '//example.com/image.png', 'data:image/png;base64,abc', 'blob:test', 'file:///tmp/image.png', '#map', '../../secret.png', 'bad%ZZ.png']) {
    expect(resolveHtmlPreviewImagePath('/reviews/index.html', url)).toBeNull();
  }
});

test('embeds review screenshots, deduplicates reads, and leaves network isolation intact', async () => {
  const dom = new Window();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
  Object.defineProperty(globalThis, 'DOMParser', { configurable: true, value: dom.DOMParser });
  try {
    const paths: string[] = [];
    const result = await embedHtmlPreviewImages(`<!doctype html><html><head><style>body { color: white; }</style></head><body class="review">
      <img src="01-hud-desktop/desktop-combat.png"><img src="01-hud-desktop/desktop-combat.png">
      <img src="missing.png"><img src="https://example.com/remote.png"><img src="data:image/png;base64,existing">
    </body></html>`, '/reviews/index.html', async path => {
      paths.push(path);
      if (path.endsWith('missing.png')) throw new Error('Missing file');
      return 'data:image/png;base64,screenshot';
    });
    expect(paths.sort()).toEqual(['/reviews/01-hud-desktop/desktop-combat.png', '/reviews/missing.png']);
    expect(result.failed).toBe(1);
    const parsed = new dom.DOMParser().parseFromString(result.source, 'text/html');
    expect(parsed.querySelectorAll('img[src="data:image/png;base64,screenshot"]')).toHaveLength(2);
    expect(parsed.body.className).toBe('review');
    expect(parsed.querySelector('style')?.textContent).toContain('color: white');
    expect(parsed.querySelector('img[src="https://example.com/remote.png"]')).not.toBeNull();
    const document = buildIsolatedHtmlPreviewDocument(result.source);
    expect(document).toContain('img-src data: blob:');
    expect(document).toContain("connect-src 'none'");
  } finally {
    if (original) Object.defineProperty(globalThis, 'DOMParser', original);
    else delete (globalThis as any).DOMParser;
    await dom.happyDOM.close();
  }
});

test('reads only the drone media endpoint and rejects non-image files', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  let requested = '';
  globalThis.fetch = (async (url: string) => {
    requested = url;
    return new Response('<script>secret</script>', { headers: { 'Content-Type': 'text/html' } });
  }) as typeof fetch;
  try {
    await expect(readHtmlPreviewImage('drone/one', '/reviews/combat.png', controller.signal)).rejects.toThrow('Not an image');
    expect(requested).toBe('/api/drones/drone%2Fone/fs/media?path=%2Freviews%2Fcombat.png');
  } finally {
    globalThis.fetch = original;
  }
});

test('loads scripted image switches and ignores stale or unauthenticated replies', async () => {
  const dom = new Window();
  const requests: Array<{ id: string; href: string; token: string }> = [];
  dom.postMessage = (data: any) => { requests.push(data); };
  try {
    const install = new Function('window', 'parent', 'document', 'Element', 'HTMLImageElement', 'MutationObserver',
      htmlPreviewImageBridge('test-session').replace(/^<script>\n|\n<\/script>$/g, ''));
    install(dom, dom, dom.document, dom.Element, dom.HTMLImageElement, dom.MutationObserver);
    const image = dom.document.createElement('img');
    dom.document.body.append(image);
    image.src = 'before/base.png';
    const before = requests.at(-1)!;
    image.setAttribute('src', 'after/base.png');
    const after = requests.at(-1)!;
    expect(before.href).toBe('before/base.png');
    expect(after.href).toBe('after/base.png');
    const reply = (id: string, dataUrl: string, token = 'test-session', source: any = dom) => {
      dom.dispatchEvent(new dom.MessageEvent('message', { source, data: { type: HTML_PREVIEW_IMAGE_RESPONSE, token, id, dataUrl } }));
    };
    reply(before.id, 'data:image/png;base64,before');
    expect(image.getAttribute('src')).toBeNull();
    reply(after.id, 'data:image/png;base64,after', 'wrong-session');
    reply(after.id, 'data:image/png;base64,after', 'test-session', null);
    expect(image.getAttribute('src')).toBeNull();
    reply(after.id, 'data:image/png;base64,after');
    expect(image.getAttribute('src')).toBe('data:image/png;base64,after');
    image.src = 'https://example.com/remote.png';
    expect(requests).toHaveLength(2);
    expect(image.getAttribute('src')).toBe('https://example.com/remote.png');
    dom.document.body.insertAdjacentHTML('beforeend', '<img id="inserted" src="after/detail.png">');
    await dom.happyDOM.waitUntilComplete();
    expect(requests.at(-1)?.href).toBe('after/detail.png');
    reply(requests.at(-1)!.id, 'data:image/png;base64,detail');
    expect(dom.document.getElementById('inserted')?.getAttribute('src')).toBe('data:image/png;base64,detail');
  } finally {
    await dom.happyDOM.close();
  }
});
