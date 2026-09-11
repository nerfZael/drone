import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { FloatingQuestionDock } from '../src/droneHub/chat/FloatingQuestionDock';
import {
  INITIAL_QUESTION_DOCK_STATE,
  closeQuestionDock,
  openQuestionDock,
  syncQuestionDock,
} from '../src/droneHub/chat/floating-question-dock-state';

describe('question dock state', () => {
  test('opens when a questionnaire arrives and closes when it is answered', () => {
    let state = syncQuestionDock(INITIAL_QUESTION_DOCK_STATE, []);
    expect(state.expanded).toBe(false);
    state = syncQuestionDock(state, ['q1']);
    expect(state.expanded).toBe(true);
    state = syncQuestionDock(state, []);
    expect(state.expanded).toBe(false);
  });

  test('stays closed for a questionnaire the user closed, but opens for a new one', () => {
    let state = syncQuestionDock(INITIAL_QUESTION_DOCK_STATE, ['q1']);
    state = closeQuestionDock(state);
    expect(state.expanded).toBe(false);
    // Polling keeps reporting the same questionnaire; it must not pop back open.
    state = syncQuestionDock(state, ['q1']);
    expect(state.expanded).toBe(false);
    // The user can still open it by hand.
    state = openQuestionDock(state);
    expect(state.expanded).toBe(true);
    state = closeQuestionDock(state);
    // A second questionnaire is new information and opens the dock.
    state = syncQuestionDock(state, ['q1', 'q2']);
    expect(state.expanded).toBe(true);
    // Once q1 is gone its dismissal is forgotten, so asking it again reopens.
    state = closeQuestionDock(state);
    state = syncQuestionDock(state, []);
    state = syncQuestionDock(state, ['q1']);
    expect(state.expanded).toBe(true);
  });

  test('returns the same state object when nothing changed', () => {
    const state = syncQuestionDock(INITIAL_QUESTION_DOCK_STATE, ['q1']);
    expect(syncQuestionDock(state, ['q1'])).toBe(state);
  });
});

const request = {
  id: 'req-1',
  status: 'pending' as const,
  createdAt: '2026-09-11T10:00:00.000Z',
  updatedAt: '2026-09-11T10:00:00.000Z',
  questions: [
    {
      id: 'q-1',
      question: 'Which database should the service use?',
      importance: 80,
      choices: [
        { id: 'pg', label: 'PostgreSQL', recommended: true },
        { id: 'sqlite', label: 'SQLite' },
      ],
    },
  ],
} as any;

describe('floating question dock', () => {
  test('renders nothing without pending questionnaires', () => {
    expect(renderToStaticMarkup(
      <FloatingQuestionDock requests={[]} busyId={null} onSubmit={() => undefined} onSkip={() => undefined} />,
    )).toBe('');
  });

  test('opens over the chat with the questionnaire and a close control when questions arrive', () => {
    const html = renderToStaticMarkup(
      <FloatingQuestionDock requests={[request]} busyId={null} onSubmit={() => undefined} onSkip={() => undefined} />,
    );
    expect(html).toContain('data-floating-question-dock="expanded"');
    expect(html).toContain('absolute inset-0');
    expect(html).toContain('aria-label="Close questions"');
    // Expanded, the questions are the whole window: no title row, no card frame,
    // and a body that scrolls on its own.
    expect(html).not.toContain('The agent has a question');
    expect(html).not.toContain('border-[var(--chat-card-border)]');
    expect(html).not.toContain('dh-agent-activity-scrollbar');
    expect(html).toContain('overflow-y-auto');
    expect(html).toContain('Which database should the service use?');
    expect(html).toContain('data-assistant-question-card="true"');
    expect(html).not.toContain('data-floating-question-dock="collapsed"');
  });
});
