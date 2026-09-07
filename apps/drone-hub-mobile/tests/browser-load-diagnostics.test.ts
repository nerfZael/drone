import { expect, test } from 'bun:test';
import { parseBrowserLoadDiagnostics } from '../src/drones/browser-load-diagnostics';

test('browser diagnostics accept only bounded numeric metrics from untrusted pages', () => {
  expect(
    parseBrowserLoadDiagnostics(
      JSON.stringify({
        type: 'drone-browser-load',
        metrics: {
          firstContentfulPaintMs: 123.4,
          resourceCount: 204,
          resourceTransferBytes: -1,
          documentLoadMs: '3000',
          resourceEncodedBytes: 1e100,
          url: 'secret',
          cookie: 'secret',
        },
      }),
    ),
  ).toEqual({ firstContentfulPaintMs: 123, resourceCount: 204 });
  for (const data of [
    'bad json',
    'null',
    '{}',
    ' '.repeat(2049),
    '{"type":"other","metrics":{"resourceCount":1}}',
  ])
    expect(parseBrowserLoadDiagnostics(data)).toBeNull();
});
