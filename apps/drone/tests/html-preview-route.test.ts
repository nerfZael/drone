import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { createFilesystemRouteHandler } from '../src/hub/routes/filesystem-routes';

const POLICY = "default-src 'none'; img-src data: blob: http://hub.test/api/drones/drone-a/fs/html-preview/";
let dir = '';
let server: http.Server;
let base = '';

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'html-preview-route-'));
  await fs.writeFile(path.join(dir, 'index.html'), '<h1>Žiga</h1><img src="shot.png">');
  await fs.writeFile(path.join(dir, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await fs.writeFile(path.join(dir, 'notes.txt'), 'secret');
  await fs.mkdir(path.join(dir, 'site', 'viewer'), { recursive: true });
  await fs.writeFile(path.join(dir, 'site', 'index.html'), '<iframe src="viewer/3d.html"></iframe>');
  await fs.writeFile(path.join(dir, 'site', 'viewer', '3d.html'), '<canvas></canvas>');
  await fs.writeFile(path.join(dir, 'outside.html'), 'secret page');
  await fs.symlink(path.join(dir, 'outside.html'), path.join(dir, 'site', 'link.html'));
  const handler = createFilesystemRouteHandler({
    FS_MEDIA_MAX_BYTES: 1024 * 1024,
    droneRuntime: () => 'host',
    normalizeFsPathForRuntime: (_drone: unknown, rawPath: string) => rawPath,
    resolveDroneOrRespond: async (_res: unknown, ref: string) => ({ id: ref, drone: { name: ref } }),
    hostMimeType: async (filePath: string) => (filePath.endsWith('.png') ? 'image/png' : 'text/plain'),
    isLikelyImagePath: (filePath: string) => filePath.endsWith('.png'),
    isLikelyVideoPath: () => false,
    guessImageMimeType: () => 'image/png',
    guessVideoMimeType: () => 'video/mp4',
    hostFsErrorStatus: () => 404,
    looksLikeMissingContainerError: () => false,
  } as any);
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://hub.test');
    void handler({ req, res, url, method: req.method ?? 'GET', parts: url.pathname.split('/').filter(Boolean) }).then((handled) => {
      if (!handled) { res.statusCode = 404; res.end(); }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});

afterAll(async () => {
  server.close();
  await fs.rm(dir, { recursive: true, force: true });
});

async function createSession(drone = 'drone-a', body: Record<string, unknown> = {}) {
  const response = await fetch(`${base}/api/drones/${drone}/fs/html-preview`, {
    method: 'POST',
    body: JSON.stringify({ path: path.join(dir, 'index.html'), contentSecurityPolicy: POLICY, documentPrefix: '<!doctype html><script>guard()</script>', ...body }),
  });
  return { status: response.status, body: await response.json() as any };
}

describe('HTML preview route', () => {
  test('serves the document after its prefix with a sandboxing policy', async () => {
    const { body } = await createSession();
    expect(body.url).toStartWith('/api/drones/drone-a/fs/html-preview/');
    expect(body.url).toEndWith(`${dir}/index.html`);
    const response = await fetch(`${base}${body.url}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBe(`sandbox allow-scripts; ${POLICY}`);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toBe('<!doctype html><script>guard()</script><h1>Žiga</h1><img src="shot.png">');
  });

  test('serves other paths only as images or video, still sandboxed', async () => {
    const { body } = await createSession();
    const image = await fetch(new URL('shot.png', `${base}${body.url}`));
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(image.headers.get('content-security-policy')).toStartWith('sandbox allow-scripts; ');
    expect(Buffer.from(await image.arrayBuffer())).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const text = await fetch(new URL('notes.txt', `${base}${body.url}`));
    expect(text.status).toBe(415);
    expect(await text.text()).not.toContain('secret');
  });

  test('serves HTML files in the previewed file\'s folder to frames, with the same prefix and policy', async () => {
    const { body } = await createSession('drone-a', { path: path.join(dir, 'site', 'index.html') });
    const framed = await fetch(new URL('viewer/3d.html', `${base}${body.url}`));
    expect(framed.status).toBe(200);
    expect(framed.headers.get('content-security-policy')).toBe(`sandbox allow-scripts; ${POLICY}`);
    expect(framed.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await framed.text()).toBe('<!doctype html><script>guard()</script><canvas></canvas>');

    // A page above the folder stays out of reach, however the path is spelled or linked.
    const linked = await fetch(new URL('link.html', `${base}${body.url}`));
    expect(linked.status).toBe(404);
    expect(await linked.text()).not.toContain('secret page');
    for (const escape of ['../outside.html', 'viewer/..%2F..%2Foutside.html']) {
      const response = await fetch(`${base}${body.url.replace(/index\.html$/, escape)}`);
      expect(response.status).toBe(415);
      expect(await response.text()).not.toContain('secret page');
    }
  });

  test('a session is bound to its drone and ends when deleted', async () => {
    const { body } = await createSession();
    const token = body.url.split('/')[6];
    expect((await fetch(`${base}${body.url.replace('/drones/drone-a/', '/drones/drone-b/')}`)).status).toBe(404);
    expect((await fetch(`${base}/api/drones/drone-a/fs/html-preview/${token}`, { method: 'DELETE' })).status).toBe(200);
    expect((await fetch(`${base}${body.url}`)).status).toBe(404);
  });

  test('rejects a policy that could inject response headers', async () => {
    expect((await createSession('drone-a', { contentSecurityPolicy: "default-src 'none'\r\nx-evil: 1" })).status).toBe(400);
    expect((await createSession('drone-a', { contentSecurityPolicy: '' })).status).toBe(400);
  });
});

describe('HTML preview route for a container drone', () => {
  // Stands in for a container: realpath resolves links inside it, and docker cp
  // copies a link as a link, here one pointing at a file on the Hub's side.
  let hubSecret = '';
  let containerServer: http.Server;
  let containerBase = '';
  const links: Record<string, string> = { '/work/site/link.html': '/work/secret.html' };
  const copied: string[] = [];
  beforeAll(async () => {
    hubSecret = path.join(dir, 'hub-secret.txt');
    await fs.writeFile(hubSecret, 'hub secret');
    const handler = createFilesystemRouteHandler({
      FS_MEDIA_MAX_BYTES: 1024 * 1024,
      droneRuntime: () => 'container',
      normalizeFsPathForRuntime: (_drone: unknown, rawPath: string) => rawPath,
      resolveDroneOrRespond: async (_res: unknown, ref: string) => ({ id: ref, drone: { name: ref } }),
      withReadonlyDroneContainer: async (_options: unknown, run: (context: { containerName: string }) => Promise<unknown>) => run({ containerName: 'c' }),
      dvmExec: async (_container: string, command: string, args: string[]) => {
        expect(command).toBe('realpath');
        return { code: 0, stdout: args.slice(2).map((p) => links[p] ?? p).join('\n') + '\n', stderr: '' };
      },
      dvmCopyFromContainer: async (_container: string, source: string, dest: string) => {
        copied.push(source);
        const target = path.join(dest, path.posix.basename(source));
        if (source === '/work/site/swapped.html') await fs.symlink(hubSecret, target);
        else await fs.writeFile(target, `<p>${source}</p>`);
      },
      hostFsErrorStatus: () => 404,
      looksLikeMissingContainerError: () => false,
    } as any);
    containerServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://hub.test');
      void handler({ req, res, url, method: req.method ?? 'GET', parts: url.pathname.split('/').filter(Boolean) }).then((handled) => {
        if (!handled) { res.statusCode = 404; res.end(); }
      });
    });
    await new Promise<void>((resolve) => containerServer.listen(0, '127.0.0.1', resolve));
    containerBase = `http://127.0.0.1:${(containerServer.address() as any).port}`;
  });
  afterAll(() => containerServer.close());

  test('reads the file a link resolves to inside the container, never a link on the Hub', async () => {
    const created = await fetch(`${containerBase}/api/drones/c/fs/html-preview`, {
      method: 'POST',
      body: JSON.stringify({ path: '/work/site/index.html', contentSecurityPolicy: POLICY, documentPrefix: '' }),
    });
    const { url } = await created.json() as any;
    const page = await fetch(`${containerBase}${url}`);
    expect(await page.text()).toBe('<p>/work/site/index.html</p>');

    // A framed page linked out of the folder is refused before anything is copied.
    copied.length = 0;
    expect((await fetch(`${containerBase}${url.replace(/index\.html$/, 'link.html')}`)).status).toBe(404);
    expect(copied).toEqual([]);

    // A file swapped for a link after it resolved arrives as a link and is refused.
    const swapped = await fetch(`${containerBase}${url.replace(/index\.html$/, 'swapped.html')}`);
    expect(swapped.status).toBe(404);
    expect(await swapped.text()).not.toContain('hub secret');
  });
});
