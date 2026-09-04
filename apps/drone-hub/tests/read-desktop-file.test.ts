import { describe, expect, test } from 'bun:test';

import { readDesktopFile } from '../src/droneHub/files/read-desktop-file';

describe('readDesktopFile', () => {
  test('retries with content when server detection disagrees with the media extension', async () => {
    const calls: string[] = [];
    const payload = await readDesktopFile(
      async <T>(url: string) => {
        calls.push(url);
        return (calls.length === 1
          ? { ok: true, kind: 'text', path: '/work/image.png' }
          : { ok: true, kind: 'text', path: '/work/image.png', content: 'real content' }) as T;
      },
      'drone',
      '/work/image.png',
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('metadata=1');
    expect(calls[1]).not.toContain('metadata=1');
    expect(payload).toMatchObject({ kind: 'text', content: 'real content' });
  });

  test('rejects an incomplete text response instead of exposing an empty saved buffer', async () => {
    await expect(
      readDesktopFile(
        async <T>() => ({ ok: true, kind: 'text', path: '/work/image.png' }) as T,
        'drone',
        '/work/image.png',
      ),
    ).rejects.toThrow('text file response missing content');
  });
});
