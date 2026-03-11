import { describe, expect, test } from 'bun:test';
import { attachmentRefsFromPayload, normalizeChatImageAttachmentPayloads } from '../src/droneHub/app/chat-attachment-payloads';

describe('chat attachment payload helpers', () => {
  test('keeps valid image payloads and drops invalid items', () => {
    const payloads = normalizeChatImageAttachmentPayloads([
      { name: 'a.png', mime: 'image/png', size: 12, dataBase64: 'YWJj' },
      { name: 'b.txt', mime: 'text/plain', size: 9, dataBase64: 'ZGVm' },
      null,
    ]);

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual({
      name: 'a.png',
      mime: 'image/png',
      size: 12,
      dataBase64: 'YWJj',
    });
  });

  test('builds preview refs from payloads', () => {
    const refs = attachmentRefsFromPayload([{ name: 'photo.jpg', mime: 'image/jpeg', size: 42, dataBase64: 'YWJj' }]);

    expect(refs).toEqual([
      {
        name: 'photo.jpg',
        mime: 'image/jpeg',
        size: 42,
        previewDataUrl: 'data:image/jpeg;base64,YWJj',
      },
    ]);
  });
});
