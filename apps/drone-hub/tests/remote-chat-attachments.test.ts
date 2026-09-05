import { describe, expect, test } from 'bun:test';
import { sendRemoteChatPrompt } from '../src/droneHub/app/remote-chat-attachments';

function imageAttachment(bytes: number) {
  const data = Buffer.alloc(bytes, 7);
  return {
    name: 'screen.png',
    mime: 'image/png',
    size: data.length,
    dataBase64: data.toString('base64'),
  };
}

describe('desktop remote chat attachments', () => {
  test('uploads one binary HTTP body before sending attachment ids with the prompt', async () => {
    const actions: string[] = [];
    let uploads = 0;
    const result = await sendRemoteChatPrompt({
      fetchImpl: (async (_url, init) => {
        const size = (init!.body as Blob).size;
        return Response.json({ offset: size, complete: true });
      }) as typeof fetch,
      droneId: 'drone-1',
      chatName: 'default',
      prompt: 'Review this screenshot',
      promptId: 'voice-session.3',
      deliveryMode: 'asap',
      attachments: [imageAttachment(150_000)],
      request: async (payload: any) => {
        const transfer = payload.attachmentTransfer;
        if (!transfer) {
          actions.push('prompt');
          expect(payload.attachmentIds).toEqual(['attachment-1']);
          expect(payload.promptId).toBe('voice-session.3');
          expect(payload.deliveryMode).toBe('asap');
          return { accepted: true };
        }
        actions.push(transfer.action);
        if (transfer.action === 'prepare')
          return { uploadId: 'upload-1', uploadUrl: 'https://peer/upload', uploadToken: 'secret' };
        if (transfer.action === 'commit') return { attachmentId: 'attachment-1' };
        return { aborted: true };
      },
    });

    expect(result).toEqual({ accepted: true });
    expect(actions).toEqual(['prepare', 'commit', 'prompt']);
  });

  test('aborts committed uploads when the final prompt fails', async () => {
    const actions: string[] = [];
    await expect(
      sendRemoteChatPrompt({
        fetchImpl: (async (_url, init) =>
          Response.json({ offset: (init!.body as Blob).size, complete: true })) as typeof fetch,
        droneId: 'drone-1',
        chatName: 'default',
        prompt: '',
        attachments: [imageAttachment(10)],
        request: async (payload: any) => {
          const action = payload.attachmentTransfer?.action ?? 'prompt';
          actions.push(action);
          if (action === 'prepare')
            return {
              uploadId: 'upload-1',
              uploadUrl: 'https://peer/upload',
              uploadToken: 'secret',
            };
          if (action === 'commit') return { attachmentId: 'upload-1' };
          if (action === 'abort') return { aborted: true };
          throw new Error('remote chat rejected the prompt');
        },
      }),
    ).rejects.toThrow('remote chat rejected the prompt');
    expect(actions).toEqual(['prepare', 'commit', 'prompt', 'abort']);
  });

  test('supports source files for remote native chats', async () => {
    const attachment = {
      ...imageAttachment(10),
      name: 'review.ts',
      mime: 'text/plain',
    };
    let sentAttachmentIds: string[] = [];
    await sendRemoteChatPrompt({
      fetchImpl: (async (_url, init) =>
        Response.json({ offset: (init!.body as Blob).size, complete: true })) as typeof fetch,
      droneId: 'drone-1',
      chatName: 'default',
      prompt: 'Review this file',
      attachments: [attachment],
      request: async (payload: any) => {
        const action = payload.attachmentTransfer?.action;
        if (action === 'prepare') {
          expect(payload.attachmentTransfer).toMatchObject({
            name: 'review.ts',
            mime: 'text/plain',
          });
          return {
            uploadId: 'upload-file',
            uploadUrl: 'https://peer/upload',
            uploadToken: 'secret',
          };
        }
        if (action === 'commit') return { attachmentId: 'attachment-file' };
        sentAttachmentIds = payload.attachmentIds;
        return { accepted: true };
      },
    });
    expect(sentAttachmentIds).toEqual(['attachment-file']);
  });

  test('normalizes MIME aliases before preparing a remote upload', async () => {
    const attachment = { ...imageAttachment(1), mime: 'image/jpg' };
    await sendRemoteChatPrompt({
      fetchImpl: (async (_url, init) =>
        Response.json({ offset: (init!.body as Blob).size, complete: true })) as typeof fetch,
      droneId: 'drone-1',
      chatName: 'default',
      prompt: '',
      attachments: [attachment],
      request: async (payload: any) => {
        const action = payload.attachmentTransfer?.action;
        if (action === 'prepare') {
          expect(payload.attachmentTransfer.mime).toBe('image/jpeg');
          return { uploadId: 'upload-1', uploadUrl: 'https://peer/upload', uploadToken: 'secret' };
        }
        if (action === 'commit') return { attachmentId: 'attachment-1' };
        return { accepted: true };
      },
    });
  });

  test('rejects selections over the shared attachment count before transport', async () => {
    let requested = false;
    await expect(
      sendRemoteChatPrompt({
        fetchImpl: (async (_url, init) =>
          Response.json({ offset: (init!.body as Blob).size, complete: true })) as typeof fetch,
        droneId: 'drone-1',
        chatName: 'default',
        prompt: '',
        attachments: Array.from({ length: 9 }, () => imageAttachment(1)),
        request: async () => {
          requested = true;
        },
      }),
    ).rejects.toThrow('up to 8 attachments');
    expect(requested).toBe(false);
  });
});
