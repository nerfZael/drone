import { describe, expect, test } from 'bun:test';
import {
  embedMobileHtmlImages,
  loadMobileHtmlImages,
  mobileHtmlLocalImagePaths,
  MOBILE_HTML_PREVIEW_IMAGE_MAX_BYTES,
  MOBILE_HTML_PREVIEW_IMAGES_MAX_BYTES,
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
});
