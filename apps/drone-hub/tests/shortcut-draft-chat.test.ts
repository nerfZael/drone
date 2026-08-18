import { describe, expect, test } from 'bun:test';
import {
  publishThenSendShortcutDraftChat,
  shortcutDraftChatDisposition,
} from '../src/droneHub/app/shortcut-draft-chat';

describe('shortcut draft chat lifecycle', () => {
  test('waits while a blank draft is still selected', () => {
    expect(
      shortcutDraftChatDisposition({
        active: true,
        wasActivated: true,
        stillDraft: true,
        hasDraftContent: false,
        submissionInFlight: false,
      }),
    ).toBe('wait');
  });

  test('deletes a blank draft after navigating away', () => {
    expect(
      shortcutDraftChatDisposition({
        active: false,
        wasActivated: true,
        stillDraft: true,
        hasDraftContent: false,
        submissionInFlight: false,
      }),
    ).toBe('delete');
  });

  test('retains a typed but unsent draft after navigating away', () => {
    expect(
      shortcutDraftChatDisposition({
        active: false,
        wasActivated: true,
        stillDraft: true,
        hasDraftContent: true,
        submissionInFlight: false,
      }),
    ).toBe('retain');
  });

  test('does not delete a draft while its first prompt is being submitted', () => {
    expect(
      shortcutDraftChatDisposition({
        active: false,
        wasActivated: true,
        stillDraft: true,
        hasDraftContent: false,
        submissionInFlight: true,
      }),
    ).toBe('wait');
  });

  test('does not clean up a new draft before its selection commits', () => {
    expect(
      shortcutDraftChatDisposition({
        active: false,
        wasActivated: false,
        stillDraft: true,
        hasDraftContent: false,
        submissionInFlight: false,
      }),
    ).toBe('wait');
  });

  test('publishes before sending the first prompt', async () => {
    const calls: string[] = [];
    const sent = await publishThenSendShortcutDraftChat({
      publish: async () => {
        calls.push('publish');
      },
      send: async () => {
        calls.push('send');
        return true;
      },
      onPublishError: () => {
        calls.push('error');
      },
    });
    expect(sent).toBe(true);
    expect(calls).toEqual(['publish', 'send']);
  });

  test('does not send when publication fails', async () => {
    const calls: string[] = [];
    const sent = await publishThenSendShortcutDraftChat({
      publish: async () => {
        calls.push('publish');
        throw new Error('offline');
      },
      send: async () => {
        calls.push('send');
        return true;
      },
      onPublishError: (error) => {
        calls.push(error instanceof Error ? error.message : 'unknown');
      },
    });
    expect(sent).toBe(false);
    expect(calls).toEqual(['publish', 'offline']);
  });
});
