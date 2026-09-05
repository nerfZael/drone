import { describe, expect, test } from 'bun:test';
import { uploadMeshChatAttachment } from '../src/mesh/upload-mesh-chat-attachment';

describe('mesh chat attachment upload', () => {
  test('applies attachment metadata policy before opening a mesh session', async () => {
    let requested = false;
    await expect(
      uploadMeshChatAttachment({
        droneId: 'drone-1',
        chatName: 'default',
        name: 'empty.txt',
        mime: 'text/plain',
        bytes: new Uint8Array(),
        request: async () => {
          requested = true;
        },
      }),
    ).rejects.toThrow('between 1 byte and 6 MiB');
    expect(requested).toBe(false);
  });

  test('reports invalid MIME metadata before opening a mesh session', async () => {
    let requested = false;
    await expect(
      uploadMeshChatAttachment({
        droneId: 'drone-1',
        chatName: 'default',
        name: 'notes.txt',
        mime: 'invalid',
        bytes: new Uint8Array([1]),
        request: async () => {
          requested = true;
        },
      }),
    ).rejects.toThrow('invalid MIME type');
    expect(requested).toBe(false);
  });

  for (const failure of ['offline', 'incomplete', 'commit']) {
    test('aborts HTTP upload on ' + failure + ' without legacy fallback', async () => {
      const actions: string[] = [];
      await expect(
        uploadMeshChatAttachment({
          droneId: 'drone-1',
          chatName: 'default',
          name: 'notes.txt',
          mime: 'text/plain',
          bytes: new Uint8Array([1]),
          fetchImpl: (async () => {
            if (failure === 'offline') throw new Error('offline');
            return Response.json({ offset: failure === 'incomplete' ? 0 : 1, complete: true });
          }) as typeof fetch,
          request: async (payload: any) => {
            const action = payload.attachmentTransfer.action;
            actions.push(action);
            if (action === 'prepare')
              return { uploadId: 'u1', uploadUrl: 'https://peer/upload', uploadToken: 'secret' };
            return { aborted: true };
          },
        }),
      ).rejects.toThrow(failure === 'commit' ? 'invalid committed attachment' : failure);
      expect(actions).toEqual(
        failure === 'commit' ? ['prepare', 'commit', 'abort'] : ['prepare', 'abort'],
      );
    });
  }

  test('uploads binary body once and commits validated metadata', async () => {
    const actions: string[] = [];
    let requests = 0;
    const result = await uploadMeshChatAttachment({
      droneId: 'drone-1',
      chatName: 'default',
      name: 'notes.txt',
      mime: 'text/plain',
      bytes: new Uint8Array([1, 2]),
      fetchImpl: (async (url, init) => {
        requests++;
        expect(url).toBe('https://peer/upload');
        expect((init?.headers as any)['x-upload-token']).toBe('secret');
        expect(new Uint8Array(await (init!.body as Blob).arrayBuffer())).toEqual(
          new Uint8Array([1, 2]),
        );
        return Response.json({ offset: 2, complete: true });
      }) as typeof fetch,
      request: async (payload: any) => {
        const action = payload.attachmentTransfer.action;
        actions.push(action);
        if (action === 'prepare')
          return { uploadId: 'u1', uploadUrl: 'https://peer/upload', uploadToken: 'secret' };
        return { attachmentId: 'a1', name: 'notes.txt', mime: 'text/plain', size: 2 };
      },
    });
    expect(result.attachmentId).toBe('a1');
    expect(requests).toBe(1);
    expect(actions).toEqual(['prepare', 'commit']);
  });
});
