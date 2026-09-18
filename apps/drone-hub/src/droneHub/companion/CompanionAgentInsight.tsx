import React from 'react';
import type { CompanionReflexDecision, CompanionReflexInsight } from '@drone/assistant-chat';
import { conditionQuestions, type ReflexAnswer, type ReflexCondition, type ReflexQuestion, type ReflexTable } from '@drone/reflex';

const QUESTION_LABELS: Record<string, string> = { delegation: 'ready to send', intent: 'intent', addressed: 'talking to me', 'expect:backendOnTrack': 'backend on track' };
const FACT_LABELS: Record<string, string> = { backendStalled: 'backend stalled', backendJustReplied: 'backend just replied', userSilent: 'you went quiet', hasEvents: 'new events' };
const ACTION_LABELS: Record<string, string> = { wait: 'Waiting for more', send: 'Sent to Companion', skip: 'Ignored, not for me', cancel: 'Cancelled the work', nudge: 'Nudged the backend', notify: 'Showed you a note' };

function condition(value: ReflexCondition | null): string {
  if (!value) return 'otherwise';
  if ('all' in value) return value.all.map(condition).join(' and ');
  if ('any' in value) return `(${value.any.map(condition).join(' or ')})`;
  if ('not' in value) return `not ${condition(value.not)}`;
  const name = QUESTION_LABELS[value.question] ?? value.question.replace(/^fact:/, '');
  if ('is' in value) return `${name} is ${value.is}${value.minProbability !== undefined ? ` (≥ ${Math.round(value.minProbability * 100)}%)` : ''}`;
  if ('atLeast' in value) return `${name} ≥ ${value.atLeast}`;
  return `${name} ≤ ${value.atMost}`;
}

/** One answer in words: "ready to send 21%" or "intent: request 95%". */
function answerInWords(id: string, answer: ReflexAnswer | undefined, question: ReflexQuestion | undefined): string | null {
  if (!answer || id.startsWith('fact:')) return null;
  const label = QUESTION_LABELS[id] ?? id.replace(/^expect:/, '');
  if (answer.type === 'boolean') return `${label} ${Math.round(answer.probability * 100)}%`;
  if (answer.type === 'choice') {
    const p = answer.probabilities?.[answer.choice];
    const pick = id === 'delegation' ? (answer.choice === 'send' ? `${Math.round((p ?? 1) * 100)}%` : `${Math.round((1 - (p ?? 1)) * 100)}%`) : `${answer.choice}${p !== undefined ? ` ${Math.round(p * 100)}%` : ''}`;
    return `${label}${id === 'delegation' ? '' : ':'} ${pick}`;
  }
  return `${label} ${answer.score.toFixed(1)}${question?.type === 'score' ? ` of ${question.criteria.length - 1}` : ''}`;
}

function headline(insight: CompanionReflexInsight, status: string): string {
  const d = insight.lastDecision;
  if (insight.compiling) return 'Brain is rewriting the playbook…';
  if (insight.paused) return 'Paused';
  if (!d) return status === 'listening' ? 'Listening' : status;
  if (d.error) return 'Evaluation failed';
  if (d.stale) return 'Speech changed, re-checking';
  const action = d.action ?? 'wait';
  if (d.dryRun) return `Would ${action} (observe mode)`;
  if (d.suppressed) return `${ACTION_LABELS[action] ?? action} was held back`;
  if (action !== 'wait' && !d.applied) return `${ACTION_LABELS[action] ?? action}, not yet applied`;
  return ACTION_LABELS[action] ?? action;
}

function because(d: CompanionReflexDecision, table: ReflexTable): string[] {
  if (!d.answers) return [];
  const rule = table.rules.find(candidate => candidate.id === d.rule);
  const ids = rule?.when ? [...conditionQuestions(rule.when)].filter(id => !id.startsWith('fact:')) : Object.keys(table.questions);
  const ordered = ids.length ? ids : Object.keys(table.questions);
  return ordered.map(id => answerInWords(id, d.answers![id], table.questions[id])).filter((text): text is string => Boolean(text));
}

const muted = 'text-[var(--muted)]';

