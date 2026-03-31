import { describe, expect, test } from 'bun:test';
import { buildChatAttachmentsDirectory, buildChatImageAttachmentRefs, promptWithImageAttachments, type ChatImageAttachment } from '../src/hub/chat-attachments';

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
});
