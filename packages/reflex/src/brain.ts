import type { ReflexCondition, ReflexLeafCondition, ReflexRule, ReflexTable } from './types';
import { assertReflexTable } from './validate';

export type ReflexActionSpec = { name: string; description: string };

export type ReflexCompileInput = {
  /** What the loop is for, in one paragraph. */
  purpose: string;
  /** The fields of the serialized state and what they mean. */
  stateDescription: string;
  actions: ReflexActionSpec[];
  /** The table currently in use; the brain revises it. */
  base: ReflexTable;
  /** Why the brain was woken, plus recent evidence such as low-confidence ticks. */
  observations?: string;
  /** Host guidance the brain must respect, for example user-editable instructions. */
  guidance?: string;
};

/** Flat rule shape the brain authors: leaf conditions are ANDed; separate rules express OR. */
export type ReflexBrainRule = {
  id: string;
  description?: string;
  when: ReflexLeafCondition[];
  do: string;
  wake?: string;
};

export type ReflexBrainOutput = {
  questions: ReflexTable['questions'];
  expectations?: ReflexTable['expectations'];
  rules: ReflexBrainRule[];
  preamble?: string;
  notes?: string;
};

export function reflexCompilePrompt(input: ReflexCompileInput): { system: string; prompt: string } {
  const system = [
    'You compile a reflex table for a real-time agent. A fast calibrated evaluator (Jev) answers the table\'s typed questions over a shared state several times per second; code then runs the first rule whose conditions hold.',
    'The evaluator reads literally: scoping words, negations, and implied conditions are taken at face value. It cannot count, cannot compare dates, and degrades with irrelevant context.',
    'Write short, contrastive criteria: say what belongs in each option and what distinguishes it from its neighbours. Include boundary cases. Never ask two judgments in one question; split them.',
    'Rules match in order and the first match acts. Leaf conditions in one rule are ANDed. Put the safest fallback last with an empty condition list. Every rule action must be one of the listed actions.',
    'Keep the wake policy and table identity to the host. Return only the structured output.',
  ].join('\n');
  const prompt = [
    `Purpose:\n${input.purpose}`,
    `State fields:\n${input.stateDescription}`,
    `Actions:\n${input.actions.map(action => `- ${action.name}: ${action.description}`).join('\n')}`,
    Object.keys(input.base.facts ?? {}).length ? `Facts computed in code every tick, usable in rule conditions as boolean questions named fact:<name> (do not redefine them as questions):\n${Object.entries(input.base.facts!).map(([name, description]) => `- fact:${name}: ${description}`).join('\n')}` : '',
    input.guidance ? `Host guidance (must be respected):\n${input.guidance}` : '',
    `Current table (version ${input.base.version}, source ${input.base.source}):\n${JSON.stringify({ preamble: input.base.preamble, questions: input.base.questions, expectations: input.base.expectations, rules: input.base.rules, notes: input.base.notes }, null, 2)}`,
    input.observations ? `Observations since this table was compiled:\n${input.observations}` : '',
    'Revise the table so decisions become confident and correct for this situation. Keep question ids stable when their meaning is unchanged. Explain the revision briefly in notes.',
  ].filter(Boolean).join('\n\n');
  return { system, prompt };
}

function leafToCondition(leaf: ReflexLeafCondition): ReflexCondition {
  if ('is' in leaf) return { question: leaf.question, is: leaf.is, ...(leaf.minProbability !== undefined ? { minProbability: leaf.minProbability } : {}) };
  if ('atLeast' in leaf) return { question: leaf.question, atLeast: leaf.atLeast };
  return { question: leaf.question, atMost: leaf.atMost };
}

/** Merge a brain revision into the base table, validate it, and bump the version. Throws on an invalid table. */
export function applyBrainOutput(base: ReflexTable, output: ReflexBrainOutput, options: { actions?: Iterable<string>; now?: () => number } = {}): ReflexTable {
  const rules: ReflexRule[] = (output.rules ?? []).map(rule => ({
    id: rule.id, do: rule.do,
    when: rule.when?.length ? { all: rule.when.map(leafToCondition) } : null,
    ...(rule.wake ? { wake: rule.wake } : {}),
    ...(rule.description ? { description: rule.description } : {}),
  }));
  const table: ReflexTable = {
    ...base,
    version: base.version + 1,
    source: 'brain',
    createdAt: options.now?.() ?? Date.now(),
    ...(output.preamble !== undefined ? { preamble: output.preamble } : {}),
    questions: output.questions,
    ...(output.expectations !== undefined ? { expectations: output.expectations } : {}),
    rules,
    ...(output.notes !== undefined ? { notes: output.notes } : {}),
  };
  assertReflexTable(table, options.actions);
  return table;
}
