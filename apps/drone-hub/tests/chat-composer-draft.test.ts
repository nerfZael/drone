import { describe, expect, test } from 'bun:test';

import {
  restoreChatComposerDraftSnapshot,
  takeChatComposerDraftSnapshot,
} from '../src/droneHub/chat/chat-composer-draft';

describe('chat composer draft submissions', () => {
  test('takes and clears a submission snapshot synchronously', () => {
    const draft = { current: '  First message  ' };
    const attachments = { current: [{ id: 'attachment-1' }] };
    const revision = { current: 3 };

    const snapshot = takeChatComposerDraftSnapshot({ draft, attachments, revision });

    expect(snapshot).toEqual({
      prompt: 'First message',
      attachments: [{ id: 'attachment-1' }],
      revision: 3,
    });
    expect(draft.current).toBe('');
    expect(attachments.current).toEqual([]);
    expect(takeChatComposerDraftSnapshot({ draft, attachments, revision })).toBeNull();
  });

  test('allows a second independent snapshot before the first submission finishes', () => {
    const draft = { current: 'First message' };
    const attachments = { current: [] as Array<{ id: string }> };
    const revision = { current: 0 };
    const first = takeChatComposerDraftSnapshot({ draft, attachments, revision });

    draft.current = 'Queued follow-up';
    revision.current += 1;
    const second = takeChatComposerDraftSnapshot({ draft, attachments, revision });

    expect(first?.prompt).toBe('First message');
    expect(second?.prompt).toBe('Queued follow-up');
  });

  test('does not overwrite a newer draft when an earlier submission fails', () => {
    const draft = { current: 'First message' };
    const attachments = { current: [{ id: 'old-attachment' }] };
    const revision = { current: 0 };
    const snapshot = takeChatComposerDraftSnapshot({ draft, attachments, revision });
    if (!snapshot) throw new Error('Expected a submission snapshot');

    draft.current = 'New draft';
    attachments.current = [{ id: 'new-attachment' }];
    revision.current += 1;
    const restored = restoreChatComposerDraftSnapshot({ draft, attachments, revision, snapshot });

    expect(restored).toEqual({ draftRestored: false, attachmentsRestored: false });
    expect(draft.current).toBe('New draft');
    expect(attachments.current).toEqual([{ id: 'new-attachment' }]);
  });

  test('restores a failed snapshot when the composer is still empty', () => {
    const draft = { current: 'Retry this' };
    const attachments = { current: [{ id: 'retry-attachment' }] };
    const revision = { current: 0 };
    const snapshot = takeChatComposerDraftSnapshot({ draft, attachments, revision });
    if (!snapshot) throw new Error('Expected a submission snapshot');

    const restored = restoreChatComposerDraftSnapshot({ draft, attachments, revision, snapshot });

    expect(restored).toEqual({ draftRestored: true, attachmentsRestored: true });
    expect(draft.current).toBe('Retry this');
    expect(attachments.current).toEqual([{ id: 'retry-attachment' }]);
  });

  test('does not restore an old failure after a newer message was submitted', () => {
    const draft = { current: 'First message' };
    const attachments = { current: [] as Array<{ id: string }> };
    const revision = { current: 0 };
    const first = takeChatComposerDraftSnapshot({ draft, attachments, revision });
    if (!first) throw new Error('Expected a submission snapshot');

    draft.current = 'Second message';
    revision.current += 1;
    expect(takeChatComposerDraftSnapshot({ draft, attachments, revision })?.prompt).toBe(
      'Second message',
    );

    expect(
      restoreChatComposerDraftSnapshot({ draft, attachments, revision, snapshot: first }),
    ).toEqual({ draftRestored: false, attachmentsRestored: false });
    expect(draft.current).toBe('');
  });

  test('does not restore a submission after the composer was reset', () => {
    const draft = { current: 'Old chat message' };
    const attachments = { current: [{ id: 'old-chat-attachment' }] };
    const revision = { current: 4 };
    const snapshot = takeChatComposerDraftSnapshot({ draft, attachments, revision });
    if (!snapshot) throw new Error('Expected a submission snapshot');

    revision.current += 1;
    const restored = restoreChatComposerDraftSnapshot({ draft, attachments, revision, snapshot });

    expect(restored).toEqual({ draftRestored: false, attachmentsRestored: false });
    expect(draft.current).toBe('');
    expect(attachments.current).toEqual([]);
  });
});
