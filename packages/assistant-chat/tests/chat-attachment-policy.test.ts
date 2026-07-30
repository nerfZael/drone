import { describe, expect, test } from 'bun:test';
import {
  CHAT_ATTACHMENT_POLICY,
  chatAttachmentContextBlock,
  chatAttachmentPreviewLabel,
  chatAttachmentTypeLabel,
  normalizeChatAttachmentMime,
  promptWithChatAttachmentContext,
  validateChatAttachments,
} from '../src';

describe('shared chat attachment policy', () => {
  test('normalizes MIME aliases and browser omissions without platform objects', () => {
    expect(normalizeChatAttachmentMime(' Image/JPG ')).toBe('image/jpeg');
    expect(normalizeChatAttachmentMime('', 'photo.JPEG')).toBe('image/jpeg');
    expect(normalizeChatAttachmentMime('application/octet-stream', 'diagram.svg')).toBe(
      'image/svg+xml',
    );
    expect(normalizeChatAttachmentMime('', 'archive.zip')).toBe('application/octet-stream');
  });

  test('returns normalized metadata and totals for a valid selection', () => {
    expect(
      validateChatAttachments([
        { name: 'photo.jpg', mime: 'image/jpg', size: 12 },
        { name: 'notes.txt', mime: 'text/plain', size: 8 },
      ]),
    ).toEqual({
      ok: true,
      attachments: [
        { name: 'photo.jpg', mime: 'image/jpeg', size: 12 },
        { name: 'notes.txt', mime: 'text/plain', size: 8 },
      ],
      totalBytes: 20,
    });
  });

  test('returns the same first policy issue for the same input', () => {
    const tooMany = Array.from({ length: CHAT_ATTACHMENT_POLICY.maxCount + 1 }, (_, index) => ({
      name: `${index}.txt`,
      mime: 'text/plain',
      size: 1,
    }));
    const expected = {
      ok: false,
      issue: {
        code: 'too_many_attachments',
        actual: 9,
        limit: 8,
      },
    };
    expect(validateChatAttachments(tooMany)).toEqual(expected);
    expect(validateChatAttachments(tooMany)).toEqual(expected);

    expect(validateChatAttachments([{ name: 'bad.txt', mime: 'not a mime', size: 1 }])).toEqual({
      ok: false,
      issue: {
        code: 'invalid_mime',
        attachmentIndex: 0,
        actual: 10,
        limit: 120,
      },
    });

    expect(
      validateChatAttachments([
        { name: 'empty.txt', mime: 'text/plain', size: 0 },
        { name: 'bad.txt', mime: 'not a mime', size: 1 },
      ]),
    ).toEqual({
      ok: false,
      issue: {
        code: 'invalid_size',
        attachmentIndex: 0,
        actual: 0,
      },
    });
  });

  test('enforces per-attachment and total byte limits', () => {
    expect(
      validateChatAttachments([
        {
          name: 'large.bin',
          mime: 'application/octet-stream',
          size: CHAT_ATTACHMENT_POLICY.maxBytesEach + 1,
        },
      ]),
    ).toEqual({
      ok: false,
      issue: {
        code: 'attachment_too_large',
        attachmentIndex: 0,
        actual: CHAT_ATTACHMENT_POLICY.maxBytesEach + 1,
        limit: CHAT_ATTACHMENT_POLICY.maxBytesEach,
      },
    });

    expect(
      validateChatAttachments([
        { name: 'one.bin', mime: 'application/octet-stream', size: 6 * 1024 * 1024 },
        { name: 'two.bin', mime: 'application/octet-stream', size: 6 * 1024 * 1024 },
        { name: 'three.bin', mime: 'application/octet-stream', size: 6 * 1024 * 1024 },
        { name: 'four.bin', mime: 'application/octet-stream', size: 3 * 1024 * 1024 },
      ]),
    ).toMatchObject({
      ok: false,
      issue: {
        code: 'attachments_too_large',
        attachmentIndex: 3,
        limit: CHAT_ATTACHMENT_POLICY.maxBytesTotal,
      },
    });
  });

  test('builds stable type and attachment-only preview labels', () => {
    expect(chatAttachmentTypeLabel({ mime: 'image/png' })).toBe('Image');
    expect(chatAttachmentTypeLabel({ mime: 'text/plain' })).toBe('Text');
    expect(chatAttachmentTypeLabel({ mime: 'application/pdf' })).toBe('File');
    expect(chatAttachmentPreviewLabel([{ mime: 'image/png' }])).toBe('[image attachment]');
    expect(chatAttachmentPreviewLabel([{ mime: 'image/png' }, { mime: 'image/jpeg' }])).toBe(
      '[2 image attachments]',
    );
    expect(chatAttachmentPreviewLabel([{ mime: 'image/png' }, { mime: 'text/plain' }])).toBe(
      '[2 attachments]',
    );
  });
});

describe('shared chat attachment context descriptors', () => {
  const attachments = [
    {
      name: 'notes.txt',
      mime: 'text/plain',
      size: 12,
      path: '/work/repo/attachments/notes.txt',
      relativePath: 'attachments/notes.txt',
    },
    {
      name: 'screen.png',
      mime: 'image/png',
      size: 42,
      path: '/work/repo/attachments/screen.png',
      relativePath: 'attachments/screen.png',
    },
  ];

  test('groups browser-safe descriptors and keeps relative and absolute paths', () => {
    const context = chatAttachmentContextBlock(attachments);
    expect(context).toBe(
      [
        'Text attachment:',
        '1. notes.txt (text/plain, 12 bytes): attachments/notes.txt (absolute: /work/repo/attachments/notes.txt)',
        "Read the text attachment file and treat the content as part of the user's message/context.",
        '',
        'Image attachment:',
        '1. screen.png (image/png, 42 bytes): attachments/screen.png (absolute: /work/repo/attachments/screen.png)',
      ].join('\n'),
    );
  });

  test('appends descriptors to prompt text deterministically', () => {
    const prompt = promptWithChatAttachmentContext('Review these.', attachments);
    expect(prompt.startsWith('Review these.\n\nText attachment:')).toBe(true);
    expect(promptWithChatAttachmentContext('', [])).toBe('');
  });
});