/** What the reflex agent just decided, why in words, what it sees, and the playbook folded away. */
export function CompanionAgentInsight({ insight, status, onResetTable }: { insight: CompanionReflexInsight | null; status: string; onResetTable?(): void }) {
  if (!insight) return <p className="px-4 py-3 text-sm">Start Jev voice to watch the agent think.</p>;
  const { table, lastDecision: d } = insight;
  const words = insight.pending ? insight.pending.trim().split(/\s+/).length : 0;
  const facts = insight.facts ? Object.entries(insight.facts).filter(([name, value]) => value && FACT_LABELS[name]).map(([name]) => FACT_LABELS[name]) : [];
  const sees = [
    `backend ${insight.backend.status}`,
    words ? `${words} unsent word${words === 1 ? '' : 's'}` : 'nothing unsent',
    insight.silenceMs >= 1_000 ? `silent ${Math.round(insight.silenceMs / 1000)} s` : null,
    ...facts,
  ].filter(Boolean);
  return <div className="space-y-2 px-4 py-3 text-sm">
    <p className="text-base font-medium leading-6">{headline(insight, status)}{d && !d.error && d.confidence !== undefined ? <span className={`ml-2 text-xs font-normal ${muted}`}>{Math.round(d.confidence * 100)}% sure · {d.durationMs} ms</span> : null}</p>
    {d?.error ? <p role="alert" className="text-xs">{d.error}</p> : null}
    {d && !d.error && !d.stale ? <p className="text-xs">Because {because(d, table).join(' · ') || 'no rule needed an answer'}{d.rule ? <span className={muted}> · rule {d.rule}</span> : null}{d.note ? ` · “${d.note}”` : ''}{d.suppressed ? ` · ${d.suppressed}` : ''}</p> : null}
    <p className={`text-xs ${muted}`}>Sees: {sees.join(' · ')}{insight.backend.lastReply ? ` · last reply “${insight.backend.lastReply.slice(0, 80)}${insight.backend.lastReply.length > 80 ? '…' : ''}”` : ''}</p>
    <p className={`text-xs ${muted}`}>{insight.decisions} decisions · {insight.delegations} sent · {insight.wakes.length} brain wakes · autonomy {insight.autonomy}{insight.autonomy === 'observe' ? ' (dry runs only)' : ''} · streak {insight.lowConfidenceTicks}/{table.wake.lowConfidenceTicks}</p>
    <details className="text-xs">
      <summary className="cursor-pointer">Playbook v{table.version} · {table.source === 'brain' ? 'written by the brain' : table.source === 'user' ? 'edited by you' : 'default'} · {table.rules.length} rules{table.notes ? ` · ${table.notes}` : ''}</summary>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5">{table.rules.map(rule => <li key={rule.id}><strong>{rule.do}</strong> when {condition(rule.when)}{rule.wake ? ' · wakes brain' : ''}</li>)}</ol>
      <p className={`mt-1 ${muted}`}>Wakes the brain after {table.wake.lowConfidenceTicks} unsure decisions in a row, at most every {Math.round(table.wake.cooldownMs / 60_000)} min.</p>
      <details className="mt-1"><summary className="cursor-pointer">Questions</summary>
        <ul className="mt-1 space-y-1">{Object.entries(table.questions).map(([id, question]) => <li key={id}><strong>{QUESTION_LABELS[id] ?? id}</strong> ({question.type}): {question.instructions.split('\n\n').pop()}
          {question.type === 'choice' ? <ul className="pl-4">{Object.entries(question.criteria).map(([option, text]) => <li key={option}><em>{option}</em>: {text}</li>)}</ul> : null}</li>)}</ul>
        {table.expectations ? <ul className="mt-1 space-y-1">{Object.entries(table.expectations).map(([id, expectation]) => <li key={id}><strong>expect {id}</strong>: {expectation.instructions}</li>)}</ul> : null}
      </details>
      {onResetTable && table.source !== 'default' ? <button type="button" onClick={onResetTable} className="mt-1 underline">Reset to default playbook</button> : null}
    </details>
    {insight.wakes.length ? <details className="text-xs"><summary className="cursor-pointer">Brain wakes ({insight.wakes.length})</summary>
      <ul className="mt-1 space-y-0.5">{insight.wakes.slice(-5).map((wake, index) => <li key={index}>{wake.reason} · {wake.disabled ? 'brain off, nothing changed' : wake.error ? `failed: ${wake.error}` : `playbook v${wake.table?.version}${wake.table?.notes ? `: ${wake.table.notes}` : ''} · ${Math.round(wake.durationMs / 1000)} s`}</li>)}</ul>
    </details> : null}
  </div>;
}
