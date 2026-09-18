import type { ReflexCondition, ReflexQuestion, ReflexTable } from './types';
import { expectationQuestionId } from './rules';

export const REFLEX_MAX_CHOICE_OPTIONS = 255;
export const REFLEX_MAX_QUESTIONS = 64;
export const REFLEX_MAX_INSTRUCTION_CHARS = 16_000;
export const REFLEX_MAX_CRITERION_CHARS = 4_000;

const text = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

export function validateReflexQuestion(id: string, question: unknown): string[] {
  const errors: string[] = [];
  const value = question as Partial<ReflexQuestion> | null;
  if (!value || typeof value !== 'object') return [`question ${id}: not an object`];
  if (!text(value.instructions, REFLEX_MAX_INSTRUCTION_CHARS)) errors.push(`question ${id}: instructions must be 1–${REFLEX_MAX_INSTRUCTION_CHARS} characters`);
  if (value.type === 'choice') {
    const criteria = value.criteria && typeof value.criteria === 'object' && !Array.isArray(value.criteria) ? Object.entries(value.criteria) : [];
    if (criteria.length < 2 || criteria.length > REFLEX_MAX_CHOICE_OPTIONS) errors.push(`question ${id}: choice needs 2–${REFLEX_MAX_CHOICE_OPTIONS} options`);
    for (const [option, description] of criteria) {
      if (!option.trim()) errors.push(`question ${id}: empty option name`);
      if (!text(description, REFLEX_MAX_CRITERION_CHARS)) errors.push(`question ${id}: option ${option} needs a description of 1–${REFLEX_MAX_CRITERION_CHARS} characters`);
    }
  } else if (value.type === 'score') {
    const levels = Array.isArray(value.criteria) ? value.criteria : [];
    if (levels.length < 2 || levels.length > REFLEX_MAX_CHOICE_OPTIONS) errors.push(`question ${id}: score needs 2–${REFLEX_MAX_CHOICE_OPTIONS} ordered levels`);
    levels.forEach((level, index) => { if (!text(level, REFLEX_MAX_CRITERION_CHARS)) errors.push(`question ${id}: level ${index} needs a description`); });
  } else if (value.type === 'boolean') {
    const criteria = value.criteria as { true?: unknown; false?: unknown } | undefined;
    if (criteria !== undefined) {
      if (!criteria || typeof criteria !== 'object') errors.push(`question ${id}: boolean criteria must be an object`);
      else for (const key of ['true', 'false'] as const) {
        if (criteria[key] !== undefined && !text(criteria[key], REFLEX_MAX_CRITERION_CHARS)) errors.push(`question ${id}: ${key} criterion must be 1–${REFLEX_MAX_CRITERION_CHARS} characters`);
      }
    }
  } else errors.push(`question ${id}: unknown type`);
  return errors;
}

export function validateReflexQuestions(questions: unknown): string[] {
  if (!questions || typeof questions !== 'object' || Array.isArray(questions)) return ['questions must be an object'];
  const entries = Object.entries(questions as Record<string, unknown>);
  if (!entries.length) return ['at least one question is required'];
  if (entries.length > REFLEX_MAX_QUESTIONS) return [`at most ${REFLEX_MAX_QUESTIONS} questions per evaluation`];
  return entries.flatMap(([id, question]) => (id.trim() ? validateReflexQuestion(id, question) : ['question ids must not be empty']));
}

function validateCondition(condition: unknown, table: ReflexTable, path: string): string[] {
  if (condition === null) return [];
  const value = condition as Record<string, unknown> | null;
  if (!value || typeof value !== 'object') return [`${path}: condition must be an object or null`];
  if (Array.isArray(value.all)) return value.all.flatMap((item, index) => validateCondition(item, table, `${path}.all[${index}]`));
  if (Array.isArray(value.any)) return value.any.flatMap((item, index) => validateCondition(item, table, `${path}.any[${index}]`));
  if ('not' in value) return validateCondition(value.not, table, `${path}.not`);
  const id = String(value.question ?? '');
  const question = table.questions[id]
    ?? (id.startsWith('expect:') && table.expectations?.[id.slice(7)] ? ({ type: 'boolean', instructions: '' } as ReflexQuestion) : undefined)
    ?? (id.startsWith('fact:') && table.facts?.[id.slice(5)] !== undefined ? ({ type: 'boolean', instructions: '' } as ReflexQuestion) : undefined);
  if (!question) return [`${path}: unknown question ${id || '(missing)'}`];
  if ('is' in value) {
    const option = String(value.is);
    const valid = question.type === 'boolean' ? ['true', 'false'].includes(option)
      : question.type === 'choice' ? option in question.criteria
        : /^\d+$/.test(option) && Number(option) < question.criteria.length;
    const errors = valid ? [] : [`${path}: option ${option} does not exist on ${id}`];
    if (value.minProbability !== undefined && !(typeof value.minProbability === 'number' && value.minProbability >= 0 && value.minProbability <= 1)) errors.push(`${path}: minProbability must be 0–1`);
    return errors;
  }
  if ('atLeast' in value || 'atMost' in value) {
    const bound = 'atLeast' in value ? value.atLeast : value.atMost;
    return typeof bound === 'number' && Number.isFinite(bound) ? [] : [`${path}: bound must be a number`];
  }
  return [`${path}: condition needs is, atLeast, atMost, all, any, or not`];
}

