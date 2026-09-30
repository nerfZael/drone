import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { EntityMessage } from '../src/droneHub/entity/EntityChat';

const options = [{ label: 'Add it to Login page', recommended: true }, { label: 'Start a separate worker' }];

test('a question shows its options to click, the recommended one tagged', () => {
  const html = renderToStaticMarkup(<EntityMessage mine={false} text="Same worker or a separate one?" options={options} answer={null} onChoose={() => undefined} />);
  expect(html).toContain('role="radiogroup"');
  expect(html).toContain('Add it to Login page');
  expect(html).toContain('Recommended');
  expect(html).not.toContain('disabled=""');
});

test('once answered, the choice is checked and the options are locked', () => {
  const html = renderToStaticMarkup(<EntityMessage mine={false} text="Same worker or a separate one?" options={options} answer={{ text: 'Start a separate worker' }} onChoose={() => undefined} />);
  expect(html).toMatch(/aria-checked="true"[^>]*disabled=""/);
  expect(html).toContain('✓');
  const typed = renderToStaticMarkup(<EntityMessage mine={false} text="Which one?" options={options} answer={{ text: 'neither, do it later' }} />);
  expect(typed).toContain('You answered: neither, do it later');
});

test('under a user message: the workers it started, steered or queued, from the log', async () => {
  const { routingNotes } = await import('../src/droneHub/entity/EntityChat');
  const e = (seq: number, type: string, by: string, data: Record<string, unknown>) => ({ seq, t: seq, at: seq, type, by, data });
  const events = [
    e(3, 'chat_message', 'user', { text: 'make e2e tests' }),
    e(4, 'limb_spawned', 'voice', { id: 'worker-4', reply_to: 3 }),
    e(5, 'chat_message', 'user', { text: 'in one worker' }),
    e(6, 'steered', 'voice', { id: 'worker-4', text: 'merge' }),
    e(7, 'chat_message', 'user', { text: 'then docs' }),
    e(8, 'steered', 'voice', { id: 'worker-4', text: 'docs', when: 'after' }),
  ] as any[];
  const name = (id: string) => (id === 'worker-4' ? 'E2E tests' : id);
  expect(routingNotes(events[0], events, name)).toEqual([{ text: 'started E2E tests', worker: 'worker-4' }]);
  expect(routingNotes(events[2], events, name)).toEqual([{ text: 'sent to E2E tests', worker: 'worker-4' }]);
  expect(routingNotes(events[4], events, name)).toEqual([{ text: 'queued for E2E tests', worker: 'worker-4' }]);
});

test('a message shows the files it links, to open', () => {
  const html = renderToStaticMarkup(<EntityMessage mine={false} text="Planned the tests." files={['.entity/artifacts/s1/e2e-plan.md']} onOpenFile={() => undefined} />);
  expect(html).toContain('e2e-plan.md');
  expect(html).toContain('title="Open .entity/artifacts/s1/e2e-plan.md"');
});

test('open questions: a worker\'s question in its thread is not lost; answered ones and asides are not listed', async () => {
  const { openQuestions } = await import('../src/droneHub/entity/EntityChat');
  const e = (seq: number, type: string, by: string, data: Record<string, unknown>) => ({ seq, t: seq * 1000, at: seq, type, by, data });
  const limbs = [
    { id: 'worker-5', role: 'task', name: 'Game concept', status: 'done' },
    { id: 'worker-6', role: 'task', name: 'Tests', status: 'running', asking: 9 },
    { id: 'worker-7', role: 'task', name: 'Docs', status: 'done' },
  ];
  const events = [
    e(1, 'chat_message', 'voice', { text: 'What kind of game?' }),
    e(2, 'chat_message', 'user', { text: 'Arcade' }),
    e(3, 'chat_message', 'worker-5', { text: 'Concept ready. Which platform?', thread: true }),
    e(4, 'task_done', 'worker-5', {}),
    e(5, 'chat_message', 'worker-7', { text: 'Should I use Markdown?' }),
    e(6, 'chat_message', 'worker-7', { text: 'Using Markdown; done.' }),
    e(9, 'chat_message', 'worker-6', { text: 'Staging or production?', question: true, options: [{ label: 'Staging' }] }),
  ] as any[];
  const open = openQuestions(events, { limbs } as any);
  expect(open.map(q => q.seq)).toEqual([3, 9]);
  expect(open[0]).toMatchObject({ name: 'Game concept', worker: true, inThread: true });
  expect(open[1].options).toEqual([{ label: 'Staging' }]);
  // A message to the worker answers it.
  const answered = [...events, e(10, 'steered', 'user', { id: 'worker-5', text: 'Browser' })];
  expect(openQuestions(answered, { limbs } as any).map(q => q.seq)).toEqual([9]);
});

test('digests: worker messages that arrive together are one group; questions and the user break it', async () => {
  const { digestGroups } = await import('../src/droneHub/entity/EntityChat');
  const m = (seq: number, t: number, by: string, text = 'done') => ({ seq, t, at: t, type: 'chat_message', by, data: { text } }) as any;
  const groups = digestGroups([
    m(1, 0, 'user', 'go'), m(2, 5_000, 'worker-3'), m(3, 9_000, 'worker-4'), m(4, 12_000, 'worker-5'),
    m(5, 40_000, 'worker-6'), m(6, 41_000, 'worker-7', 'Which one?'), m(7, 42_000, 'worker-8'),
  ], by => by.startsWith('worker'));
  expect(groups.map(g => g.map(x => x.seq))).toEqual([[1], [2, 3, 4], [5], [6], [7]]);
});

test('several questions: chips per question with the recommended one preselected, one button to send; once answered, the picks show', async () => {
  const { QuestionsCard, answersText } = await import('../src/droneHub/entity/EntityChat');
  const questions = [{ question: 'Keyboard or touch?', options: [{ label: 'Both', recommended: true }, { label: 'Keyboard' }] }, { question: 'A name?' }];
  const open = renderToStaticMarkup(<QuestionsCard questions={questions} answer={null} onSubmit={() => undefined} />);
  expect(open).toContain('Send answers');
  expect(open).toMatch(/aria-checked="true"[^>]*>✓ Both/);
  expect(open).toContain('Answer…');
  const answered = renderToStaticMarkup(<QuestionsCard questions={questions} answer={{ picks: ['Keyboard', 'Comet'] }} />);
  expect(answered).not.toContain('Send answers');
  expect(answered).toContain('✓ Keyboard');
  expect(answered).toContain('✓ Comet');
  expect(answersText(questions, ['Both', ''])).toBe('1. Keyboard or touch? Both\n2. A name? —');
});
