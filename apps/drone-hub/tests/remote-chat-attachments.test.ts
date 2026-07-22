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
  test('uploads bounded chunks before sending attachment ids with the prompt', async () => {
    const actions: string[] = [];
    const writeBodySizes: number[] = [];
    let offset = 0;
    const result = await sendRemoteChatPrompt({
      droneId: 'drone-1',
      chatName: 'default',
      prompt: 'Review this screenshot',
      attachments: [imageAttachment(150_000)],
      request: async (payload: any) => {
        const transfer = payload.attachmentTransfer;
        if (!transfer) {
          actions.push('prompt');
          expect(payload.attachmentIds).toEqual(['attachment-1']);
          return { accepted: true };
        }
        actions.push(transfer.action);
        if (transfer.action === 'prepare') return { uploadId: 'upload-1', maxChunkBytes: 50_000 };
        if (transfer.action === 'write') {
          writeBodySizes.push(Buffer.byteLength(JSON.stringify(payload)));
          expect(transfer.offset).toBe(offset);
          offset += Buffer.from(transfer.dataBase64, 'base64').length;
          return { offset };
        }
        if (transfer.action === 'commit') return { attachmentId: 'attachment-1' };
        return { aborted: true };
      },
    });

    expect(result).toEqual({ accepted: true });
    expect(actions).toEqual(['prepare', 'write', 'write', 'write', 'write', 'commit', 'prompt']);
    expect(writeBodySizes.every((size) => size < 128 * 1024)).toBe(true);
  });

  test('aborts committed uploads when the final prompt fails', async () => {
    const actions: string[] = [];
    await expect(
      sendRemoteChatPrompt({
        droneId: 'drone-1',
        chatName: 'default',
        prompt: '',
        attachments: [imageAttachment(10)],
        request: async (payload: any) => {
          const action = payload.attachmentTransfer?.action ?? 'prompt';
          actions.push(action);
          if (action === 'prepare') return { uploadId: 'upload-1' };
          if (action === 'write') return { offset: 10 };
          if (action === 'commit') return { attachmentId: 'upload-1' };
          if (action === 'abort') return { aborted: true };
          throw new Error('remote chat rejected the prompt');
        },
      }),
    ).rejects.toThrow('remote chat rejected the prompt');
    expect(actions).toEqual(['prepare', 'write', 'commit', 'prompt', 'abort']);
  });

  test('supports source files for remote native chats', async () => {
    const attachment = {
      ...imageAttachment(10),
      name: 'review.ts',
      mime: 'text/plain',
    };
    let sentAttachmentIds: string[] = [];
    await sendRemoteChatPrompt({
      droneId: 'drone-1',
      chatName: 'default',
      prompt: 'Review this file',
      attachments: [attachment],
      request: async (payload: any) => {
        const action = payload.attachmentTransfer?.action;
        if (action === 'prepare') {
          expect(payload.attachmentTransfer).toMatchObject({ name: 'review.ts', mime: 'text/plain' });
          return { uploadId: 'upload-file' };
        }
        if (action === 'write') return { offset: 10 };
        if (action === 'commit') return { attachmentId: 'attachment-file' };
        sentAttachmentIds = payload.attachmentIds;
        return { accepted: true };
      },
    });
    expect(sentAttachmentIds).toEqual(['attachment-file']);
  });
});
