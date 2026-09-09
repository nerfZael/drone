import React from 'react';
import { beforeEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { AssistantQuestionCard } from '../src/droneHub/assistant/AssistantQuestionCard';
import { setAssistantQuestionViewMode } from '../src/droneHub/assistant/assistant-question-view-mode';

const baseRequest = {
  id: 'request-1',
  droneId: 'drone-1',
  chatName: 'default',
  chatId: 'chat-1',
  toolName: 'drone_hub__ask_questions',
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
  status: 'pending' as const,
};

const deliveryQuestion = {
  id: 'delivery',
  question: 'How should this ship?',
  detailedExplanation: 'This controls the **rollout**.',
  importance: 80,
  choices: [
    { id: 'safe', label: 'Safe rollout', recommended: true },
    { id: 'fast', label: 'Immediate rollout' },
  ],
};

describe('AssistantQuestionCard', () => {
  beforeEach(() => setAssistantQuestionViewMode('single'));

  test('shows the recommendation without preselecting it and exposes custom and skip controls', () => {
    const html = renderToStaticMarkup(
      <AssistantQuestionCard
        request={{
          ...baseRequest,
          questions: [
            deliveryQuestion,
            {
              id: 'timing',
              question: 'When should it ship?',
              importance: 40,
              choices: [{ id: 'now', label: 'Now' }],
            },
          ],
        }}
        busy={false}
        onSubmit={() => {}}
        onSkip={() => {}}
      />,
    );

    expect(html).toContain('>80/100</span>');
    expect(html).not.toContain('Importance 80/100');
    expect(html).not.toContain('answer while the agent works');
    expect(html).toContain('<strong>rollout</strong>');
    expect(html).toContain('Safe rollout');
    expect(html).toContain('Recommended');
    expect(html).not.toContain('checked=""');
    expect(html).toContain('Something else');
    expect(html).toContain('>A</span>');
    expect(html).toContain('>B</span>');
    expect(html).toContain('>C</span>');
    expect(html).toContain('aria-label="Skip this question"');
    expect(html).toContain('maxLength="8000"');
    expect(html).toContain('placeholder="Add optional notes for the agent…"');
    expect(html).toContain('Skip questionnaire');
    expect(html).toContain('Submit all 2 answers');
    expect(html).toContain('data-assistant-question-card="true"');
    expect(html).toContain('border border-[var(--chat-card-border)]');
    expect(html).toContain('bg-[var(--chat-card-bg)]');
    expect(html).toContain('max-w-[var(--chat-interactive-max)]');
    expect(html).not.toContain('bg-[var(--panel-raised)]');
    expect(html).not.toContain('Input requested');
    expect(html).not.toContain('Review the recommendations');
    expect(html).not.toContain('Answer or skip each question to submit.');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('Show all');
    expect(html).toContain('1 of 2');
    expect(html).toContain('aria-label="Previous question"');
    expect(html).toContain('aria-label="Next question"');
    // The second question is hidden in the one-at-a-time view.
    expect(html).not.toContain('When should it ship?');
  });

  test('drops the per-question chrome when there is only one question', () => {
    const html = renderToStaticMarkup(
      <AssistantQuestionCard
        request={{ ...baseRequest, questions: [deliveryQuestion] }}
        busy={false}
        onSubmit={() => {}}
        onSkip={() => {}}
      />,
    );

    expect(html).toContain('How should this ship?');
    expect(html).not.toContain('1. How should this ship?');
    expect(html).toContain('Submit answer');
    expect(html).toContain('Skip questionnaire');
    expect(html).not.toContain('Skip this question');
    expect(html).not.toContain('1 of 1');
    expect(html).not.toContain('aria-label="Previous question"');
    expect(html).not.toContain('role="switch"');
  });

  test('disables submit with a hint until every question is answered or skipped', () => {
    const html = renderToStaticMarkup(
      <AssistantQuestionCard
        request={{
          ...baseRequest,
          questions: [
            {
              id: 'open',
              question: 'Which option?',
              importance: 50,
              choices: [{ id: 'a', label: 'Option A' }],
            },
          ],
        }}
        busy={false}
        onSubmit={() => {}}
        onSkip={() => {}}
      />,
    );

    expect(html).toContain('title="Answer or skip the remaining question first"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Submit answer<\/button>/);
    expect(html).toContain('text-[var(--accent-fg)]');
    expect(html).not.toContain('accent-contrast');
  });

  test('uses one shared mode to switch every questionnaire to the all-questions view', () => {
    setAssistantQuestionViewMode('all');
    const html = renderToStaticMarkup(
      <AssistantQuestionCard
        request={{
          ...baseRequest,
          id: 'request-2',
          questions: [
            {
              id: 'first',
              question: 'First question?',
              importance: 80,
              choices: [{ id: 'yes', label: 'Yes', recommended: true }],
            },
            {
              id: 'second',
              question: 'Second question?',
              importance: 70,
              choices: [{ id: 'no', label: 'No', recommended: true }],
            },
          ],
        }}
        busy={false}
        onSubmit={() => {}}
        onSkip={() => {}}
      />,
    );

    expect(html).toContain('1. First question?');
    expect(html).toContain('2. Second question?');
    expect(html).toContain('One at a time');
    expect(html).toContain('Submit all 2 answers');
    expect(html).toContain('aria-checked="false"');
    expect(html).not.toContain('aria-label="Previous question"');
    // Every question keeps its own skip control in the all-questions view.
    expect(html.split('aria-label="Skip this question"').length - 1).toBe(2);
  });
});
