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

const action = (name: string, text = name) => ({ name, text });
const enabled: NextActionsSettings = { ...DEFAULT_NEXT_ACTIONS_SETTINGS, enabled: true, actions: [action('Commit'), action('Review'), action('Continue')] };
const request = { droneId: 'd1', chatName: 'chat-1', turnId: 't1', turns: [{ prompt: 'fix it', response: 'Fixed.' }] };

describe('next actions settings', () => {
  test('defaults to off with a supported model', () => {
    const settings = normalizeNextActionsSettings(undefined);
    expect(settings.enabled).toBe(false);
    expect(settings.actions.length).toBeGreaterThan(0);
    expect(parseNextActionsSettingsInput(settings)).toEqual(settings);
  });

  test('stored values with an unsupported model fall back to the default model', () => {
    const settings = normalizeNextActionsSettings({ enabled: true, provider: 'openai', model: 'nope', thinkingLevel: 'low', actions: [action('A')] });
    expect(settings).toMatchObject({ enabled: true, provider: 'codex', model: 'gpt-6-luna', actions: [action('A')] });
  });

  test('actions stored as plain lines become a name and text', () => {
    expect(normalizeNextActionsSettings({ actions: ['Commit the changes'] }).actions).toEqual([action('Commit the changes')]);
    expect(normalizeNextActionsSettings({ actions: [{ name: '', text: 'Run every test in the repository and report failures in detail' }] }).actions[0]!.name)
      .toBe('Run every test in the repository and re…');
    expect(normalizeNextActionsSettings({ actions: [{ name: 'Ship', text: '' }, { name: '', text: '' }] }).actions).toEqual([action('Ship')]);
  });

  test('writes reject invalid selections and trim duplicate actions', () => {
    expect(() => parseNextActionsSettingsInput({ ...enabled, model: 'nope' })).toThrow('not supported');
    expect(() => parseNextActionsSettingsInput({ ...enabled, enabled: 'yes' })).toThrow('enabled');
    expect(() => parseNextActionsSettingsInput({ ...enabled, actions: ['Commit'] })).toThrow('{ name, text }');
    expect(() => parseNextActionsSettingsInput({ ...enabled, actions: [action('x'.repeat(41), 'y')] })).toThrow('name');
    expect(parseNextActionsSettingsInput({
      ...enabled,
      actions: [{ name: ' Commit  now ', text: 'Commit the changes\nwith a good message' }, action('commit now', 'commit the changes\nWITH a good message'), action(''), action('Review')],
    }).actions).toEqual([{ name: 'Commit now', text: 'Commit the changes\nwith a good message' }, action('Review')]);
  });

  test('revision ignores the on/off switch but tracks everything else', () => {
    const base = nextActionsSettingsRevision(enabled);
    expect(nextActionsSettingsRevision({ ...enabled, enabled: false })).toBe(base);
    expect(nextActionsSettingsRevision({ ...enabled, actions: [action('Commit')] })).not.toBe(base);
    expect(nextActionsSettingsRevision({ ...enabled, actions: [action('Commit', 'Commit now'), action('Review'), action('Continue')] })).not.toBe(base);
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

  test('numbers the configured replies, naming those whose text differs', () => {
    const prompt = buildNextActionsPrompt([action('Commit', 'Commit the changes'), action('Review')], [{ prompt: 'go', response: 'done' }]);
    expect(prompt).toContain('1. Commit: Commit the changes\n2. Review');
    expect(prompt).toContain('<agent>\ndone\n</agent>');
  });

  test('maps picks to actions, dropping invalid and repeated numbers', () => {
    expect(pickNextActions(enabled.actions, [3, 1, 3, 0, 9, '2', 'x'])).toEqual([action('Continue'), action('Commit'), action('Review')]);
    expect(pickNextActions(enabled.actions, undefined)).toEqual([]);
  });
});

describe('next actions service', () => {
  test('shares one call per turn and settings revision', async () => {
    let calls = 0;
    let settings = enabled;
    const service = createNextActionsService({
      readSettings: async () => settings,
      resolveApiKey: async () => 'key',
      suggest: async (current, _turns, _key, chat) => { calls += 1; seenChat = chat; return [current.actions[0]!]; },
      cost: (chatId) => ({ cost: chatId === 'c1' ? 0.02 : 0, calls: calls, unpriced: 0 }),
    });
    let seenChat: unknown;
    const [first, second] = await Promise.all([service({ ...request, chatId: 'c1' }), service({ ...request, chatId: 'c1' })]);
    expect(first.actions).toEqual([action('Commit')]);
    expect(first.cost).toEqual({ cost: 0.02, calls: 1, unpriced: 0 });
    expect(seenChat).toEqual({ droneId: 'd1', chatName: 'chat-1', chatId: 'c1' });
    expect((await service(request)).cost).toBeNull();
    expect(second).toEqual(first);
    expect(calls).toBe(1);
    await service({ ...request, turnId: 't2' });
    expect(calls).toBe(2);
    settings = { ...enabled, actions: [action('Ship', 'Ship it')] };
    expect((await service(request)).actions).toEqual([action('Ship', 'Ship it')]);
    expect(calls).toBe(3);
  });

  test('refuses when off or without credentials, and does not cache failures', async () => {
    let settings: NextActionsSettings = { ...enabled, enabled: false };
    let apiKey: string | null = null;
    let calls = 0;
    const service = createNextActionsService({
      readSettings: async () => settings,
      resolveApiKey: async () => apiKey,
      suggest: async () => { calls += 1; if (calls === 1) throw new Error('boom'); return [action('Commit')]; },
    });
    await expect(service(request)).rejects.toMatchObject({ status: 409 });
    settings = enabled;
    await expect(service(request)).rejects.toMatchObject({ status: 412 });
    apiKey = 'key';
    await expect(service(request)).rejects.toThrow('boom');
    expect((await service(request)).actions).toEqual([action('Commit')]);
  });
});
