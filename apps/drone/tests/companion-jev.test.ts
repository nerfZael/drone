import { expect, test } from 'bun:test';
import { RetryError } from 'ai-evaluation';
import { evaluateCompanionSpeech, evaluateCompanionSpeechDetailed, jevEvaluationError, parseJevInput, parseJevReplay } from '../src/hub/companion/companion-jev';
import { readCompanionLiveSettings, writeCompanionLiveSettings } from '../src/hub/companion/companion-live-settings';
import { upsertStoredProviderApiKey, resolveAiGatewayApiKeySettings, clearStoredProviderApiKey } from '../src/hub/hub-settings';
import { withTempDroneDataDir } from './test-helpers';
import { HubRouter } from '../src/hub/hub-router';
import { registerCompanionRoutes } from '../src/hub/companion/companion-routes';
import { registerSettingsRoutes } from '../src/hub/routes/settings-routes';

test('Jev instructions and mode persist independently of GPT-Live instructions', async () => {
  await withTempDroneDataDir('jev-settings-', async () => {
    await writeCompanionLiveSettings({ enabled: true, mode: 'jev', jevSystemPrompt: 'Send only explicit requests.', systemPrompt: 'Speak briefly.' });
    await writeCompanionLiveSettings({ enabled: false });
    expect(await readCompanionLiveSettings()).toMatchObject({ enabled: false, mode: 'jev', jevSystemPrompt: 'Send only explicit requests.', systemPrompt: 'Speak briefly.' });
    await expect(writeCompanionLiveSettings({ mode: 'invalid' })).rejects.toThrow();
    await expect(writeCompanionLiveSettings({ jevSystemPrompt: '' })).rejects.toThrow();
    await expect(writeCompanionLiveSettings({ jevSystemPrompt: 'x'.repeat(8001) })).rejects.toThrow();
  });
});

test('Gateway credentials use their own saved setting', async () => {
  await withTempDroneDataDir('gateway-settings-', async () => {
    await upsertStoredProviderApiKey('ai-gateway', 'test-only-gateway-key');
    expect(await resolveAiGatewayApiKeySettings()).toMatchObject({ source: 'settings', apiKey: 'test-only-gateway-key' });
    await clearStoredProviderApiKey('ai-gateway');
  });
});

test('Jev endpoint bounds transcript and context input', () => {
  expect(parseJevInput({ transcript: ' Open settings ' })).toEqual({ transcript: 'Open settings', context: '' });
  for (const value of [null, {}, { transcript: '' }, { transcript: 'a'.repeat(120001) }, { transcript: 'a', context: 'b'.repeat(16001) }]) {
    expect(() => parseJevInput(value)).toThrow();
  }
  expect(parseJevInput({ transcript: 'Wait', silenceMs: 1250 }).silenceMs).toBe(1250);
  for (const silenceMs of [-1, NaN, Infinity, 0.5, '1000', null]) {
    expect(() => parseJevInput({ transcript: 'Wait', silenceMs })).toThrow();
  }
});

test('Gateway settings never reveal a saved credential, including reveal requests', async () => {
  await withTempDroneDataDir('gateway-routes-', async () => {
    let body: unknown;
    let result: any;
    const router = new HubRouter((_res, status, value) => { result = { status, body: value }; }, async () => body);
    registerSettingsRoutes(router, {
      upsertStoredProviderApiKey, clearStoredProviderApiKey,
      normalizeApiKey: (value: unknown) => typeof value === 'string' ? value.trim() : '',
    } as any);
    for (const method of ['POST', 'GET', 'DELETE']) {
      body = { apiKey: 'test-only-gateway-key' };
      await router.handle({ method } as any, {} as any, new URL('http://hub.test/api/settings/ai-gateway?reveal=1'));
      expect(result.status).toBe(200);
      expect(result.body.apiKey).toBeUndefined();
      expect(result.body.keyHint).toBeNull();
      expect(JSON.stringify(result)).not.toContain('test-only-gateway-key');
      if (method !== 'DELETE') expect(result.body.hasKey).toBe(true);
    }
  });
});

test('SDK evaluation uses Jev and saved instructions; provider failures expose no raw details', async () => {
  await withTempDroneDataDir('jev-sdk-', async () => {
    await writeCompanionLiveSettings({ enabled: true, mode: 'jev', jevSystemPrompt: 'Send only explicit requests.' });
    await upsertStoredProviderApiKey('ai-gateway', 'test-only-gateway-key');
    const previousFetch = globalThis.fetch;
    let fail = 0;
    const requests: Array<{ model: string | null; body: unknown }> = [];
    globalThis.fetch = (async (_url, init) => {
      requests.push({ model: new Headers(init?.headers).get('ai-model-id'), body: JSON.parse(String(init?.body)) });
      return fail
        ? Response.json({ error: { type: fail === 429 ? 'rate_limit_exceeded' : 'authentication_error', message: fail === 429 ? 'Gateway credits limit test-only-gateway-key' : 'test-only-gateway-key' } }, { status: fail, headers: { 'retry-after-ms': '1' } })
        : Response.json({ answers: { delegation: { type: 'choice', choice: 'send' } } });
    }) as typeof fetch;
    try {
      expect(await evaluateCompanionSpeech({ transcript: 'Open settings', context: '', silenceMs: 1250 })).toBe('send');
      expect(requests[0].model).toBe('typesafe-ai/jev');
      expect(JSON.stringify(requests[0].body)).toContain('Send only explicit requests.');
      expect(JSON.stringify(requests[0].body)).toContain('Open settings');
      const state = JSON.parse((requests[0].body as { state: string }).state);
      expect(state.unsentTranscript).toBe('Open settings');
      expect(state.timing).toEqual({ silenceMs: 1250 });
      fail = 401;
      await expect(evaluateCompanionSpeech({ transcript: 'Open settings', context: '' })).rejects.toThrow('AI Gateway rejected authentication.');
      expect(requests).toHaveLength(2); // Authentication failures do not retry.
      fail = 429;
      await expect(evaluateCompanionSpeech({ transcript: 'Open settings', context: '' })).rejects.toThrow('AI Gateway reported a credits or quota limit.');
      expect(requests).toHaveLength(5); // Initial attempt plus two retries, then stop.
    } finally { globalThis.fetch = previousFetch; }
  });
});

