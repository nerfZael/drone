import { describe, expect, test } from 'bun:test';

import { selectNextPromptJobId, type SchedulablePromptJob } from '../src/prompt-job-scheduling';

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
