import crypto from 'node:crypto';

import WebSocket from 'ws';

import { pcm16leToWav } from './voice-transcription-segmenter';

const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime';
const OPENAI_REALTIME_INPUT_SAMPLE_RATE = 16_000;
const OPENAI_REALTIME_OUTPUT_SAMPLE_RATE = 24_000;

export type OpenAiRealtimeAssistantCallbacks = {
  onUserTranscript?: (text: string) => void | Promise<void>;
  onAssistantTranscript?: (text: string) => void | Promise<void>;
  onAssistantAudio?: (audio: { wav: Buffer; text: string }) => void | Promise<void>;
  onStatus?: (message: string) => void | Promise<void>;
  onError?: (message: string) => void | Promise<void>;
  onClose?: () => void | Promise<void>;
};

export type OpenAiRealtimeAssistantSession = {
  appendPcm: (pcm: Buffer) => void;
  stop: () => Promise<void>;
  cancel: () => Promise<void>;
};

export type OpenAiRealtimeAssistantOptions = {
  apiKey: string;
  model?: string;
  voice?: string;
  instructions?: string;
  callbacks?: OpenAiRealtimeAssistantCallbacks;
  env?: NodeJS.ProcessEnv;
};

function truthyEnv(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function isOpenAiRealtimeAssistantEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return truthyEnv(env.DRONE_DESKTOP_VOICE_REALTIME) || truthyEnv(env.DRONE_HUB_REALTIME_ASSISTANT);
}

