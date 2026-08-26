import React from 'react';
import { beforeEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { AssistantQuestionCard } from '../src/droneHub/assistant/AssistantQuestionCard';
import { setAssistantQuestionViewMode } from '../src/droneHub/assistant/assistant-question-view-mode';

describe('AssistantQuestionCard', () => {
  beforeEach(() => setAssistantQuestionViewMode('single'));

  test('preselects the recommendation and exposes distinct custom and skip controls', () => {
    const html = renderToStaticMarkup(
      <AssistantQuestionCard
        request={{
          id: 'request-1',
          droneId: 'drone-1',
          chatName: 'default',
          chatId: 'chat-1',
          toolName: 'drone_hub__ask_questions',
          createdAt: '2026-08-25T00:00:00.000Z',
          updatedAt: '2026-08-25T00:00:00.000Z',
          status: 'pending',
          questions: [
            {
              id: 'delivery',
              question: 'How should this ship?',
              detailedExplanation: 'This controls the **rollout**.',
              importance: 80,
              choices: [
                { id: 'safe', label: 'Safe rollout', recommended: true },
                { id: 'fast', label: 'Immediate rollout' },
              ],
            },
          ],
        }}
        busy={false}
        onSubmit={() => {}}
        onSkip={() => {}}
      />,
    );

    expect(html).toContain('Importance 80/100');
    expect(html).toContain('<strong>rollout</strong>');
    expect(html).toContain('Safe rollout');
    expect(html).toContain('Recommended');
    expect(html).toContain('checked=""');
    expect(html).toContain('Something else');
    expect(html).toContain('>A</span>');
    expect(html).toContain('>B</span>');
    expect(html).toContain('>C</span>');
    expect(html).toContain('Skip this question');
    expect(html).toContain('maxLength="8000"');
    expect(html).toContain('placeholder="Add optional notes for the agent…"');
    expect(html).toContain('Skip questionnaire');
    expect(html).toContain('Submit answer');
    expect(html).toContain('data-assistant-question-card="true"');
    expect(html).toContain('border border-[var(--chat-card-border)]');
    expect(html).toContain('bg-[var(--chat-card-bg)]');
    expect(html).toContain('max-w-[var(--chat-interactive-max)]');
    expect(html).not.toContain('bg-[var(--panel-raised)]');
    expect(html).not.toContain('Input requested');
    expect(html).not.toContain('Review the recommendations');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('Show all');
    expect(html).toContain('1 of 1');
    expect(html).toContain('aria-label="Previous question"');
    expect(html).toContain('aria-label="Next question"');
  });

  test('uses one shared mode to switch every questionnaire to the all-questions view', () => {
    setAssistantQuestionViewMode('all');
    const html = renderToStaticMarkup(
      <AssistantQuestionCard
        request={{
          id: 'request-2',
          droneId: 'drone-1',
          chatName: 'default',
          chatId: 'chat-1',
          toolName: 'drone_hub__ask_questions',
          createdAt: '2026-08-25T00:00:00.000Z',
          updatedAt: '2026-08-25T00:00:00.000Z',
          status: 'pending',
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
  });
});
