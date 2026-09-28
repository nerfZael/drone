import { expect, test } from 'bun:test';
import { combineDetailedCards, costText, deriveDetailedCard, detailedCardWidthPx, durationText, type DetailedCardInput } from '../src/droneHub/canvas/detailed-card-model';

const base: DetailedCardInput = {
  busy: false, unread: false, approval: false, queued: false, statusOk: true, statusError: null, lastAgentSnippet: null,
};
const now = Date.parse('2026-09-28T12:00:00Z');
const ago = (ms: number) => new Date(now - ms).toISOString();

test('a working chat counts from its running execution, and a finished one says how long ago it worked', () => {
  const working = deriveDetailedCard({ ...base, busy: true, lastAgentSnippet: 'Added the parser',
    activity: { estimatedCost: 0.42, tokens: 120_000, unpriced: 0, runningSince: ago(192_000), lastEndedAt: ago(600_000) } }, now);
  expect(working).toMatchObject({ state: 'working', label: 'working', clock: '3m', cost: '$0.42', text: 'Added the parser' });
  const idle = deriveDetailedCard({ ...base, activity: { estimatedCost: 0, tokens: 3400, unpriced: 0, runningSince: null, lastEndedAt: ago(14 * 60_000) } }, now);
  // Tokens without a price show no cost, not a token count.
  expect(idle).toMatchObject({ state: 'done', label: 'done', clock: '14m ago', cost: '—', text: 'No replies yet' });
  expect(deriveDetailedCard(base, now)).toMatchObject({ state: 'idle', clock: '', cost: '—' });
});

test('work the usage records have not reported yet counts from when this client saw it start', () => {
  const card = deriveDetailedCard({ ...base, busy: true, busySeenAt: now - 5_000 }, now);
  expect(card).toMatchObject({ clock: '5s', text: 'Working on it…', cost: '—' });
});

test('approvals and failures need the user before anything else', () => {
  expect(deriveDetailedCard({ ...base, busy: true, approval: true }, now)).toMatchObject({ state: 'need', text: 'Waiting for your approval' });
  expect(deriveDetailedCard({ ...base, hubPhase: 'error', hubMessage: 'Container failed' }, now)).toMatchObject({ state: 'need', text: 'Container failed' });
  expect(deriveDetailedCard({ ...base, queued: true }, now)).toMatchObject({ state: 'queued' });
  expect(deriveDetailedCard({ ...base, unread: true, lastAgentSnippet: 'Done.' }, now)).toMatchObject({ state: 'done', label: 'done', unread: true });
});

test('a drone card takes its most urgent chat, its earliest running work and the total cost', () => {
  const a = { estimatedCost: 0.5, tokens: 10, unpriced: 0, runningSince: ago(60_000), lastEndedAt: null };
  const b = { estimatedCost: 1.25, tokens: 10, unpriced: 0, runningSince: null, lastEndedAt: ago(1000) };
  const cards = [deriveDetailedCard({ ...base, busy: true, activity: a }, now), deriveDetailedCard({ ...base, approval: true, activity: b }, now)];
  expect(combineDetailedCards(cards, [a, b], now, 2)).toMatchObject({
    state: 'need', clock: '1m', cost: '$1.75', text: 'Waiting for your approval · 2 chats · 1 needs you · 1 working',
  });
});

test('while it works, its steps say what it is doing, and the dots count them', () => {
  const steps = { turnId: 't1', done: ['Read the parser', 'Found the bug'], doing: ['Fixing the tokenizer'], next: ['Run tests'], final: false, updatedAt: ago(1000) };
  const working = deriveDetailedCard({ ...base, busy: true, lastAgentSnippet: 'Earlier reply', steps }, now);
  expect(working).toMatchObject({ text: 'Fixing the tokenizer', pips: { done: 2, doing: 1, next: 1 } });
  expect(working.stepsTitle).toBe('✓ Read the parser\n✓ Found the bug\n● Fixing the tokenizer\n○ Run tests');
  expect(deriveDetailedCard({ ...base, busy: true, steps: { ...steps, blocker: 'Tests need a database' } }, now).text).toBe('Blocked: Tests need a database');
  // Once the turn is done, the card shows its reply; the dots keep what it did.
  expect(deriveDetailedCard({ ...base, lastAgentSnippet: 'Fixed it.', steps: { ...steps, final: true } }, now)).toMatchObject({ text: 'Fixed it.', pips: { done: 2 } });
});

test('durations: seconds under a minute, minutes under an hour, then hours and minutes', () => {
  expect([30_000, 59_999, 60_000, 32 * 60_000 + 59_000, 2 * 3_600_000 + 25 * 60_000, 3 * 3_600_000, 27 * 3_600_000].map(durationText))
    .toEqual(['30s', '59s', '1m', '32m', '2h25m', '3h', '1d3h']);
  expect([0, 0.004, 0.42, 12.3].map((estimatedCost) => costText({ estimatedCost }))).toEqual(['—', '<$0.01', '$0.42', '$12']);
});

test('a chat that stopped without a final summary keeps only what was done', () => {
  const steps = { turnId: 't1', done: ['A', 'B', 'C'], doing: ['D'], next: ['E'], final: false, updatedAt: ago(60_000) };
  const card = deriveDetailedCard({ ...base, lastAgentSnippet: 'Finished.', steps }, now);
  expect(card).toMatchObject({ state: 'done', stepsStale: true, pips: { done: 3, doing: 0, next: 0 } });
  expect(deriveDetailedCard({ ...base, lastAgentSnippet: 'Finished.', steps: { ...steps, final: true } }, now).stepsStale).toBe(false);
});

test('each state takes the sidebar icon for it', () => {
  expect([
    deriveDetailedCard({ ...base, busy: true }, now).icon,
    deriveDetailedCard({ ...base, queued: true }, now).icon,
    deriveDetailedCard({ ...base, approval: true }, now).icon,
    deriveDetailedCard({ ...base, hubPhase: 'error' }, now).icon,
    deriveDetailedCard({ ...base, hubPhase: 'starting' }, now).icon,
    deriveDetailedCard({ ...base, unread: true }, now).icon,
  ]).toEqual(['working', 'queued', 'approval', 'blocked', 'starting', 'idle']);
});

test('a detailed card is as wide as its name or its footer, within limits', () => {
  const short = detailedCardWidthPx(40, { pips: 0, stateIcon: true, runtimeIcon: false });
  expect(short).toBe(140);
  // Five dots and the time and cost need more than a short name.
  expect(detailedCardWidthPx(40, { pips: 5, stateIcon: true, runtimeIcon: false })).toBe(5 * 9 + 10 + 84 + 26);
  expect(detailedCardWidthPx(160, { pips: 0, stateIcon: true, runtimeIcon: true })).toBe(Math.ceil(160 * 13 / 12.5) + 18 + 20 + 26);
  expect(detailedCardWidthPx(900, { pips: 0, stateIcon: true, runtimeIcon: false })).toBe(440);
  // A long drone name fits: 'Combined Plan to Assets Spec Analysis' is about 270px at 12.5px.
  expect(detailedCardWidthPx(270, { pips: 0, stateIcon: true, runtimeIcon: true })).toBeLessThan(440);
});
