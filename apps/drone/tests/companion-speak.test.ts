import { expect, test } from 'bun:test';
import { CompanionRuntime } from '../src/hub/companion/companion-runtime';
import { DEFAULT_COMPANION_SETTINGS } from '../src/hub/companion/companion-config';
import { upsertStoredSpeechSettings } from '../src/hub/hub-settings';
import { withTempDroneDataDir } from './test-helpers';

test('Companion exposes speak through its real MCP provider and respects both tool and speech settings', async () => {
  await withTempDroneDataDir('companion-speak-', async () => {
    const previousFetch = globalThis.fetch;
    const previousUrl = process.env.DRONE_HUB_BASE_URL;
    const previousToken = process.env.DRONE_TOKEN;
    process.env.DRONE_HUB_BASE_URL = 'http://companion-speech.test';
    process.env.DRONE_TOKEN = 'test';
    const requests: unknown[] = [];
    let status = 'queued';
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url === 'http://companion-speech.test/api/settings/speech') {
        expect(init?.method).toBe('GET');
        return Response.json({
          ok: true,
          speech: { muted: status === 'muted', model: 'tts-1', voice: 'alloy' },
        });
      }
      expect(url).toBe('http://companion-speech.test/api/audio/speech');
      expect(init?.method).toBe('POST');
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true, jobId: 'speech-job', status }, { status: 202 });
    }) as typeof fetch;
    const runtime = new CompanionRuntime({ hubServices: {} as any, buildDroneSummaries: () => [] });
    const configurations: any[] = [];
    const context = { runId: 'speech-test', settings: { ...DEFAULT_COMPANION_SETTINGS, enabledTools: ['speak'] } };
    (runtime as any).contexts.set('companion:speech-test', context);
    // Exercise the restricted Companion principal used by connected sessions.
    (runtime as any).subscriptionSessions.set('speech-test', {});
    const load = async () => {
      const config = await (runtime as any).configuration('companion:speech-test');
      configurations.push(config);
      return await config.toolProviders[0].load({ session: { id: 'speech-test' } });
    };
    try {
      await upsertStoredSpeechSettings({ enabled: true });
      const tools = await load();
      expect(tools.map((tool: any) => tool.name)).toEqual(['speak']);
      const speech = tools[0];
      const result = await speech.execute('say', { text: 'Your screenshot is attached.', voice: 'hannah' });
      expect(result.details).toMatchObject({ ok: true, status: 'queued' });
      expect(requests).toEqual([{ text: 'Your screenshot is attached.', voice: 'hannah' }]);
      status = 'muted';
      expect((await speech.execute('muted', { text: 'Ready.' })).details).toMatchObject({
        ok: true,
        status: 'muted',
        model: 'tts-1',
        voice: 'alloy',
      });
      await expect(speech.execute('oversized', { text: 'x'.repeat(4097) })).rejects.toThrow('Input validation error');
      expect(requests).toHaveLength(1);
      context.settings.enabledTools = [];
      expect(await load()).toEqual([]);
      context.settings.enabledTools = ['speak'];
      await upsertStoredSpeechSettings({ enabled: false });
      expect(await load()).toEqual([]);
    } finally {
      for (const config of configurations) await config.dispose();
      (runtime as any).subscriptionSessions.delete('speech-test');
      await runtime.close();
      globalThis.fetch = previousFetch;
      if (previousUrl === undefined) delete process.env.DRONE_HUB_BASE_URL; else process.env.DRONE_HUB_BASE_URL = previousUrl;
      if (previousToken === undefined) delete process.env.DRONE_TOKEN; else process.env.DRONE_TOKEN = previousToken;
    }
  });
});
