import { expect, test } from 'bun:test';
import { answerConfidence, applyBrainOutput, decisionConfidence, evaluateCondition, matchRule, tableQuestions, validateReflexTable, violatedExpectations, type ReflexTable } from '../src';

export const table: ReflexTable = {
  id: 'test', version: 1, source: 'default', createdAt: 0, preamble: 'State: text is the unsent speech.',
  questions: {
    intent: { type: 'choice', instructions: 'Classify the intent.', criteria: { request: 'Asks for work.', cancel: 'Stops work.', chatter: 'Not for the agent.' } },
    complete: { type: 'boolean', instructions: 'Is the request complete?' },
    urgency: { type: 'score', instructions: 'How urgent?', criteria: ['low', 'medium', 'high'] },
  },
  expectations: { onTopic: { instructions: 'Is the user talking about software?', threshold: 0.3 } },
  rules: [
    { id: 'cancel', when: { question: 'intent', is: 'cancel', minProbability: 0.8 }, do: 'cancel', wake: 'user cancelled' },
    { id: 'send', when: { all: [{ question: 'intent', is: 'request' }, { question: 'complete', atLeast: 0.6 }] }, do: 'send' },
    { id: 'wait', when: null, do: 'wait' },
  ],
  wake: { minConfidence: 0.5, lowConfidenceTicks: 3, cooldownMs: 1000 },
};

test('conditions read choice, boolean, and score answers with probability bounds', () => {
  const answers = {
    intent: { type: 'choice' as const, choice: 'cancel', probabilities: { cancel: 0.7, request: 0.2, chatter: 0.1 } },
    complete: { type: 'boolean' as const, probability: 0.9 },
    urgency: { type: 'score' as const, score: 1.6, probabilities: { '0': 0.1, '1': 0.2, '2': 0.7 } },
  };
  expect(evaluateCondition({ question: 'intent', is: 'cancel' }, answers)).toBe(true);
  expect(evaluateCondition({ question: 'intent', is: 'cancel', minProbability: 0.8 }, answers)).toBe(false);
  expect(evaluateCondition({ question: 'complete', is: 'true' }, answers)).toBe(true);
  expect(evaluateCondition({ question: 'urgency', atLeast: 1.5 }, answers)).toBe(true);
  expect(evaluateCondition({ question: 'urgency', atMost: 1 }, answers)).toBe(false);
  expect(evaluateCondition({ not: { question: 'missing', is: 'x' } }, answers)).toBe(true);
  expect(matchRule(table, answers)?.id).toBe('wait');
  expect(answerConfidence(answers.complete)).toBeCloseTo(0.8);
  expect(answerConfidence(answers.intent)).toBe(0.7);
  expect(decisionConfidence(table, table.rules[0], answers)).toBe(0.7);
  // Fallback confidence: cancel needed P(cancel) ≥ 0.8 and had 0.7, so that rule failed with only 0.3 certainty.
  expect(decisionConfidence(table, table.rules[2], answers)).toBeCloseTo(0.3);
  const clearWait = { ...answers, intent: { type: 'choice' as const, choice: 'chatter', probabilities: { cancel: 0.05, request: 0.05, chatter: 0.9 } }, complete: { type: 'boolean' as const, probability: 0.5 } };
  // Nothing nearly fired: cancel fails at 0.95, send fails at 0.95 (intent is not request), so waiting is a confident decision even though complete is 50/50.
  expect(decisionConfidence(table, table.rules[2], clearWait)).toBeCloseTo(0.95);
});

test('expectations become boolean questions and report violations', () => {
  const questions = tableQuestions(table);
  expect(questions['expect:onTopic']).toMatchObject({ type: 'boolean' });
  expect(questions.intent.instructions.startsWith('State: text is the unsent speech.\n\n')).toBe(true);
  expect(violatedExpectations(table, { 'expect:onTopic': { type: 'boolean', probability: 0.1 } })).toEqual(['onTopic']);
  expect(violatedExpectations(table, { 'expect:onTopic': { type: 'boolean', probability: 0.5 } })).toEqual([]);
});

test('validation rejects unknown questions, options, actions, and misplaced fallbacks', () => {
  expect(validateReflexTable(table, ['cancel', 'send', 'wait'])).toEqual([]);
  expect(validateReflexTable({ ...table, rules: [{ id: 'x', when: { question: 'nope', is: 'a' }, do: 'send' }] })).toContainEqual(expect.stringContaining('unknown question nope'));
  expect(validateReflexTable({ ...table, rules: [{ id: 'x', when: { question: 'intent', is: 'zzz' }, do: 'send' }] })).toContainEqual(expect.stringContaining('option zzz'));
  expect(validateReflexTable(table, ['send'])).toContainEqual(expect.stringContaining('unknown action cancel'));
  expect(validateReflexTable({ ...table, rules: [table.rules[2], table.rules[0]] })).toContainEqual(expect.stringContaining('must be last'));
  expect(validateReflexTable({ ...table, questions: { intent: { type: 'choice', instructions: 'x', criteria: { only: 'one' } } } })).toContainEqual(expect.stringContaining('2–255 options'));
  expect(validateReflexTable({ ...table, wake: { minConfidence: 2, lowConfidenceTicks: 0, cooldownMs: -1 } }).length).toBe(3);
});

test('brain output is merged, validated, and versioned', () => {
  const next = applyBrainOutput(table, {
    questions: { intent: table.questions.intent, complete: table.questions.complete },
    rules: [
      { id: 'send', when: [{ question: 'intent', is: 'request', minProbability: 0.6 }, { question: 'complete', atLeast: 0.5 }], do: 'send' },
      { id: 'wait', when: [], do: 'wait' },
    ],
    notes: 'Dropped urgency.',
  }, { actions: ['send', 'wait'], now: () => 42 });
  expect(next).toMatchObject({ version: 2, source: 'brain', createdAt: 42, notes: 'Dropped urgency.', preamble: table.preamble, wake: table.wake });
  expect(next.rules[0].when).toEqual({ all: [{ question: 'intent', is: 'request', minProbability: 0.6 }, { question: 'complete', atLeast: 0.5 }] });
  expect(next.rules[1].when).toBeNull();
  expect(() => applyBrainOutput(table, { questions: table.questions, rules: [{ id: 'x', when: [], do: 'explode' }] }, { actions: ['send'] })).toThrow(/unknown action explode/);
});
