import { describe, expect, test } from 'bun:test';
import {
  createMobileHtmlImageBudget,
  createMobileHtmlRuntimeImages,
  embedMobileHtmlImages,
  loadMobileHtmlImages,
  mobileHtmlLocalImagePaths,
  MOBILE_HTML_PREVIEW_IMAGE_MAX_BYTES,
  MOBILE_HTML_PREVIEW_IMAGES_MAX_BYTES,
  MOBILE_HTML_PREVIEW_MAX_IMAGES,
  mobileHtmlPreviewImagePath,
  resolveMobileHtmlImagePath,
} from '../src/drones/mobile-html-preview-images';

describe('mobile HTML preview images', () => {
  test('resolves relative and root paths, and ignores URLs, fragments and data', () => {
    const page = '/work/site/index.html';
    expect(resolveMobileHtmlImagePath(page, 'shot.png')).toBe('/work/site/shot.png');
    expect(resolveMobileHtmlImagePath(page, './img/a%20b.png?v=2#x')).toBe('/work/site/img/a b.png');
    expect(resolveMobileHtmlImagePath(page, '../assets/logo.svg')).toBe('/work/assets/logo.svg');
    expect(resolveMobileHtmlImagePath(page, '/tmp/x.png')).toBe('/tmp/x.png');
    expect(resolveMobileHtmlImagePath(page, 'a&amp;b.png')).toBe('/work/site/a&b.png');
    for (const src of ['https://example.com/x.png', '//cdn/x.png', 'data:image/png;base64,AA', '#frag', '']) {
      expect(resolveMobileHtmlImagePath(page, src)).toBeNull();
    }
  });

  test('finds each local img once across quoting styles and leaves other tags alone', () => {
    const source = `<img src="a.png"><IMG alt='x' src='b.png'><img src=c.png><img src="a.png"><script src="d.js"></script><img src="https://e/x.png">`;
    expect(mobileHtmlLocalImagePaths(source, '/w/index.html')).toEqual(['/w/a.png', '/w/b.png', '/w/c.png']);
  });

  test('embeds loaded images in their quote style and never inside scripts or comments', () => {
    const script = `<script>const s = "<img src=a.png>"; const t = '<img src="a.png">';</script><!-- <img src="a.png"> -->`;
    const source = `<p>hi</p><img class="x" src='a.png'><img src=a.png><img src="missing.png">${script}<img src="a.png">`;
    expect(mobileHtmlLocalImagePaths(`${script}<img src="b.png">`, '/w/index.html')).toEqual(['/w/b.png']);
    const html = embedMobileHtmlImages(source, '/w/index.html', new Map([['/w/a.png', 'data:image/png;base64,AA==']]));
    expect(html).toBe(`<p>hi</p><img class="x" src='data:image/png;base64,AA=='><img src="data:image/png;base64,AA=="><img src="missing.png">${script}<img src="data:image/png;base64,AA==">`);
  });

  test('counts misses and respects the per-image limit', async () => {
    const asked: Array<[string, number]> = [];
    const { images, failed } = await loadMobileHtmlImages(
      '<img src="a.png"><img src="b.png">',
      '/w/index.html',
      async (path, maxBytes) => {
        asked.push([path, maxBytes]);
        if (path.endsWith('b.png')) throw new Error('Not an image');
        return { mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) };
      },
      new AbortController().signal,
    );
    expect(asked.map(([path]) => path).sort()).toEqual(['/w/a.png', '/w/b.png']);
    expect(asked.every(([, max]) => max === MOBILE_HTML_PREVIEW_IMAGE_MAX_BYTES)).toBe(true);
    expect(images.get('/w/a.png')).toBe('data:image/png;base64,AQID');
    expect(failed).toBe(1);
  });

  test('stops embedding once the page budget is spent', async () => {
    const size = MOBILE_HTML_PREVIEW_IMAGE_MAX_BYTES;
    const count = Math.ceil(MOBILE_HTML_PREVIEW_IMAGES_MAX_BYTES / size) + 1;
    const source = Array.from({ length: count }, (_, i) => `<img src="${i}.png">`).join('');
    const { images, failed } = await loadMobileHtmlImages(
      source,
      '/w/index.html',
      async (_path, maxBytes) => ({ mime: 'image/png', bytes: new Uint8Array(Math.min(size, maxBytes)) }),
      new AbortController().signal,
    );
    expect(images.size).toBe(MOBILE_HTML_PREVIEW_IMAGES_MAX_BYTES / size);
    expect(failed).toBe(count - images.size);
  });

  test('maps blocked image URLs on the preview origin back to files', () => {
    const page = 'https://drone-hub-preview.invalid/work/site/index.html';
    expect(mobileHtmlPreviewImagePath(page, 'https://drone-hub-preview.invalid/work/site/img/a%20b.png')).toBe('/work/site/img/a b.png');
    expect(mobileHtmlPreviewImagePath(page, 'https://drone-hub-preview.invalid/work/site/../x.png?v=1')).toBe('/work/x.png');
    for (const url of ['https://example.com/work/a.png', 'https://u:p@drone-hub-preview.invalid/a.png', 'https://drone-hub-preview.invalid/', 'https://drone-hub-preview.invalid/%E0', 'nope']) {
      expect(mobileHtmlPreviewImagePath(page, url)).toBeNull();
    }
  });

  test('serves each image the running page asks for once, within the shared budget', async () => {
    const budget = createMobileHtmlImageBudget();
    budget.images = 2;
    const delivered: string[] = [];
    let failed = 0;
    const asked: string[] = [];
    const runtime = createMobileHtmlRuntimeImages({
      documentUrl: 'https://drone-hub-preview.invalid/w/index.html',
      readImage: async (path) => {
        asked.push(path);
        return { mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) };
      },
      budget,
      signal: new AbortController().signal,
      requestType: 'image',
      deliver: (url, dataUrl) => delivered.push(`${url} ${dataUrl}`),
      onFailed: () => { failed += 1; },
    });
    const ask = (url: string, type = 'image') => runtime.request(JSON.stringify({ type, url }));
    ask('https://drone-hub-preview.invalid/w/bg.png');
    ask('https://drone-hub-preview.invalid/w/bg.png');
    ask('https://example.com/x.png');
    ask('https://drone-hub-preview.invalid/w/other.png', 'navigate');
    runtime.request('not json');
    runtime.request({ type: 'image', url: 'https://drone-hub-preview.invalid/w/obj.png' });
    ask('https://drone-hub-preview.invalid/w/hero.png');
    ask('https://drone-hub-preview.invalid/w/third.png');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked).toEqual(['/w/bg.png', '/w/hero.png']);
    expect(delivered).toEqual([
      'https://drone-hub-preview.invalid/w/bg.png data:image/png;base64,AQID',
      'https://drone-hub-preview.invalid/w/hero.png data:image/png;base64,AQID',
    ]);
    expect(failed).toBe(1);
    expect(budget.bytes).toBe(MOBILE_HTML_PREVIEW_IMAGES_MAX_BYTES - 6);
  });

  test('images embedded up front and asked for later draw on one page budget', async () => {
    const budget = createMobileHtmlImageBudget();
    const source = Array.from({ length: MOBILE_HTML_PREVIEW_MAX_IMAGES }, (_, i) => `<img src="${i}.png">`).join('');
    await loadMobileHtmlImages(source, '/w/index.html', async () => ({ mime: 'image/png', bytes: new Uint8Array(1) }), new AbortController().signal, budget);
    expect(budget.images).toBe(0);
    let failed = 0;
    const runtime = createMobileHtmlRuntimeImages({
      documentUrl: 'https://drone-hub-preview.invalid/w/index.html',
      readImage: async () => ({ mime: 'image/png', bytes: new Uint8Array(1) }),
      budget,
      signal: new AbortController().signal,
      requestType: 'image',
      deliver: () => { throw new Error('over budget'); },
      onFailed: () => { failed += 1; },
    });
    runtime.request(JSON.stringify({ type: 'image', url: 'https://drone-hub-preview.invalid/w/late.png' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(failed).toBe(1);
  });
});
