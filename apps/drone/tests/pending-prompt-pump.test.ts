import { describe, expect, test } from 'bun:test';

import {
  nativeAssistantOwnsPromptDelivery,
  pendingPromptKeepsChatBusy,
} from '../src/hub/pending-prompt-pump';

describe('pending prompt ownership', () => {
  test('leaves native prompt claims to the native assistant queue', () => {
    expect(nativeAssistantOwnsPromptDelivery('native')).toBe(true);
    expect(nativeAssistantOwnsPromptDelivery('builtin')).toBe(false);
    expect(nativeAssistantOwnsPromptDelivery('custom')).toBe(false);
  });

  test('does not keep native chats busy after native delivery completes', () => {
    expect(
      pendingPromptKeepsChatBusy({ state: 'queued', hasTurn: false, native: true }),
    ).toBe(false);
    expect(
      pendingPromptKeepsChatBusy({ state: 'queued', hasTurn: false, native: false }),
    ).toBe(false);
    expect(
      pendingPromptKeepsChatBusy({ state: 'sending', hasTurn: false, native: true }),
    ).toBe(true);
    expect(
      pendingPromptKeepsChatBusy({ state: 'sent', hasTurn: false, native: true }),
    ).toBe(false);
    expect(
      pendingPromptKeepsChatBusy({ state: 'sent', hasTurn: false, native: false }),
    ).toBe(true);
    expect(
      pendingPromptKeepsChatBusy({ state: 'sent', hasTurn: true, native: false }),
    ).toBe(false);
  });
});
