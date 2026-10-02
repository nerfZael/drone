import { describe, expect, test } from 'bun:test';

import {
  buildNextActionsPrompt,
  createNextActionsService,
  DEFAULT_NEXT_ACTIONS_SETTINGS,
  nextActionsSettingsRevision,
  normalizeNextActionsSettings,
  normalizeNextActionsTurns,
  parseNextActionsSettingsInput,
  pickNextActions,
  type NextActionsSettings,
} from '../src/hub/next-actions/next-actions';

const enabled: NextActionsSettings = { ...DEFAULT_NEXT_ACTIONS_SETTINGS, enabled: true, actions: ['Commit', 'Review', 'Continue'] };
const request = { droneId: 'd1', chatName: 'chat-1', turnId: 't1', turns: [{ prompt: 'fix it', response: 'Fixed.' }] };

describe('next actions settings', () => {
  test('defaults to off with a supported model', () => {
    const settings = normalizeNextActionsSettings(undefined);
    expect(settings.enabled).toBe(false);
    expect(settings.actions.length).toBeGreaterThan(0);
    expect(parseNextActionsSettingsInput(settings)).toEqual(settings);
  });

  test('stored values with an unsupported model fall back to the default model', () => {
    const settings = normalizeNextActionsSettings({ enabled: true, provider: 'openai', model: 'nope', thinkingLevel: 'low', actions: ['A'] });
    expect(settings).toMatchObject({ enabled: true, provider: 'codex', model: 'gpt-6-luna', actions: ['A'] });
  });

  test('writes reject invalid selections and trim duplicate actions', () => {
    expect(() => parseNextActionsSettingsInput({ ...enabled, model: 'nope' })).toThrow('not supported');
    expect(() => parseNextActionsSettingsInput({ ...enabled, enabled: 'yes' })).toThrow('enabled');
    expect(parseNextActionsSettingsInput({ ...enabled, actions: [' Commit  now ', 'commit now', '', 'Review'] }).actions)
      .toEqual(['Commit now', 'Review']);
  });

  test('revision ignores the on/off switch but tracks everything else', () => {
    const base = nextActionsSettingsRevision(enabled);
    expect(nextActionsSettingsRevision({ ...enabled, enabled: false })).toBe(base);
    expect(nextActionsSettingsRevision({ ...enabled, actions: ['Commit'] })).not.toBe(base);
    expect(nextActionsSettingsRevision({ ...enabled, instructions: 'x' })).not.toBe(base);
  });
});

describe('next actions prompt', () => {
  test('keeps the most recent turns and clips long responses from the middle', () => {
    const turns = normalizeNextActionsTurns([
      ...Array.from({ length: 8 }, (_, index) => ({ prompt: `p${index}`, response: `r${index}` })),
      { prompt: 'last', response: `start ${'x'.repeat(20_000)} end` },
    ]);
    expect(turns).toHaveLength(6);
    expect(turns[0]?.prompt).toBe('p3');
    expect(turns.at(-1)?.response).toStartWith('start');
    expect(turns.at(-1)?.response).toEndWith('end');
    expect(turns.at(-1)?.response).toContain('[truncated]');
  });

  test('numbers the configured replies', () => {
    const prompt = buildNextActionsPrompt(['Commit', 'Review'], [{ prompt: 'go', response: 'done' }]);
    expect(prompt).toContain('1. Commit\n2. Review');
    expect(prompt).toContain('<agent>\ndone\n</agent>');
  });

  test('maps picks to actions, dropping invalid and repeated numbers', () => {
    expect(pickNextActions(['Commit', 'Review', 'Continue'], [3, 1, 3, 0, 9, '2', 'x'])).toEqual(['Continue', 'Commit', 'Review']);
    expect(pickNextActions(['Commit'], undefined)).toEqual([]);
  });
});

describe('next actions service', () => {
  test('shares one call per turn and settings revision', async () => {
    let calls = 0;
    let settings = enabled;
    const service = createNextActionsService({
      readSettings: async () => settings,
      resolveApiKey: async () => 'key',
      suggest: async (current) => { calls += 1; return [current.actions[0]!]; },
    });
    const [first, second] = await Promise.all([service(request), service(request)]);
    expect(first.actions).toEqual(['Commit']);
    expect(second).toEqual(first);
    await service(request);
    expect(calls).toBe(1);
    await service({ ...request, turnId: 't2' });
    expect(calls).toBe(2);
    settings = { ...enabled, actions: ['Ship it'] };
    expect((await service(request)).actions).toEqual(['Ship it']);
    expect(calls).toBe(3);
  });

  test('refuses when off or without credentials, and does not cache failures', async () => {
    let settings: NextActionsSettings = { ...enabled, enabled: false };
    let apiKey: string | null = null;
    let calls = 0;
    const service = createNextActionsService({
      readSettings: async () => settings,
      resolveApiKey: async () => apiKey,
      suggest: async () => { calls += 1; if (calls === 1) throw new Error('boom'); return ['Commit']; },
    });
    await expect(service(request)).rejects.toMatchObject({ status: 409 });
    settings = enabled;
    await expect(service(request)).rejects.toMatchObject({ status: 412 });
    apiKey = 'key';
    await expect(service(request)).rejects.toThrow('boom');
    expect((await service(request)).actions).toEqual(['Commit']);
  });
});
