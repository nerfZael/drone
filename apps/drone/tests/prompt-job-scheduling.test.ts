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
        job('running-asap', 'asap', 'running'),
        job('done-asap', 'asap', 'done'),
        job('queued', 'queue'),
      ]),
    ).toBe('queued');
    expect(selectNextPromptJobId([job('done', 'queue', 'done')])).toBeNull();
  });
});
