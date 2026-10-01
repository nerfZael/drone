import { describe, expect, test } from 'bun:test';
import { uploadChatAttachmentFile } from '../src/droneHub/app/chat-api';
import {
  filesFromClipboardData,
  imageFilesFromClipboardData,
  mimeForChatAttachmentFile,
  requireInlineAttachmentPayloads,
} from '../src/droneHub/chat/chat-input-attachments';

describe('chat input attachment helpers', () => {
  test('collects all image files exposed through clipboard files', () => {
    const one = new File(['one'], 'one.png', { type: 'image/png', lastModified: 1 });
    const two = new File(['two'], 'two.png', { type: 'image/png', lastModified: 2 });

    const files = imageFilesFromClipboardData({
      files: [one, two] as any,
      items: [
        {
          kind: 'file',
          getAsFile: () => one,
        },
      ] as any,
    });

    expect(files).toEqual([one, two]);
  });

  test('does not merge clipboard items when FileList already has images (avoids duplicate paste)', () => {
    const fromFiles = new File(['x'], 'paste.png', { type: 'image/png', lastModified: 100 });
    const fromItems = new File(['x'], 'paste.png', { type: 'image/png', lastModified: 999 });

    const files = imageFilesFromClipboardData({
      files: [fromFiles] as any,
      items: [
        {
          kind: 'file',
          getAsFile: () => fromItems,
        },
      ] as any,
    });

    expect(files).toEqual([fromFiles]);
  });

  test('falls back to clipboard items when files are absent', () => {
    const one = new File(['one'], 'one.png', { type: 'image/png', lastModified: 1 });
    const text = new File(['text'], 'notes.txt', { type: 'text/plain', lastModified: 2 });

    const files = imageFilesFromClipboardData({
      files: [] as any,
      items: [
        {
          kind: 'file',
          getAsFile: () => one,
        },
        {
          kind: 'file',
          getAsFile: () => text,
        },
      ] as any,
    });

    expect(files).toEqual([one]);
  });

  test('collects non-image files from clipboard data', () => {
    const image = new File(['one'], 'one.png', { type: 'image/png', lastModified: 1 });
    const text = new File(['text'], 'notes.txt', { type: 'text/plain', lastModified: 2 });

    const files = filesFromClipboardData({
      files: [image, text, text] as any,
      items: [] as any,
    });

    expect(files).toEqual([image, text]);
  });

  test('infers an image MIME type when the browser omits it', () => {
    const image = new File(['one'], 'photo.JPEG');

    expect(mimeForChatAttachmentFile(image)).toBe('image/jpeg');
  });

  test('keeps explicit MIME types for arbitrary files', () => {
    const archive = new File(['zip'], 'bundle.zip', { type: 'application/zip' });

    expect(mimeForChatAttachmentFile(archive)).toBe('application/zip');
  });
});

describe('plain files uploaded ahead of a prompt', () => {
  test('a file goes to the hub as its raw bytes and comes back as an upload id', async () => {
    const file = new File(['PK'], 'build output.zip', { type: 'application/zip' });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const uploadId = await uploadChatAttachmentFile(async <T,>(url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, uploadId: 'chat-upload-1' } as T;
    }, file);
    expect(uploadId).toBe('chat-upload-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/chat-attachment-uploads?name=build+output.zip&mime=application%2Fzip');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(calls[0]!.init?.body).toBe(file);
  });

  test('destinations that need bytes inline refuse an uploaded file by name', () => {
    const inline = { name: 'a.png', mime: 'image/png', size: 1, dataBase64: 'AA==' };
    expect(requireInlineAttachmentPayloads([inline])).toEqual([inline]);
    expect(() =>
      requireInlineAttachmentPayloads([
        inline,
        { name: 'b.zip', mime: 'application/zip', size: 1, uploadId: 'chat-upload-1' },
      ]),
    ).toThrow('b.zip was uploaded to this hub and cannot be sent here; attach it again.');
  });
});
