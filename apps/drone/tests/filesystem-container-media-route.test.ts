import crypto from 'node:crypto';
import { describe, expect, test } from 'bun:test';

import { createFilesystemRouteHandler } from '../src/hub/routes/filesystem-routes';

function responseHarness() {
  const headers = new Map<string, string>();
  let body: Buffer | string | undefined;
  const response = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader(name: string, value: unknown) {
      headers.set(name.toLowerCase(), String(value));
    },
    once() {},
    end(value?: Buffer | string) {
      body = value;
      this.writableEnded = true;
    },
  };
  return { response, headers, body: () => body };
}

describe('container filesystem media route', () => {
  test('applies HEAD, range, mismatch, empty-file, and multi-range semantics', async () => {
    const bytes = Buffer.from('0123456789');
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    const execOptions: any[] = [];
    const handler = createFilesystemRouteHandler({
      FS_EDITOR_MAX_BYTES: 1024,
      FS_LIST_TIMEOUT_MS: 1000,
      FS_MEDIA_MAX_BYTES: 1024,
      FS_QUICK_OPEN_MAX_RESULTS: 10,
      FS_TEXT_CHUNK_MAX_BYTES: 1024,
      FS_THUMB_MAX_BYTES: 1024,
      NON_REPO_HOME_CWD: '/work',
      droneRuntime: () => 'container',
      normalizeFsPathForRuntime: (_drone: unknown, rawPath: string) => rawPath,
      resolveDroneOrRespond: async () => ({ id: 'drone-a', drone: { name: 'Drone A' } }),
      isLikelyImagePath: () => false,
      isLikelyVideoPath: () => true,
      guessImageMimeType: () => 'image/png',
      guessVideoMimeType: () => 'video/mp4',
      looksLikeMissingContainerError: () => false,
      withReadonlyDroneContainer: async (_input: unknown, run: (value: unknown) => unknown) =>
        await run({ containerName: 'container-a' }),
      dvmExec: async (_container: string, _command: string, args: string[], options: unknown) => {
        execOptions.push(options);
        const script = args.at(-1) ?? '';
        const head = script.includes('include_body=0');
        const empty = script.includes("target='/work/empty.mp4'");
        const total = empty ? 0 : bytes.length;
        const rangeKind = script.match(/range_kind='([^']+)'/)?.[1] ?? 'full';
        if (rangeKind === 'invalid') {
          return { code: 5, stdout: `__ERR__\trange\t${total}\n`, stderr: '' };
        }
        let start = 0;
        let count = total;
        const partial = rangeKind === 'full' ? 0 : 1;
        if (rangeKind === 'from') {
          start = Number(script.match(/range_start=(\d+)/)?.[1] ?? 0);
          const requestedEnd = Number(script.match(/range_end=(-?\d+)/)?.[1] ?? -1);
          if (start >= total || (requestedEnd >= 0 && requestedEnd < start)) {
            return { code: 5, stdout: `__ERR__\trange\t${total}\n`, stderr: '' };
          }
          count = Math.min(requestedEnd < 0 ? total - 1 : requestedEnd, total - 1) - start + 1;
        } else if (rangeKind === 'suffix') {
          const suffix = Number(script.match(/suffix_length=(\d+)/)?.[1] ?? 0);
          if (total === 0 || suffix <= 0) {
            return { code: 5, stdout: `__ERR__\trange\t${total}\n`, stderr: '' };
          }
          start = Math.max(0, total - suffix);
          count = total - start;
        }
        const servedDigest = script.includes('include_revision=0')
          ? ''
          : empty
            ? crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex')
            : digest;
        return {
          code: 0,
          stdout: `__META__\tvideo/mp4\t${total}\t${start}\t${count}\t${partial}\t${servedDigest}\t${total}\n${head || empty ? '' : bytes.subarray(start, start + count).toString('base64')}`,
          stderr: '',
        };
      },
    } as any);

    const request = async (
      method: string,
      range: string | undefined,
      revision?: string,
      path = '/work/video.mp4',
    ) => {
      const result = responseHarness();
      const url = new URL(
        `http://hub.test/api/drones/drone-a/fs/media?path=${encodeURIComponent(path)}`,
      );
      if (revision) url.searchParams.set('revision', revision);
      await handler({
        req: {
          headers: range ? { range } : {},
          once() {},
        } as any,
        res: result.response as any,
        url,
        method,
        parts: ['api', 'drones', 'drone-a', 'fs', 'media'],
      });
      return result;
    };

    const get = await request('GET', 'bytes=2-5', `sha256:${digest}`);
    expect(get.response.statusCode).toBe(206);
    expect(get.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(get.headers.get('content-length')).toBe('4');
    expect(get.body()).toEqual(bytes.subarray(2, 6));

    const unversioned = await request('GET', undefined);
    expect(unversioned.response.statusCode).toBe(200);
    expect(unversioned.headers.get('cache-control')).toBe('no-store');
    expect(unversioned.body()).toEqual(bytes);

    const head = await request('HEAD', 'bytes=2-5', `sha256:${digest}`);
    expect(head.response.statusCode).toBe(206);
    expect(head.headers.get('content-length')).toBe('4');
    expect(head.body()).toBeUndefined();

    const mismatch = await request('HEAD', 'bytes=2-5', `sha256:${'0'.repeat(64)}`);
    expect(mismatch.response.statusCode).toBe(409);
    expect(mismatch.headers.get('cache-control')).toBe('no-store');

    const multi = await request('GET', 'bytes=0-1,4-5', `sha256:${digest}`);
    expect(multi.response.statusCode).toBe(416);
    expect(multi.headers.get('content-range')).toBe('bytes */10');

    for (const malformed of ['bytes=-0', 'bytes=bad']) {
      const invalid = await request('GET', malformed, `sha256:${digest}`);
      expect(invalid.response.statusCode).toBe(416);
      expect(invalid.headers.get('content-range')).toBe('bytes */10');
    }
    const exactEof = await request('GET', 'bytes=9-', `sha256:${digest}`);
    expect(exactEof.response.statusCode).toBe(206);
    expect(exactEof.body()).toEqual(bytes.subarray(9));
    const largeSuffix = await request('GET', 'bytes=-20', `sha256:${digest}`);
    expect(largeSuffix.response.statusCode).toBe(206);
    expect(largeSuffix.body()).toEqual(bytes);

    const empty = await request(
      'HEAD',
      undefined,
      `sha256:${crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex')}`,
      '/work/empty.mp4',
    );
    expect(empty.response.statusCode).toBe(200);
    expect(empty.headers.get('content-length')).toBe('0');
    expect(empty.body()).toBeUndefined();
    expect(execOptions.every((options) => options.timeoutMs === 60_000)).toBe(true);
    expect(execOptions.every((options) => options.maxOutputBytes > 0)).toBe(true);
  });
});
