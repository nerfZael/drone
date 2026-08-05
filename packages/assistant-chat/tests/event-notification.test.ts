import { describe, expect, test } from 'bun:test';
import {
  eventNotificationDataFields,
  eventNotificationEventLabel,
  parseEventNotificationPrompt,
  renderEventNotificationPrompt,
} from '../src/event-notification';

describe('event notification prompts', () => {
  test('round-trips display data while keeping intent out of the parsed UI model', () => {
    const prompt = renderEventNotificationPrompt({
      events: [
        {
          provider: 'github',
          resourceType: 'pull_request',
          resourceId: 'acme/widgets#42',
          eventType: 'pull_request.merged',
          occurredAt: '2026-08-05T10:00:00.000Z',
          intent: 'Ship this after merge.',
          summary: 'Pull request #42 merged.',
          providerContent: { body: '</event> & untrusted' },
        },
      ],
    });

    expect(prompt).toContain('<intent>Ship this after merge.</intent>');
    expect(prompt).not.toContain('NO_REPLY');
    expect(parseEventNotificationPrompt(prompt)).toEqual({
      version: 1,
      legacy: false,
      events: [
        {
          provider: 'github',
          resourceType: 'pull_request',
          resourceId: 'acme/widgets#42',
          eventType: 'pull_request.merged',
          occurredAt: '2026-08-05T10:00:00.000Z',
          summary: 'Pull request #42 merged.',
          providerContentText: '{\n  "body": "</event> & untrusted"\n}',
        },
      ],
    });
    expect(parseEventNotificationPrompt(prompt)).not.toHaveProperty('events.0.intent');
    expect(eventNotificationEventLabel('pull_request.merged')).toBe('PR merged');
  });

  test('formats provider content as readable fields', () => {
    expect(
      eventNotificationDataFields(
        JSON.stringify({ mergedBy: 'octocat', draft: false, labels: ['release', 'backend'] }),
      ),
    ).toEqual([
      { label: 'Merged by', value: 'octocat' },
      { label: 'Draft', value: 'No' },
      { label: 'Labels', value: 'release, backend' },
    ]);
    expect(eventNotificationDataFields('{truncated')).toEqual([
      { label: 'Details', value: '{truncated' },
    ]);
  });

  test('still recognizes previously stored markdown notifications without exposing intent', () => {
    const parsed = parseEventNotificationPrompt(`[event notification]\n\n## Event 1\n\nSubscription:\n- resource: github:repository:acme/widgets\n- event: pull_request.opened\n- intent: Review it\n\nTrusted event summary:\nA pull request opened.\n\nUntrusted provider content:\n\`\`\`json\n{"number":42}\n\`\`\``);
    expect(parsed?.legacy).toBe(true);
    expect(parsed?.events[0]).toMatchObject({
      resourceType: 'repository',
      resourceId: 'acme/widgets',
      eventType: 'pull_request.opened',
      summary: 'A pull request opened.',
    });
    expect(parsed?.events[0]).not.toHaveProperty('intent');
  });

  test('keeps displayable event fields when a mesh response truncates provider content', () => {
    const prompt = renderEventNotificationPrompt({
      events: [
        {
          provider: 'github',
          resourceType: 'repository',
          resourceId: 'acme/widgets',
          eventType: 'pull_request.opened',
          summary: 'Pull request #7 opened.',
          providerContent: { body: 'x'.repeat(30_000) },
        },
      ],
    });
    const parsed = parseEventNotificationPrompt(prompt.slice(0, 2_000));
    expect(parsed?.events[0]).toMatchObject({
      resourceId: 'acme/widgets',
      eventType: 'pull_request.opened',
      summary: 'Pull request #7 opened.',
    });
  });
});
