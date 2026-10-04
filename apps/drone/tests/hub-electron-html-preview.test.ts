import { expect, test } from 'bun:test';
const { streamHtmlDocument, previewPolicy, MAX_DOCUMENT_BYTES } = require('../desktop/hub-electron-html-preview.cjs');

test('separate previews stream ordered bytes with backpressure and cancellation', async () => {
  const bytes = Buffer.from('<h1>Ž🙂</h1>');
  const offsets: number[] = [];
  let signal: AbortSignal | null = null;
  const stream = streamHtmlDocument({ size: bytes.length, signal: new AbortController().signal,
    readChunk: async (offset: number, _limit: number, current: AbortSignal) => {
      signal = current; offsets.push(offset);
      const part = bytes.subarray(offset, offset + 5);
      return { ok: true, offset, nextOffset: offset + part.length, eof: offset + part.length === bytes.length, dataBase64: part.toString('base64') };
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  expect(offsets).toEqual([0]);
  expect(await new Response(stream).text()).toBe('<h1>Ž🙂</h1>');
  expect(offsets).toEqual([0, 5, 10]);
  const pending = streamHtmlDocument({ size: bytes.length, signal: new AbortController().signal,
    readChunk: async (_offset: number, _limit: number, current: AbortSignal) => {
      signal = current;
      return { ok: true, offset: 0, nextOffset: 1, eof: false, dataBase64: 'YQ==' };
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  await pending.cancel();
  expect(signal!.aborted).toBe(true);
});

test('separate previews reject changing files, invalid chunks and excessive sizes', async () => {
  const options = { size: 1, signal: new AbortController().signal, readChunk: async () => ({ ok: true, offset: 0, nextOffset: 2, eof: true, dataBase64: 'YWE=' }) };
  await expect(new Response(streamHtmlDocument(options)).text()).rejects.toThrow('changed while loading');
  await expect(new Response(streamHtmlDocument({ ...options, readChunk: async () => ({ ok: true, offset: 4, nextOffset: 4, eof: false, dataBase64: '' }) })).text()).rejects.toThrow('Invalid HTML');
  expect(() => streamHtmlDocument({ ...options, size: MAX_DOCUMENT_BYTES + 1 })).toThrow('512 MiB');
  expect(previewPolicy('https://preview.invalid')).toContain("sandbox allow-scripts");
  expect(previewPolicy('https://preview.invalid')).toContain("connect-src 'none'");
  expect(previewPolicy('https://preview.invalid')).not.toContain('allow-same-origin');
});
