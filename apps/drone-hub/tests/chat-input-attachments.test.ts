import { describe, expect, test } from 'bun:test';
import { filesFromClipboardData, imageFilesFromClipboardData } from '../src/droneHub/chat/chat-input-attachments';

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
});
