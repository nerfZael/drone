import { describe, expect, test } from 'bun:test';

import { __openAiRealtimeAssistantTestInternals } from '../src/hub/openai-realtime-assistant';

describe('openai realtime assistant', () => {
  test('upsamples desktop voice PCM from 16 kHz to the realtime input rate', () => {
    const source = Buffer.alloc(4 * 2);
    source.writeInt16LE(0, 0);
    source.writeInt16LE(1000, 2);
    source.writeInt16LE(2000, 4);
    source.writeInt16LE(3000, 6);

    const output = __openAiRealtimeAssistantTestInternals.desktopPcmToRealtimePcm(source);

    expect(__openAiRealtimeAssistantTestInternals.DESKTOP_VOICE_INPUT_SAMPLE_RATE).toBe(16_000);
    expect(__openAiRealtimeAssistantTestInternals.OPENAI_REALTIME_INPUT_SAMPLE_RATE).toBe(24_000);
    expect(output.byteLength).toBe(6 * 2);
    expect(output.readInt16LE(0)).toBe(0);
    expect(output.readInt16LE(2)).toBeGreaterThan(0);
    expect(output.readInt16LE(output.byteLength - 2)).toBe(3000);
  });

  test('uses semantic VAD with response interruption for spoken conversations', () => {
    expect(__openAiRealtimeAssistantTestInternals.realtimeTurnDetection()).toEqual({
      type: 'semantic_vad',
      eagerness: 'low',
      create_response: true,
      interrupt_response: true,
    });
  });

  test('parses a WebRTC call id from the calls Location header', () => {
    expect(__openAiRealtimeAssistantTestInternals.realtimeCallIdFromLocation('/v1/realtime/calls/rtc_123456')).toBe('rtc_123456');
    expect(__openAiRealtimeAssistantTestInternals.realtimeCallIdFromLocation('https://api.openai.com/v1/realtime/calls/rtc_abcdef?source=test')).toBe('rtc_abcdef');
    expect(__openAiRealtimeAssistantTestInternals.realtimeCallIdFromLocation('')).toBe('');
  });

  test('builds WebRTC session config without PCM transport formats', () => {
    const config = __openAiRealtimeAssistantTestInternals.realtimeSessionConfig({
      env: {},
      instructions: 'hello',
      tools: [],
      pcmTransport: false,
    }) as any;

    expect(config.model).toBe('gpt-realtime-2');
    expect(config.instructions).toBe('hello');
    expect(config.audio.input.format).toBeUndefined();
    expect(config.audio.output.format).toBeUndefined();
    expect(config.audio.input.transcription).toEqual({
      model: 'gpt-realtime-whisper',
      delay: 'high',
    });
    expect(config.audio.input.turn_detection).toEqual({
      type: 'semantic_vad',
      eagerness: 'low',
      create_response: true,
      interrupt_response: true,
    });
  });

  test('creates WebRTC calls with unified multipart SDP and session config', async () => {
    const requests: any[] = [];
    const fetchImpl = async (input: string, init: any) => {
      requests.push({ input, init });
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: (name: string) => name.toLowerCase() === 'location' ? '/v1/realtime/calls/rtc_test' : null },
        text: async () => 'v=0\r\nanswer',
      };
    };

    const result = await __openAiRealtimeAssistantTestInternals.createOpenAiRealtimeWebRtcCall({
      apiKey: 'sk-test',
      sdpOffer: 'v=0\r\noffer\r\n',
      fetchImpl,
    }, {
      type: 'realtime',
      model: 'gpt-realtime-2',
    });

    expect(result).toEqual({ callId: 'rtc_test', sdpAnswer: 'v=0\r\nanswer' });
    expect(requests).toHaveLength(1);
    expect(requests[0].input).toBe('https://api.openai.com/v1/realtime/calls');
    expect(requests[0].init.headers.authorization).toBe('Bearer sk-test');
    expect(requests[0].init.body.get('sdp')).toBe('v=0\r\noffer\r\n');
    expect(JSON.parse(requests[0].init.body.get('session'))).toEqual({
      type: 'realtime',
      model: 'gpt-realtime-2',
    });
  });

  test('requests one follow-up response after handling multiple realtime tool calls', async () => {
    const sent: unknown[] = [];
    let responseRequests = 0;
    const seenNames: string[] = [];
    const handler = __openAiRealtimeAssistantTestInternals.createRealtimeFunctionCallHandler({
      callbacks: {},
      send: (payload: unknown) => sent.push(payload),
      requestAudioResponse: () => {
        responseRequests += 1;
      },
      executeTool: async (call: any) => {
        seenNames.push(call.name);
        return JSON.stringify({ ok: true, name: call.name });
      },
    });

    await handler([
      { id: 'item_1', callId: 'call_1', name: 'first_tool', argumentsJson: '{}' },
      { id: 'item_2', callId: 'call_2', name: 'second_tool', argumentsJson: '{}' },
    ]);

    expect(seenNames).toEqual(['first_tool', 'second_tool']);
    expect(sent).toHaveLength(2);
    expect(responseRequests).toBe(1);
  });
});
