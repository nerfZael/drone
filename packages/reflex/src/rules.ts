import type { ReflexAnswer, ReflexAnswers, ReflexCondition, ReflexLeafCondition, ReflexRule, ReflexTable } from './types';

/** How concentrated an answer is: 1 for a certain answer, 0 for a flat distribution. */
export function answerConfidence(answer: ReflexAnswer | undefined): number {
  if (!answer) return 0;
  if (answer.type === 'boolean') return Math.abs(answer.probability * 2 - 1);
  const values = Object.values(answer.probabilities ?? {});
  return values.length ? Math.max(...values) : 1;
}

function probabilityOf(answer: ReflexAnswer | undefined, option: string): number {
  if (!answer) return 0;
  if (answer.type === 'boolean') return option === 'true' ? answer.probability : option === 'false' ? 1 - answer.probability : 0;
  if (answer.type === 'choice') return answer.probabilities?.[option] ?? (answer.choice === option ? 1 : 0);
  return answer.probabilities?.[option] ?? 0;
}

function magnitude(answer: ReflexAnswer | undefined): number {
  if (!answer) return 0;
  return answer.type === 'boolean' ? answer.probability : answer.type === 'score' ? answer.score : answerConfidence(answer);
}

export function evaluateCondition(condition: ReflexCondition | null, answers: ReflexAnswers): boolean {
  if (!condition) return true;
  if ('all' in condition) return condition.all.every(item => evaluateCondition(item, answers));
  if ('any' in condition) return condition.any.some(item => evaluateCondition(item, answers));
  if ('not' in condition) return !evaluateCondition(condition.not, answers);
  const answer = answers[condition.question];
  if (!answer) return false;
  if ('is' in condition) {
    const selected = answer.type === 'boolean' ? (answer.probability >= 0.5 ? 'true' : 'false') : answer.type === 'choice' ? answer.choice : String(Math.round(answer.score));
    return selected === condition.is && probabilityOf(answer, condition.is) >= (condition.minProbability ?? 0);
  }
  if ('atLeast' in condition) return magnitude(answer) >= condition.atLeast;
  return magnitude(answer) <= condition.atMost;
}

export function conditionQuestions(condition: ReflexCondition | null, into: Set<string> = new Set()): Set<string> {
  if (!condition) return into;
  if ('all' in condition) condition.all.forEach(item => conditionQuestions(item, into));
  else if ('any' in condition) condition.any.forEach(item => conditionQuestions(item, into));
  else if ('not' in condition) conditionQuestions(condition.not, into);
  else into.add(condition.question);
  return into;
}

export function matchRule(table: Pick<ReflexTable, 'rules'>, answers: ReflexAnswers): ReflexRule | undefined {
  return table.rules.find(rule => evaluateCondition(rule.when, answers));
}

/** Probability that a leaf condition holds, given the answers. Facts and numeric bounds are deterministic. */
function leafProbability(condition: ReflexLeafCondition, answers: ReflexAnswers): number {
  const answer = answers[condition.question];
  if (!answer) return 0;
  // The probability the model put on the option is the evidence; the threshold is code policy, so a
  // miss just under the threshold still counts as a near miss.
  if ('is' in condition) return probabilityOf(answer, condition.is);
  return evaluateCondition(condition, answers) ? 1 : 0;
}

function matchConfidence(condition: ReflexCondition, answers: ReflexAnswers): number {
  if ('all' in condition) return Math.min(1, ...condition.all.map(item => matchConfidence(item, answers)));
  if ('any' in condition) return Math.max(0, ...condition.any.map(item => matchConfidence(item, answers)));
  if ('not' in condition) return failConfidence(condition.not, answers);
  return leafProbability(condition, answers);
}

function failConfidence(condition: ReflexCondition, answers: ReflexAnswers): number {
  if ('all' in condition) return Math.max(0, ...condition.all.map(item => failConfidence(item, answers)));
  if ('any' in condition) return Math.min(1, ...condition.any.map(item => failConfidence(item, answers)));
  if ('not' in condition) return matchConfidence(condition.not, answers);
  return 1 - leafProbability(condition, answers);
}

/**
 * Confidence of a decision. For a conditional rule: the least certain answer it depended on.
 * For the unconditional fallback: how surely every earlier rule failed to match, so "do nothing"
 * is only doubtful when some other rule nearly fired.
 */
export function decisionConfidence(table: Pick<ReflexTable, 'questions' | 'rules'>, rule: ReflexRule | undefined, answers: ReflexAnswers): number {
  if (rule?.when) {
    const ids = [...conditionQuestions(rule.when)];
    return ids.length ? Math.min(...ids.map(id => answerConfidence(answers[id]))) : 1;
  }
  const earlier = table.rules.filter(candidate => candidate !== rule && candidate.when);
  if (!earlier.length) return 1;
  return Math.min(...earlier.map(candidate => failConfidence(candidate.when!, answers)));
}

export function violatedExpectations(table: Pick<ReflexTable, 'expectations'>, answers: ReflexAnswers): string[] {
  return Object.entries(table.expectations ?? {}).filter(([id, expectation]) => {
    const answer = answers[expectationQuestionId(id)];
    return answer?.type === 'boolean' && answer.probability < expectation.threshold;
  }).map(([id]) => id);
}

export const expectationQuestionId = (id: string) => `expect:${id}`;
export const factQuestionId = (name: string) => `fact:${name}`;

/** Code-computed facts become certain answers so rules can combine them with model answers. */
export function factAnswers(facts: Record<string, boolean | number> | undefined): ReflexAnswers {
  const answers: ReflexAnswers = {};
  for (const [name, value] of Object.entries(facts ?? {})) {
    answers[factQuestionId(name)] = typeof value === 'boolean' ? { type: 'boolean', probability: value ? 1 : 0 } : { type: 'score', score: value };
  }
  return answers;
}

/** Questions plus expectations as booleans, each prefixed with the table preamble. */
export function tableQuestions(table: ReflexTable): Record<string, import('./types').ReflexQuestion> {
  const prefix = table.preamble?.trim() ? `${table.preamble.trim()}\n\n` : '';
  const questions: Record<string, import('./types').ReflexQuestion> = {};
  for (const [id, question] of Object.entries(table.questions)) {
    questions[id] = { ...question, instructions: `${prefix}${question.instructions}` } as import('./types').ReflexQuestion;
  }
  for (const [id, expectation] of Object.entries(table.expectations ?? {})) {
    questions[expectationQuestionId(id)] = { type: 'boolean', instructions: `${prefix}${expectation.instructions}`, ...(expectation.criteria ? { criteria: expectation.criteria } : {}) };
  }
  return questions;
}
