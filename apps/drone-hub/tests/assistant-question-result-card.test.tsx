import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'bun:test';

import { AssistantQuestionResultCard } from '../src/droneHub/assistant/AssistantQuestionResultCard';

describe('AssistantQuestionResultCard', () => {
  test('renders submitted choices, custom answers, skipped questions, and notes', () => {
    const html = renderToStaticMarkup(
      <AssistantQuestionResultCard
        request={{
          id: 'questions-1',
          droneId: 'drone-a',
          chatName: 'default',
          chatId: 'chat-a',
          toolName: 'ask_questions',
          createdAt: '2026-08-26T10:00:00.000Z',
          updatedAt: '2026-08-26T10:01:00.000Z',
          status: 'submitted',
          questions: [
            {
              id: 'form',
              question: 'What form does it take?',
              importance: 80,
              choices: [
                { id: 'web', label: 'Web app' },
                { id: 'mobile', label: 'Mobile app' },
              ],
            },
            {
              id: 'goal',
              question: 'What should it do?',
              importance: 70,
              choices: [
                { id: 'write', label: 'Write code' },
                { id: 'plan', label: 'Make a plan' },
              ],
            },
            {
              id: 'optional',
              question: 'Any deadline?',
              importance: 20,
              choices: [
                { id: 'soon', label: 'Soon' },
                { id: 'later', label: 'Later' },
              ],
            },
          ],
          result: {
            status: 'submitted',
            requestId: 'questions-1',
            responses: [
              { questionId: 'form', outcome: 'choice', choiceId: 'web', label: 'Web app' },
              { questionId: 'goal', outcome: 'custom', text: 'Review the existing code' },
              { questionId: 'optional', outcome: 'skipped' },
            ],
            notes: 'Keep the first version small.',
          },
        }}
      />,
    );

    expect(html).toContain('Answers submitted');
    expect(html).toContain('What form does it take?');
    expect(html).toContain('Web app');
    expect(html).toContain('Review the existing code');
    expect(html).toContain('Skipped');
    expect(html).toContain('Keep the first version small.');
    expect(html).not.toContain('Submit answers');
  });
});
