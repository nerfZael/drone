import { describe, expect, test } from 'bun:test';
import { attachmentRefsFromPayload, normalizeChatImageAttachmentPayloads } from '../src/droneHub/app/chat-attachment-payloads';

describe('chat attachment payload helpers', () => {
  test('keeps valid image and text payloads and drops invalid items', () => {
    const payloads = normalizeChatImageAttachmentPayloads([
      { name: 'a.png', mime: 'image/png', size: 12, dataBase64: 'YWJj' },
      { name: 'b.txt', mime: 'text/plain', size: 9, dataBase64: 'ZGVm' },
      null,
    ]);

    expect(payloads).toEqual([
      {
        name: 'a.png',
        mime: 'image/png',
        size: 12,
        dataBase64: 'YWJj',
      },
      {
        name: 'b.txt',
        mime: 'text/plain',
        size: 9,
        dataBase64: 'ZGVm',
      },
    ]);
  });

  test('builds preview refs from payloads', () => {
    const refs = attachmentRefsFromPayload([
      { name: 'photo.jpg', mime: 'image/jpeg', size: 42, dataBase64: 'YWJj' },
      { name: 'pasted.txt', mime: 'text/plain', size: 12, dataBase64: 'ZGVm' },
    ]);

    expect(refs).toEqual([
      {
        name: 'photo.jpg',
        mime: 'image/jpeg',
        size: 42,
        previewDataUrl: 'data:image/jpeg;base64,YWJj',
      },
      {
        name: 'pasted.txt',
        mime: 'text/plain',
        size: 12,
      },
    ]);
  });

  test('normalizes MIME aliases and applies the shared count policy', () => {
    const payloads = normalizeChatImageAttachmentPayloads(
      Array.from({ length: 9 }, (_, index) => ({
        name: `photo-${index}.jpg`,
        mime: 'image/jpg',
        size: 1,
        dataBase64: 'YQ==',
      })),
    );

    expect(payloads).toHaveLength(8);
    expect(payloads.every((payload) => payload.mime === 'image/jpeg')).toBe(true);
  });
});
