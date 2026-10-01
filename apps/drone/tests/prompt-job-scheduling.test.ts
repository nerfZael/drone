import { describe, expect, test } from 'bun:test';

import {
  promptJobBelongsToOtherChat,
  selectNextPromptJobId,
  type SchedulablePromptJob,
} from '../src/prompt-job-scheduling';

function job(
  id: string,
  deliveryMode?: SchedulablePromptJob['deliveryMode'],
  state: SchedulablePromptJob['state'] = 'queued',
): SchedulablePromptJob {
  return { id, deliveryMode, state };
}

describe('external prompt job scheduling', () => {
  test('runs ASAP jobs before older queued jobs', () => {
    expect(
      selectNextPromptJobId([
        job('queue-one', 'queue'),
        job('asap-one', 'asap'),
        job('queue-two', 'queue'),
      ]),
    ).toBe('asap-one');
  });

  test('preserves FIFO order within the same delivery mode', () => {
    expect(
      selectNextPromptJobId([
        job('queue-one', 'queue'),
        job('asap-one', 'asap'),
        job('asap-two', 'asap'),
      ]),
    ).toBe('asap-one');
    expect(selectNextPromptJobId([job('queue-one'), job('queue-two', 'queue')])).toBe('queue-one');
  });

  test('ignores jobs that are not queued', () => {
    expect(
      selectNextPromptJobId([
        job('canceled-asap', 'asap', 'canceled'),
        job('done-asap', 'asap', 'done'),
        job('queued', 'queue'),
      ]),
    ).toBe('queued');
    expect(selectNextPromptJobId([job('done', 'queue', 'done')])).toBeNull();
  });
});


describe('per-chat execution slots', () => {
  const active = { ...job('active', 'queue', 'running'), chatKey: 'graphics' };
  test('runs another chat while preserving same-chat ordering, including ASAP', () => {
    expect(selectNextPromptJobId([
      active,
      { ...job('same-chat-asap', 'asap'), chatKey: 'graphics' },
      { ...job('crash-fix'), chatKey: 'crash' },
    ])).toBe('crash-fix');
  });
  test('restored running records reserve the same chat after restart', () => {
    const restored = JSON.parse(JSON.stringify(active));
    expect(selectNextPromptJobId([restored, { ...job('next'), chatKey: 'graphics' }])).toBeNull();
    restored.state = 'canceled';
    expect(selectNextPromptJobId([restored, { ...job('next'), chatKey: 'graphics' }])).toBe('next');
  });
  test('legacy stream identities isolate chats and unknown jobs retain exclusivity', () => {
    const stream = { ...job('stream', 'queue', 'running'), claudeStream: { sessionKey: 'one' } };
    expect(selectNextPromptJobId([stream, { ...job('two'), claudeStream: { sessionKey: 'two' } }])).toBe('two');
    expect(selectNextPromptJobId([stream, { ...job('same'), chatKey: 'stable-id', claudeStream: { sessionKey: 'one' } }])).toBeNull();
    expect(selectNextPromptJobId([active, { ...job('same'), chatKey: 'graphics', claudeStream: { sessionKey: 'new-stream' } }])).toBeNull();
    expect(selectNextPromptJobId([stream, job('unknown')])).toBeNull();
    expect(selectNextPromptJobId([job('unknown', 'queue', 'running'), { ...job('next'), chatKey: 'known' }])).toBeNull();
  });
});

describe('prompt job chat ownership', () => {
  const hud = 'codex-chat:drone-1:d6c00def-ec99-4b7f-9233-5c0188615d25';
  const units = 'codex-chat:drone-1:431477b1-9fb4-4f42-8c2f-5231e8b2e527';

  test('detects a resubmitted job ID from another chat', () => {
    expect(promptJobBelongsToOtherChat({ codexAppServer: { sessionKey: hud } }, { codexAppServer: { sessionKey: units } })).toBe(true);
  });

  test('treats a retry from the same chat as the same job, including legacy keys', () => {
    expect(promptJobBelongsToOtherChat({ codexAppServer: { sessionKey: hud } }, { codexAppServer: { sessionKey: hud } })).toBe(false);
    expect(
      promptJobBelongsToOtherChat(
        { codexAppServer: { sessionKey: 'codex:drone-1:HUD:d6c00def-ec99-4b7f-9233-5c0188615d25' } },
        { codexAppServer: { sessionKey: hud } },
      ),
    ).toBe(false);
  });

  test('cannot prove a conflict without chat identities', () => {
    expect(promptJobBelongsToOtherChat({}, { codexAppServer: { sessionKey: units } })).toBe(false);
  });
});