function realtimeModel(env: NodeJS.ProcessEnv): string {
  return String(env.DRONE_HUB_OPENAI_REALTIME_MODEL ?? env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime-2').trim() || 'gpt-realtime-2';
}

function realtimeVoice(env: NodeJS.ProcessEnv): string {
  return String(env.DRONE_HUB_OPENAI_REALTIME_VOICE ?? env.OPENAI_REALTIME_VOICE ?? 'alloy').trim() || 'alloy';
}

function realtimeTranscriptionModel(env: NodeJS.ProcessEnv): string {
  return String(env.DRONE_HUB_OPENAI_REALTIME_TRANSCRIPTION_MODEL ?? env.OPENAI_REALTIME_TRANSCRIPTION_MODEL ?? 'gpt-realtime-whisper').trim() || 'gpt-realtime-whisper';
}

function safetyIdentifier(): string {
  const seed = `${process.env.USER ?? ''}:${process.cwd()}`;
  return `drone-hub-${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 32)}`;
}

function cleanText(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

function emit(callback: (() => void | Promise<void>) | undefined): void {
  if (!callback) return;
  void Promise.resolve(callback()).catch(() => {});
}

function emitWith<T>(callback: ((value: T) => void | Promise<void>) | undefined, value: T): void {
  if (!callback) return;
  void Promise.resolve(callback(value)).catch(() => {});
}

export async function createOpenAiRealtimeAssistantSession(opts: OpenAiRealtimeAssistantOptions): Promise<OpenAiRealtimeAssistantSession> {
  const env = opts.env ?? process.env;
  const apiKey = String(opts.apiKey ?? '').trim();
  if (!apiKey) throw new Error('OpenAI API key is not configured. Add it in Drone Hub settings.');

  const model = opts.model?.trim() || realtimeModel(env);
  const voice = opts.voice?.trim() || realtimeVoice(env);
  const callbacks = opts.callbacks ?? {};
  const upstream = new WebSocket(`${OPENAI_REALTIME_URL}?model=${encodeURIComponent(model)}`, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      'openai-safety-identifier': safetyIdentifier(),
    },
  });
  let closed = false;
  let ready = false;
  let inputTranscript = '';
  let outputTranscript = '';
  let responseAudio: Buffer[] = [];
  let responseAudioBytes = 0;
  let lastAssistantText = '';
  const pendingAudio: Buffer[] = [];

  const send = (payload: unknown): void => {
    if (closed || upstream.readyState !== WebSocket.OPEN) return;
    upstream.send(JSON.stringify(payload));
  };

  const flushPendingAudio = (): void => {
    if (!ready) return;
    while (pendingAudio.length > 0) {
      const pcm = pendingAudio.shift()!;
      send({ type: 'input_audio_buffer.append', audio: pcm.toString('base64') });
    }
  };

  const finishResponseAudio = (): void => {
    if (responseAudioBytes <= 0) return;
    const pcm = Buffer.concat(responseAudio, responseAudioBytes);
    responseAudio = [];
    responseAudioBytes = 0;
    emitWith(callbacks.onAssistantAudio, {
      wav: pcm16leToWav(pcm, OPENAI_REALTIME_OUTPUT_SAMPLE_RATE, 1),
      text: lastAssistantText,
    });
  };

  const session = await new Promise<OpenAiRealtimeAssistantSession>((resolve, reject) => {
    let settled = false;
    const startupTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      closed = true;
      upstream.close();
      reject(new Error('OpenAI Realtime connection timed out.'));
    }, 12_000);
    startupTimer.unref?.();

    const settleReady = () => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimer);
      resolve({
        appendPcm: (pcm: Buffer) => {
          if (closed || pcm.byteLength <= 0) return;
          if (!ready) {
            pendingAudio.push(Buffer.from(pcm));
            return;
          }
          send({ type: 'input_audio_buffer.append', audio: pcm.toString('base64') });
        },
        stop: async () => {
          if (closed) return;
          send({ type: 'input_audio_buffer.commit' });
          send({ type: 'response.create', response: { output_modalities: ['audio'] } });
          await new Promise<void>((done) => setTimeout(done, 250));
        },
        cancel: async () => {
          if (closed) return;
          closed = true;
          upstream.close(1000, 'cancelled');
        },
      });
    };

    upstream.on('open', () => {
      ready = true;
      send({
        type: 'session.update',
        session: {
          type: 'realtime',
          model,
          instructions: opts.instructions ?? 'You are Sebastian, the Drone Hub desktop voice assistant. Keep spoken replies brief and useful.',
          output_modalities: ['audio'],
          audio: {
            input: {
              format: {
                type: 'audio/pcm',
                rate: OPENAI_REALTIME_INPUT_SAMPLE_RATE,
              },
              transcription: {
                model: realtimeTranscriptionModel(env),
              },
              turn_detection: {
                type: 'server_vad',
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 500,
                create_response: true,
              },
            },
            output: {
              format: {
                type: 'audio/pcm',
                rate: OPENAI_REALTIME_OUTPUT_SAMPLE_RATE,
              },
              voice,
            },
          },
        },
      });
      flushPendingAudio();
      emitWith(callbacks.onStatus, 'Realtime assistant is listening.');
      settleReady();
    });

    upstream.on('message', (data) => {
      let event: any = null;
      try {
        event = JSON.parse(String(data));
      } catch {
        return;
      }
      const type = String(event?.type ?? '');
      if (type === 'error' || type.endsWith('_error') || event?.error?.message) {
        const message = cleanText(event?.error?.message ?? event?.message) || 'OpenAI Realtime failed.';
        emitWith(callbacks.onError, message);
        if (!closed) {
          closed = true;
          upstream.close(1000, 'OpenAI Realtime error');
        }
        if (!settled) {
          settled = true;
          clearTimeout(startupTimer);
          reject(new Error(message));
        }
        return;
      }
      if (type === 'conversation.item.input_audio_transcription.delta') {
        inputTranscript += String(event.delta ?? '');
        return;
      }
      if (type === 'conversation.item.input_audio_transcription.completed' || type === 'conversation.item.input_audio_transcription.done') {
        const transcript = cleanText(event.transcript ?? inputTranscript);
        inputTranscript = '';
        if (transcript) emitWith(callbacks.onUserTranscript, transcript);
        return;
      }
      if (type === 'response.output_audio.delta' || type === 'response.audio.delta') {
        const delta = String(event.delta ?? '');
        if (delta) {
          const pcm = Buffer.from(delta, 'base64');
          responseAudio.push(pcm);
          responseAudioBytes += pcm.byteLength;
        }
        return;
      }
      if (type === 'response.output_audio.done' || type === 'response.audio.done') {
        finishResponseAudio();
        return;
      }
      if (type === 'response.output_audio_transcript.delta' || type === 'response.audio_transcript.delta') {
        outputTranscript += String(event.delta ?? '');
        return;
      }
      if (type === 'response.output_audio_transcript.done' || type === 'response.audio_transcript.done') {
        const assistantText = cleanText(event.transcript ?? outputTranscript);
        outputTranscript = '';
        if (assistantText) {
          lastAssistantText = assistantText;
          emitWith(callbacks.onAssistantTranscript, assistantText);
        }
        return;
      }
      if (type === 'response.created') {
        emitWith(callbacks.onStatus, 'Realtime assistant is responding.');
        return;
      }
      if (type === 'response.done') {
        finishResponseAudio();
        emitWith(callbacks.onStatus, 'Realtime assistant is listening.');
      }
    });

    upstream.on('close', () => {
      closed = true;
      ready = false;
      if (!settled) {
        settled = true;
        clearTimeout(startupTimer);
        reject(new Error('OpenAI Realtime connection closed before it was ready.'));
      }
      emit(callbacks.onClose);
    });

    upstream.on('error', (error) => {
      const message = error instanceof Error ? error.message : String(error);
      emitWith(callbacks.onError, message);
      if (!closed) {
        closed = true;
        upstream.close();
      }
      if (!settled) {
        settled = true;
        clearTimeout(startupTimer);
        reject(new Error(message));
      }
    });
  });

  return session;
}