/** Structural validation; the host still checks that rule actions exist. */
export function validateReflexTable(input: unknown, actions?: Iterable<string>): string[] {
  const table = input as ReflexTable | null;
  if (!table || typeof table !== 'object') return ['table must be an object'];
  const errors: string[] = [];
  if (!text(table.id, 200)) errors.push('table id is required');
  if (!Number.isInteger(table.version) || table.version < 0) errors.push('table version must be a nonnegative integer');
  if (!['default', 'brain', 'user'].includes(table.source)) errors.push('table source must be default, brain, or user');
  if (table.preamble !== undefined && !text(table.preamble, REFLEX_MAX_INSTRUCTION_CHARS)) errors.push('preamble must be 1–16000 characters when set');
  errors.push(...validateReflexQuestions(table.questions));
  for (const [id, expectation] of Object.entries(table.expectations ?? {})) {
    errors.push(...validateReflexQuestion(expectationQuestionId(id), { type: 'boolean', instructions: expectation?.instructions, criteria: expectation?.criteria }));
    if (!(typeof expectation?.threshold === 'number' && expectation.threshold >= 0 && expectation.threshold <= 1)) errors.push(`expectation ${id}: threshold must be 0–1`);
  }
  for (const [name, description] of Object.entries(table.facts ?? {})) {
    if (!name.trim() || !text(description, REFLEX_MAX_CRITERION_CHARS)) errors.push(`fact ${name || '(empty)'}: needs a name and description`);
  }
  if (!Array.isArray(table.rules) || !table.rules.length) errors.push('at least one rule is required');
  const known = actions ? new Set(actions) : null;
  const ids = new Set<string>();
  (Array.isArray(table.rules) ? table.rules : []).forEach((rule, index) => {
    const path = `rule ${rule?.id || index}`;
    if (!text(rule?.id, 100)) errors.push(`${path}: id is required`);
    else if (ids.has(rule.id)) errors.push(`${path}: duplicate id`);
    ids.add(String(rule?.id));
    if (!text(rule?.do, 100)) errors.push(`${path}: action is required`);
    else if (known && !known.has(rule.do)) errors.push(`${path}: unknown action ${rule.do}`);
    if (rule?.when === null && index !== table.rules.length - 1) errors.push(`${path}: an unconditional rule must be last`);
    if (rule && typeof rule === 'object' && Object.keys(table.questions ?? {}).length) errors.push(...validateCondition(rule.when, table, path));
  });
  const wake = table.wake;
  if (!wake || typeof wake !== 'object') errors.push('wake policy is required');
  else {
    if (!(wake.minConfidence >= 0 && wake.minConfidence <= 1)) errors.push('wake.minConfidence must be 0–1');
    if (!(Number.isInteger(wake.lowConfidenceTicks) && wake.lowConfidenceTicks >= 1)) errors.push('wake.lowConfidenceTicks must be a positive integer');
    if (!(wake.cooldownMs >= 0)) errors.push('wake.cooldownMs must be nonnegative');
    if (wake.maxTableAgeMs !== undefined && !(wake.maxTableAgeMs > 0)) errors.push('wake.maxTableAgeMs must be positive when set');
  }
  return errors;
}

export function assertReflexTable(table: unknown, actions?: Iterable<string>): asserts table is ReflexTable {
  const errors = validateReflexTable(table, actions);
  if (errors.length) throw new Error(`Invalid reflex table: ${errors.join('; ')}`);
}
