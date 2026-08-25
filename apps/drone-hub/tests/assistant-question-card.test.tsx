import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { AssistantQuestionCard } from '../src/droneHub/assistant/AssistantQuestionCard';

describe('AssistantQuestionCard', () => {
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
    expect(html).toContain('Skip this question');
    expect(html).toContain('maxLength="8000"');
  });
});
