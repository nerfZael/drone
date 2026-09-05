import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceHttpTransfers } from '../src/hub/device-mesh/workspace-http-transfers';
import { createWorkspaceUploadSink } from '../src/hub/device-mesh/workspace-upload-sink';
import { DeviceRequestJournal } from '../src/hub/device-mesh/device-request-journal';
import crypto from 'node:crypto';
import { DeviceResultUploads } from '../src/hub/device-mesh/device-result-uploads';

test('workspace HTTP streams resume, bind revisions, and recheck grants', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-http-test-'));
  let endpoint = '';
  let allowed = true;
  const transfers = new WorkspaceHttpTransfers(
    { read: async () => ({ devices: { source: { id: 'source' } } }) } as any,
    () => endpoint,
  );
  const server = http.createServer((request, response) => {
    void transfers
      .handlePublic(request, response, new URL(request.url!, endpoint))
      .catch(() => response.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const file = path.join(root, 'body');
    await fs.writeFile(file, 'ab');
    const upload = transfers.issue({
      source: 'source',
      method: 'PUT',
      size: 6,
      resolve: async () => file,
      authorized: async () => allowed,
    });
    const sink = await createWorkspaceUploadSink();
    try {
      await sink.write(new TextEncoder().encode('cd'));
      await sink.write(new TextEncoder().encode('ef'));
      expect(await sink.finish(upload, 2)).toBe(6);
    } finally {
      await sink.close();
    }
    expect(await fs.readFile(file, 'utf8')).toBe('abcdef');
    const info = await fs.stat(file);
    const download = transfers.issue({
      source: 'source',
      method: 'GET',
      size: 6,
      revision: `"${info.size}-${info.mtimeMs}-${info.ino}"`,
      resolve: async () => file,
      authorized: async () => allowed,
    });
    expect((await fetch(download.url)).status).toBe(401);
    const response = await fetch(download.url, {
      headers: { authorization: `Bearer ${download.token}`, Range: 'bytes=2-' },
    });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe('cdef');
    const wholeRange = await fetch(download.url, {
      headers: { authorization: `Bearer ${download.token}`, Range: 'bytes=0-' },
    });
    expect(wholeRange.status).toBe(206);
    expect(wholeRange.headers.get('content-range')).toBe('bytes 0-5/6');
    expect(await wholeRange.text()).toBe('abcdef');
    const changedRange = await fetch(download.url, {
      headers: {
        authorization: `Bearer ${download.token}`,
        Range: 'bytes=2-',
        'if-range': '"old"',
      },
    });
    expect(changedRange.status).toBe(200);
    expect(await changedRange.text()).toBe('abcdef');
    allowed = false;
    expect(
      (await fetch(download.url, { headers: { authorization: `Bearer ${download.token}` } }))
        .status,
    ).toBe(403);
    allowed = true;
    await fs.writeFile(file, 'ghijkl');
    await fs.utimes(file, 1, 1);
    expect(
      (await fetch(download.url, { headers: { authorization: `Bearer ${download.token}` } }))
        .status,
    ).toBe(412);
  } finally {
    transfers.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('accepted mutations survive journal restart without keeping command payloads', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'request-journal-test-'));
  try {
    const request = {
      sourceDeviceId: 'source',
      requestId: 'one',
      operation: 'files.write',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      payload: { secret: 'private-content' },
    } as any;
    expect(await new DeviceRequestJournal(root).accept(request)).toBe(true);
    expect(await new DeviceRequestJournal(root).accept(request)).toBe(false);
    expect(await fs.readFile(path.join(root, (await fs.readdir(root))[0]), 'utf8')).not.toContain(
      'private-content',
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('phone preview broker withholds downloads until a checksummed upload completes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phone-result-http-test-'));
  let endpoint = '';
  let revoked = false;
  const store = {
    read: async () => ({
      devices: {
        source: { id: 'source' },
        phone: { id: 'phone', revokedAt: revoked ? 'revoked' : null },
      },
    }),
  } as any;
  const transfers = new WorkspaceHttpTransfers(store, () => endpoint);
  const broker = new DeviceResultUploads(root, store, transfers);
  const server = http.createServer((request, response) => {
    void transfers.handlePublic(request, response, new URL(request.url!, endpoint));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const request = { sourceDeviceId: 'source', targetDeviceId: 'phone' } as any;
    const revision = `sha256:${crypto.createHash('sha256').update('abc').digest('hex')}`;
    const tickets = await broker.prepare(request, 3, revision);
    const read = () =>
      fetch(tickets.download.url, {
        headers: { authorization: `Bearer ${tickets.download.token}` },
      });
    expect((await read()).status).toBe(403);
    const upload = await fetch(tickets.upload.url, {
      method: 'PUT',
      headers: { authorization: `Bearer ${tickets.upload.token}` },
      body: 'abc',
    });
    expect(upload.status).toBe(200);
    expect(await (await read()).text()).toBe('abc');
    revoked = true;
    expect((await read()).status).toBe(403);
    revoked = false;
    const corrupt = await broker.prepare(request, 3, revision);
    expect(
      (
        await fetch(corrupt.upload.url, {
          method: 'PUT',
          headers: { authorization: `Bearer ${corrupt.upload.token}` },
          body: 'xyz',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(corrupt.download.url, {
          headers: { authorization: `Bearer ${corrupt.download.token}` },
        })
      ).status,
    ).toBe(403);
  } finally {
    broker.close();
    transfers.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(root, { recursive: true, force: true });
  }
});
