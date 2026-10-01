import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { CHAT_ATTACHMENT_POLICY } from '@drone/assistant-chat';
import {
  buildChatAttachmentsDirectory,
  buildChatImageAttachmentRefs,
  codexImageAttachmentFlags,
  configureChatAttachmentUploads,
  inlineChatAttachments,
  normalizeChatImageAttachments,
  promptWithImageAttachments,
  stageChatAttachmentUpload,
  writeChatAttachmentFile,
  type ChatImageAttachment,
} from '../src/hub/chat-attachments';

describe('chat attachments paths', () => {
  const sample: ChatImageAttachment = {
    name: 'screenshot.png',
    mime: 'image/png',
    size: 1234,
    dataBase64: 'iVBORw0KGgo=',
    fileName: 'screenshot.png',
  };

  test('builds paths under chat cwd', () => {
    const dir = buildChatAttachmentsDirectory({
      cwd: '/work/repo',
      chatName: 'default',
      promptId: 'prompt-123',
      storageRoot: '/dvm-data/drone-hub/attachments',
    });
    expect(dir).toBe('/dvm-data/drone-hub/attachments/default/prompt-123');

    const refs = buildChatImageAttachmentRefs({
      attachments: [sample],
      cwd: '/work/repo',
      chatName: 'default',
      promptId: 'prompt-123',
      storageRoot: '/dvm-data/drone-hub/attachments',
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.path).toBe('/dvm-data/drone-hub/attachments/default/prompt-123/screenshot.png');
    expect(refs[0]?.relativePath).toBe('/dvm-data/drone-hub/attachments/default/prompt-123/screenshot.png');
  });

  test('sanitizes chat and prompt segments for paths', () => {
    const dir = buildChatAttachmentsDirectory({
      cwd: '/work/repo',
      chatName: 'My Chat/../Prod',
      promptId: 'seed:2026-02-23',
      storageRoot: '/dvm-data/drone-hub/attachments',
    });
    expect(dir).toBe('/dvm-data/drone-hub/attachments/my-chat-prod/seed-2026-02-23');
  });

  test('keeps relative paths when staged inside cwd', () => {
    const refs = buildChatImageAttachmentRefs({
      attachments: [sample],
      cwd: '/work/repo',
      chatName: 'default',
      promptId: 'prompt-123',
    });
    expect(refs[0]?.path).toBe('/work/repo/.drone-hub/attachments/default/prompt-123/screenshot.png');
    expect(refs[0]?.relativePath).toBe('.drone-hub/attachments/default/prompt-123/screenshot.png');
  });
});

describe('promptWithImageAttachments', () => {
  test('prefers relative path while keeping absolute fallback', () => {
    const text = promptWithImageAttachments('Please inspect this image.', [
      {
        name: 'screenshot.png',
        mime: 'image/png',
        size: 1234,
        path: '/dvm-data/drone-hub/attachments/default/prompt-123/screenshot.png',
        relativePath: '/dvm-data/drone-hub/attachments/default/prompt-123/screenshot.png',
      },
    ]);
    expect(text).toContain('Please inspect this image.');
    expect(text).toContain('/dvm-data/drone-hub/attachments/default/prompt-123/screenshot.png');
    expect(text).not.toContain('(absolute:');
  });

  test('includes instructions for text attachments', () => {
    const text = promptWithImageAttachments('Summarize this.', [
      {
        name: 'pasted-text.txt',
        mime: 'text/plain',
        size: 54321,
        path: '/dvm-data/drone-hub/attachments/default/prompt-123/pasted-text.txt',
        relativePath: 'attachments/default/prompt-123/pasted-text.txt',
      },
    ]);

    expect(text).toContain('Text attachment:');
    expect(text).toContain('Read the text attachment file');
    expect(text).toContain('attachments/default/prompt-123/pasted-text.txt');
  });
});

describe('codexImageAttachmentFlags', () => {
  test('builds Codex image flags for image attachments only', () => {
    const flags = codexImageAttachmentFlags([
      {
        mime: 'image/png',
        path: '/work/repo/.drone-hub/attachments/default/prompt-123/screenshot one.png',
      },
      {
        mime: 'text/plain',
        path: '/work/repo/.drone-hub/attachments/default/prompt-123/pasted-text.txt',
      },
    ]);

    expect(flags).toBe(" --image '/work/repo/.drone-hub/attachments/default/prompt-123/screenshot one.png' --");
  });
});

describe('normalizeChatImageAttachments', () => {
  test('accepts text attachments alongside images', () => {
    const attachments = normalizeChatImageAttachments([
      { name: 'pasted-text.txt', mime: 'text/plain', size: 5, dataBase64: 'aGVsbG8=' },
      { name: 'screenshot.png', mime: 'image/png', size: 8, dataBase64: 'iVBORw0KGgo=' },
    ]);

    expect(attachments).toHaveLength(2);
    expect(attachments[0]?.mime).toBe('text/plain');
    expect(attachments[1]?.mime).toBe('image/png');
  });

  test('deduplicates staged filenames for attachments with the same name', () => {
    const attachments = normalizeChatImageAttachments([
      { name: 'image.png', mime: 'image/png', size: 5, dataBase64: 'aGVsbG8=' },
      { name: 'image.png', mime: 'image/png', size: 5, dataBase64: 'd29ybGQ=' },
      { name: 'IMAGE.png', mime: 'image/png', size: 1, dataBase64: 'IQ==' },
    ]);

    expect(attachments.map((attachment) => attachment.fileName)).toEqual(['image.png', 'image-2.png', 'IMAGE-3.png']);
  });

  test('uses the shared MIME and count policy', () => {
    expect(
      normalizeChatImageAttachments([
        { name: 'photo.jpg', mime: 'image/jpg', size: 5, dataBase64: 'aGVsbG8=' },
      ])[0]?.mime,
    ).toBe('image/jpeg');

    expect(() =>
      normalizeChatImageAttachments(
        Array.from({ length: 9 }, (_, index) => ({
          name: `notes-${index}.txt`,
          mime: 'text/plain',
          size: 1,
          dataBase64: 'IQ==',
        })),
      ),
    ).toThrow('too many attachments (max 8)');
  });
});

test('any file type is a chat attachment: stored under its own name and presented to the agent as a file to open', () => {
  const pdf = { name: 'Quarterly report.pdf', mime: 'application/pdf', size: 5, dataBase64: Buffer.from('%PDF-').toString('base64') };
  const unnamed = { name: '', mime: 'application/zip', size: 2, dataBase64: Buffer.from('PK').toString('base64') };
  const [first, second] = normalizeChatImageAttachments([pdf, unnamed]);
  expect(first).toMatchObject({ name: 'Quarterly report.pdf', mime: 'application/pdf', size: 5 });
  expect(first.fileName.endsWith('.pdf')).toBe(true);
  expect(second.fileName).toBe('file-2.bin');
  const prompt = promptWithImageAttachments('Summarise this', [{ ...first, path: '/work/repo/.drone-hub/attachments/report.pdf' }]);
  expect(prompt).toContain('Attachment:');
  expect(prompt).toContain('/work/repo/.drone-hub/attachments/report.pdf');
  expect(() => normalizeChatImageAttachments([{ ...pdf, mime: 'not a mime' }])).toThrow('not valid');
});

describe('plain files uploaded ahead of a prompt', () => {
  const MiB = 1024 * 1024;
  const body = (bytes: Buffer) => Readable.from([bytes]) as unknown as IncomingMessage;

  async function withUploadsDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-attachment-uploads-'));
    configureChatAttachmentUploads(dir);
    try {
      return await run(dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  test('a file over the inline limit is uploaded, named by uploadId, and copied into place without base64', async () => {
    await withUploadsDir(async (dir) => {
      const bytes = Buffer.alloc(7 * MiB, 7);
      const upload = await stageChatAttachmentUpload(body(bytes), {
        name: 'recording.mp4',
        mime: 'video/mp4',
      });
      expect(upload).toMatchObject({ name: 'recording.mp4', mime: 'video/mp4', size: bytes.length });

      const [attachment] = normalizeChatImageAttachments(
        [{ name: 'recording.mp4', mime: 'video/mp4', size: bytes.length, uploadId: upload.uploadId }],
        { allowUploads: true },
      );
      expect(attachment).toMatchObject({ size: bytes.length, sourcePath: path.join(dir, upload.uploadId) });
      expect(attachment?.dataBase64).toBeUndefined();

      // Copied, not moved: the same upload can go out with several prompts.
      for (const target of ['one.mp4', 'two.mp4']) {
        await writeChatAttachmentFile(attachment!, path.join(dir, target));
        expect((await fs.readFile(path.join(dir, target))).equals(bytes)).toBe(true);
      }
    });
  });

  test('uploads are refused where attachments must travel inline, and for images and text', async () => {
    await withUploadsDir(async () => {
      const upload = await stageChatAttachmentUpload(body(Buffer.from('zip')), {
        name: 'a.zip',
        mime: 'application/zip',
      });
      const item = { name: 'a.zip', mime: 'application/zip', size: 3, uploadId: upload.uploadId };
      expect(() => normalizeChatImageAttachments([item])).toThrow('uploaded attachments are not accepted here');
      expect(() =>
        normalizeChatImageAttachments([{ ...item, mime: 'image/png' }], { allowUploads: true }),
      ).toThrow('only plain files can be uploaded ahead of a prompt');
      await expect(
        stageChatAttachmentUpload(body(Buffer.from('hi')), { name: 'notes.txt', mime: 'text/plain' }),
      ).rejects.toThrow('only plain files can be uploaded ahead of a prompt');
      expect(() =>
        normalizeChatImageAttachments(
          [{ ...item, uploadId: 'chat-upload-00000000-0000-0000-0000-000000000000' }],
          { allowUploads: true },
        ),
      ).toThrow('attachment upload was not found');
    });
  });

  test('an upload over the uploaded-file limit is refused and nothing is kept', async () => {
    await withUploadsDir(async (dir) => {
      const tooLarge = Buffer.alloc(CHAT_ATTACHMENT_POLICY.maxUploadedFileBytesEach + 1);
      await expect(
        stageChatAttachmentUpload(body(tooLarge), { name: 'disk.img', mime: 'application/octet-stream' }),
      ).rejects.toMatchObject({ statusCode: 413 });
      expect(await fs.readdir(dir)).toEqual([]);
    });
  });

  test('a native chat gets uploaded bytes inline, still held to the inline limit', async () => {
    await withUploadsDir(async () => {
      const small = await stageChatAttachmentUpload(body(Buffer.from('PK')), {
        name: 'a.zip',
        mime: 'application/zip',
      });
      const large = await stageChatAttachmentUpload(body(Buffer.alloc(7 * MiB)), {
        name: 'b.zip',
        mime: 'application/zip',
      });
      const [smallAttachment, largeAttachment] = normalizeChatImageAttachments(
        [
          { name: 'a.zip', mime: 'application/zip', uploadId: small.uploadId },
          { name: 'b.zip', mime: 'application/zip', uploadId: large.uploadId },
        ],
        { allowUploads: true },
      );
      expect(await inlineChatAttachments([smallAttachment!])).toMatchObject([
        { name: 'a.zip', dataBase64: Buffer.from('PK').toString('base64') },
      ]);
      await expect(inlineChatAttachments([largeAttachment!])).rejects.toThrow('attachment too large');
    });
  });
});
