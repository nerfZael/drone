import { describe, expect, test } from 'bun:test';
import { uploadMeshChatAttachment } from '../src/mesh/upload-mesh-chat-attachment';

describe('mesh chat attachment upload', () => {
  test('aborts the upload session when a relay chunk fails', async () => {
    const actions: string[] = [];
    await expect(
      uploadMeshChatAttachment({
        droneId: 'drone-1',
        chatName: 'default',
        name: 'photo.png',
        mime: 'image/png',
        bytes: new Uint8Array(10),
        request: async (payload: any) => {
          const action = payload.attachmentTransfer.action;
          actions.push(action);
          if (action === 'prepare') return { uploadId: 'upload-1', maxChunkBytes: 5 };
          if (action === 'write') throw new Error('relay disconnected');
          return { aborted: true };
        },
      }),
    ).rejects.toThrow('relay disconnected');
    expect(actions).toEqual(['prepare', 'write', 'abort']);
  });

  test('falls back to bounded mesh chunks when direct HTTP is unavailable', async () => {
    const actions: string[] = [];
    let generation = 0;
    let offset = 0;
    const result = await uploadMeshChatAttachment({
      endpoint: 'https://desktop.example',
      droneId: 'drone-1',
      chatName: 'default',
      name: 'photo.png',
      mime: 'image/png',
      bytes: new Uint8Array(300_000).fill(7),
      fetchImpl: async () => {
        throw new Error('offline');
      },
      request: async (payload: any) => {
        const transfer = payload.attachmentTransfer;
        actions.push(transfer.action);
        if (transfer.action === 'prepare') {
          generation += 1;
          offset = 0;
          return { uploadId: `upload-${generation}`, uploadToken: 'token', maxChunkBytes: 100_000 };
        }
        if (transfer.action === 'abort') return { aborted: true };
        if (transfer.action === 'write') {
          expect(transfer.offset).toBe(offset);
          offset += Buffer.from(transfer.dataBase64, 'base64').length;
          return { offset };
        }
        return {
          attachmentId: transfer.uploadId,
          name: 'photo.png',
          mime: 'image/png',
          size: offset,
        };
      },
    });

    expect(actions).toEqual(['prepare', 'abort', 'prepare', 'write', 'write', 'write', 'commit']);
    expect(result).toEqual({
      attachmentId: 'upload-2',
      name: 'photo.png',
      mime: 'image/png',
      size: 300_000,
    });
  });
});