test('temporary Gateway failure recovers with the same transcript and context', async () => {
  await withTempDroneDataDir('jev-retry-', async () => {
    await writeCompanionLiveSettings({ enabled: true, mode: 'jev' });
    await upsertStoredProviderApiKey('ai-gateway', 'test-only-gateway-key');
    const previousFetch = globalThis.fetch;
    const bodies: string[] = [];
    globalThis.fetch = (async (_url, init) => {
      bodies.push(String(init?.body));
      return bodies.length === 1
        ? Response.json({ error: { type: 'internal_server_error', message: 'test-only-gateway-key' } }, { status: 503, headers: { 'retry-after-ms': '1' } })
        : Response.json({ answers: { delegation: { type: 'choice', choice: 'send' } } });
    }) as typeof fetch;
    try {
      expect(await evaluateCompanionSpeech({ transcript: 'Open settings', context: 'Earlier speech' })).toBe('send');
      expect(bodies).toHaveLength(2);
      expect(bodies[0]).toBe(bodies[1]);
      expect(bodies[1]).toContain('Earlier speech');
    } finally { globalThis.fetch = previousFetch; }
  });
});

test('Jev errors distinguish limits, configuration, and timeouts without echoing secrets', () => {
  expect(jevEvaluationError(new RetryError({ message: 'test-secret', reason: 'maxRetriesExceeded', errors: [{ statusCode: 429 }] }))).toContain('rate limiting');
  const cases = [
    [{ statusCode: 429, message: 'credits test-secret' }, 'credits or quota limit'],
    [{ statusCode: 429, message: 'Too many requests test-secret' }, 'rate limiting'],
    [{ statusCode: 401 }, 'rejected authentication'],
    [{ statusCode: 403 }, 'denied this request'],
    [{ statusCode: 400 }, 'request configuration'],
    [{ name: 'TimeoutError' }, 'timed out'],
    [{ statusCode: 503 }, 'could not complete'],
    [{ message: 'test-secret' }, 'Gateway request failed'],
  ] as const;
  for (const [error, expected] of cases) {
    const result = jevEvaluationError(error);
    expect(result).toContain(expected);
    expect(result).toContain('transcript is retained');
    expect(result).not.toContain('test-secret');
  }
});


test('debug snapshots match the SDK request and replay edits never change saved settings', async () => {
  await withTempDroneDataDir('jev-replay-', async () => {
    await writeCompanionLiveSettings({ enabled: true, mode: 'jev', jevSystemPrompt: 'Wait for 1000 ms.' });
    await upsertStoredProviderApiKey('ai-gateway', 'test-only-gateway-key');
    const previousFetch = globalThis.fetch;
    const requests: any[] = [];
    globalThis.fetch = (async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({ answers: { delegation: { type: 'choice', choice: 'send', probabilities: { send: 0.9, wait: 0.1 } } } });
    }) as typeof fetch;
    try {
      const original = await evaluateCompanionSpeechDetailed({ transcript: 'Hello', context: 'Previous words', silenceMs: 40 });
      expect(original.request.state).toBe(requests[0].state);
      expect(original.request.instructions).toBe(requests[0].questions.delegation.instructions);
      expect(original.request.criteria).toEqual(requests[0].questions.delegation.criteria);
      expect(original.probabilities).toEqual({ send: 0.9, wait: 0.1 });
      expect(JSON.stringify(original)).not.toContain('test-only-gateway-key');
      const edited = { ...original.request, state: JSON.stringify({ unsentTranscript: 'Edited', timing: { silenceMs: 5000 } }), instructions: 'Wait for 5000 ms.' };
      let result: any;
      const router = new HubRouter((_res, status, body) => { result = { status, body }; }, async () => edited);
      registerCompanionRoutes(router);
      // Replays remain usable after voice is stopped and have no Companion runtime.
      await writeCompanionLiveSettings({ enabled: false });
      await router.handle({ method: 'POST' } as any, {} as any, new URL('http://hub.test/api/companion/jev/replay'));
      expect(result.status).toBe(200);
      expect(result.body.decision).toBe('send');
      expect(requests[1].state).toBe(edited.state);
      expect(requests[1].questions.delegation.instructions).toBe(edited.instructions);
      expect((await readCompanionLiveSettings()).jevSystemPrompt).toBe('Wait for 1000 ms.');
      expect(JSON.stringify(result)).not.toContain('test-only-gateway-key');
      expect(() => parseJevReplay({ ...edited, model: 'other/model' })).toThrow();
      expect(() => parseJevReplay({ ...edited, instructions: 'a'.repeat(16001) })).toThrow();
      expect(parseJevReplay({ ...edited, apiKey: 'injected', baseURL: 'https://invalid.test' })).toEqual(edited);
    } finally { globalThis.fetch = previousFetch; }
  });
});
