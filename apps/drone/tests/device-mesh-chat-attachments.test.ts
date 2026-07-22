import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { MeshChatAttachmentStore } from '../src/hub/device-mesh/mesh-chat-attachment-store';
import { MeshChatAttachmentHttp } from '../src/hub/device-mesh/mesh-chat-attachment-http';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('mesh chat attachment store', () => {
  test('removes abandoned upload files when the store starts', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-chat-recovery-'));
    roots.push(root);
    await fs.writeFile(path.join(root, 'mesh-upload-abandoned.part'), 'partial');
    await fs.writeFile(path.join(root, 'unrelated.txt'), 'keep');
    const store = new MeshChatAttachmentStore(root);
    try {
      await store.initialize();
      expect(await fs.readdir(root)).toEqual(['unrelated.txt']);
    } finally {
      await store.close();
    }
  });

  test('validates metadata before creating a temporary file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-chat-validation-'));
    roots.push(root);
    const store = new MeshChatAttachmentStore(root);
    try {
      await expect(
        store.prepare({
          sourceDeviceId: 'phone-1',
          droneId: 'drone-1',
          chatName: 'default',
          name: 'payload.bin',
          mime: 'invalid',
          size: 10,
        }),
      ).rejects.toThrow('MIME type');
      await expect(
        store.prepare({
          sourceDeviceId: 'phone-1',
          droneId: 'drone-1',
          chatName: 'default',
          name: 'image.png',
          mime: 'image/png',
          size: 10,
          sha256: 'invalid',
        }),
      ).rejects.toThrow('sha256');
      expect(await fs.readdir(root)).toEqual([]);
    } finally {
      await store.close();
    }
  });

  test('sanitizes attachment filenames without rejecting long names', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-chat-filename-'));
    roots.push(root);
    const store = new MeshChatAttachmentStore(root);
    try {
      const prepared = await store.prepare({
        sourceDeviceId: 'phone-1',
        droneId: 'drone-1',
        chatName: 'default',
        name: `../folder/${'a'.repeat(300)}.txt`,
        mime: 'text/plain',
        size: 1,
      });
      await store.writeMesh({
        sourceDeviceId: 'phone-1',
        uploadId: prepared.uploadId,
        offset: 0,
        dataBase64: Buffer.from('x').toString('base64'),
      });
      await expect(store.commit('phone-1', prepared.uploadId)).resolves.toMatchObject({
        name: 'a'.repeat(240),
      });
    } finally {
      await store.close();
    }
  });

  test('rejects overlapping writes to one upload session', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-chat-write-lock-'));
    roots.push(root);
    const store = new MeshChatAttachmentStore(root);
    try {
      const prepared = await store.prepare({
        sourceDeviceId: 'phone-1',
        droneId: 'drone-1',
        chatName: 'default',
        name: 'payload.bin',
        mime: 'application/octet-stream',
        size: 2,
      });
      const firstWrite = store.writeMesh({
        sourceDeviceId: 'phone-1',
        uploadId: prepared.uploadId,
        offset: 0,
        dataBase64: Buffer.from('a').toString('base64'),
      });
      await expect(
        store.writeMesh({
          sourceDeviceId: 'phone-1',
          uploadId: prepared.uploadId,
          offset: 0,
          dataBase64: Buffer.from('b').toString('base64'),
        }),
      ).rejects.toMatchObject({ code: 'TRANSFER_BUSY' });
      await firstWrite;
      await expect(
        store.writeMesh({
          sourceDeviceId: 'phone-1',
          uploadId: prepared.uploadId,
          offset: 1,
          dataBase64: Buffer.from('b').toString('base64'),
        }),
      ).resolves.toMatchObject({ offset: 2, complete: true });
    } finally {
      await store.close();
    }
  });

  test('limits abandoned upload sessions per source device', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-chat-session-limit-'));
    roots.push(root);
    const store = new MeshChatAttachmentStore(root);
    try {
      for (let index = 0; index < 16; index += 1) {
        await store.prepare({
          sourceDeviceId: 'phone-1',
          droneId: 'drone-1',
          chatName: 'default',
          name: `image-${index}.png`,
          mime: 'image/png',
          size: 1,
        });
      }
      await expect(
        store.prepare({
          sourceDeviceId: 'phone-1',
          droneId: 'drone-1',
          chatName: 'default',
          name: 'one-too-many.png',
          mime: 'image/png',
          size: 1,
        }),
      ).rejects.toThrow('too many active attachment uploads');
    } finally {
      await store.close();
    }
  });

  test('accepts resumable mesh chunks and scopes committed images to their chat', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-chat-attachments-'));
    roots.push(root);
    const store = new MeshChatAttachmentStore(root);
    try {
      const source = Buffer.from('a prompt image');
      const prepared = await store.prepare({
        sourceDeviceId: 'phone-1',
        droneId: 'drone-1',
        chatName: 'default',
        name: 'image.png',
        mime: 'image/png',
        size: source.length,
      });
      await store.writeMesh({
        sourceDeviceId: 'phone-1',
        uploadId: prepared.uploadId,
        offset: 0,
        dataBase64: source.subarray(0, 5).toString('base64'),
      });
      await store.writeMesh({
        sourceDeviceId: 'phone-1',
        uploadId: prepared.uploadId,
        offset: 5,
        dataBase64: source.subarray(5).toString('base64'),
      });
      await store.commit('phone-1', prepared.uploadId);

      await expect(
        store.attachments('phone-2', 'drone-1', 'default', [prepared.uploadId]),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await expect(
        store.attachments('phone-1', 'drone-1', 'another-chat', [prepared.uploadId]),
      ).rejects.toThrow('another chat');
      await expect(
        store.attachments('phone-1', 'drone-1', 'default', [prepared.uploadId]),
      ).resolves.toEqual([
        {
          id: prepared.uploadId,
          name: 'image.png',
          mime: 'image/png',
          size: source.length,
          dataBase64: source.toString('base64'),
        },
      ]);
    } finally {
      await store.close();
    }
  });

  test('accepts source files for native chat attachment uploads', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-chat-source-file-'));
    roots.push(root);
    const store = new MeshChatAttachmentStore(root);
    try {
      const source = Buffer.from('export const ready = true;');
      const prepared = await store.prepare({
        sourceDeviceId: 'desktop-1',
        droneId: 'drone-1',
        chatName: 'default',
        name: 'status.ts',
        mime: 'text/plain',
        size: source.length,
      });
      await store.writeMesh({
        sourceDeviceId: 'desktop-1',
        uploadId: prepared.uploadId,
        offset: 0,
        dataBase64: source.toString('base64'),
      });
      await store.commit('desktop-1', prepared.uploadId);
      await expect(
        store.attachments('desktop-1', 'drone-1', 'default', [prepared.uploadId]),
      ).resolves.toMatchObject([{ name: 'status.ts', mime: 'text/plain', size: source.length }]);
    } finally {
      await store.close();
    }
  });

  test('allows a committed upload to be aborted after a rejected prompt', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-chat-committed-abort-'));
    roots.push(root);
    const store = new MeshChatAttachmentStore(root);
    try {
      const prepared = await store.prepare({
        sourceDeviceId: 'desktop-1',
        droneId: 'drone-1',
        chatName: 'default',
        name: 'status.txt',
        mime: 'text/plain',
        size: 1,
      });
      await store.writeMesh({
        sourceDeviceId: 'desktop-1',
        uploadId: prepared.uploadId,
        offset: 0,
        dataBase64: Buffer.from('x').toString('base64'),
      });
      await store.commit('desktop-1', prepared.uploadId);
      await expect(store.abort('desktop-1', prepared.uploadId)).resolves.toEqual({ aborted: true });
      await expect(
        store.attachments('desktop-1', 'drone-1', 'default', [prepared.uploadId]),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await store.close();
    }
  });

  test('streams a direct HTTP upload with a one-time session token', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-chat-http-'));
    roots.push(root);
    const store = new MeshChatAttachmentStore(root);
    const extension = new MeshChatAttachmentHttp(store);
    const server = http.createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      void extension.handlePublic(request, response, url).then((handled) => {
        if (!handled) response.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const prepared = await store.prepare({
        sourceDeviceId: 'phone-1',
        droneId: 'drone-1',
        chatName: 'default',
        name: 'photo.webp',
        mime: 'image/webp',
        size: 9,
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('test server address missing');
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/device-mesh/attachments/${prepared.uploadId}`,
        {
          method: 'PUT',
          headers: {
            'x-upload-token': prepared.uploadToken,
            'x-upload-offset': '0',
          },
          body: Buffer.from('123456789'),
        },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, offset: 9, complete: true });
      await expect(store.commit('phone-1', prepared.uploadId)).resolves.toMatchObject({
        attachmentId: prepared.uploadId,
        size: 9,
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await store.close();
    }
  });
});
