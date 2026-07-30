import { describe, expect, test } from 'bun:test';
import {
  isAttachmentOnlyPrompt,
  normalizeImageAttachmentRefs,
} from '../src/droneHub/chat/ImageAttachmentChips';

describe('attachment transcript presentation', () => {
  test('keeps historical metadata even when it exceeds the current upload byte policy', () => {
    expect(
      normalizeImageAttachmentRefs([
        {
          name: 'historical.png',
          mime: 'image/png',
          size: 7 * 1024 * 1024,
          path: '/work/repo/historical.png',
        },
      ]),
    ).toEqual([
      {
        name: 'historical.png',
        mime: 'image/png',
        size: 7 * 1024 * 1024,
        path: '/work/repo/historical.png',
      },
    ]);
  });

  test('uses shared attachment-only preview labels', () => {
    const attachments = normalizeImageAttachmentRefs([
      { name: 'one.png', mime: 'image/png', size: 1 },
      { name: 'two.jpg', mime: 'image/jpg', size: 1 },
    ]);

    expect(attachments.map((attachment) => attachment.mime)).toEqual(['image/png', 'image/jpeg']);
    expect(isAttachmentOnlyPrompt('[2 image attachments]', attachments)).toBe(true);
    expect(isAttachmentOnlyPrompt('Review these.', attachments)).toBe(false);
  });
});
