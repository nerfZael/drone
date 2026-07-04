import crypto from 'node:crypto';

import WebSocket from 'ws';

import { pcm16leToWav } from './voice-transcription-segmenter';

const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime';
const OPENAI_REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
const DESKTOP_VOICE_INPUT_SAMPLE_RATE = 16_000;
const OPENAI_REALTIME_INPUT_SAMPLE_RATE = 24_000;
const OPENAI_REALTIME_OUTPUT_SAMPLE_RATE = 24_000;

export type OpenAiRealtimeAssistantCallbacks = {
  onUserTranscript?: (text: string) => void | Promise<void>;
  onUserTranscriptDelta?: (delta: OpenAiRealtimeTranscriptDelta) => void | Promise<void>;
  onUserSpeechStarted?: () => void | Promise<void>;
  onAssistantTranscript?: (text: string) => void | Promise<void>;
  onAssistantTranscriptDelta?: (delta: OpenAiRealtimeTranscriptDelta) => void | Promise<void>;
  onAssistantAudio?: (audio: { wav: Buffer; text: string }) => void | Promise<void>;
  onStatus?: (message: string) => void | Promise<void>;
  onError?: (message: string) => void | Promise<void>;
  onClose?: () => void | Promise<void>;
};

export type OpenAiRealtimeTranscriptDelta = {
  text: string;
  itemId?: string;
  responseId?: string;
};

export type OpenAiRealtimeAssistantSession = {
  appendPcm: (pcm: Buffer) => void;
  stop: () => Promise<void>;
  cancel: () => Promise<void>;
};

export type OpenAiRealtimeWebRtcAssistantSession = {
  callId: string;
  sdpAnswer: string;
  cancel: () => Promise<void>;
};

export type OpenAiRealtimeFunctionTool = {
  type: 'function';
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
};

export type OpenAiRealtimeToolCall = {
  id: string;
  callId: string;
  name: string;
  arguments: unknown;
};

export type OpenAiRealtimeAssistantOptions = {
  apiKey: string;
  model?: string;
  voice?: string;
  instructions?: string;
  tools?: OpenAiRealtimeFunctionTool[];
  executeTool?: (call: OpenAiRealtimeToolCall) => Promise<string>;
  callbacks?: OpenAiRealtimeAssistantCallbacks;
  env?: NodeJS.ProcessEnv;
};

type FetchLike = (input: string, init?: any) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get: (name: string) => string | null };
  text: () => Promise<string>;
}>;

export type OpenAiRealtimeWebRtcAssistantOptions = Omit<OpenAiRealtimeAssistantOptions, 'model' | 'voice'> & {
  sdpOffer: string;
  model?: string;
  voice?: string;
  fetchImpl?: FetchLike;
};

function realtimeModel(env: NodeJS.ProcessEnv): string {
  return String(env.DRONE_HUB_OPENAI_REALTIME_MODEL ?? env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime-2').trim() || 'gpt-realtime-2';
}

function realtimeVoice(env: NodeJS.ProcessEnv): string {
  return String(env.DRONE_HUB_OPENAI_REALTIME_VOICE ?? env.OPENAI_REALTIME_VOICE ?? 'alloy').trim() || 'alloy';
}

function realtimeTranscriptionModel(env: NodeJS.ProcessEnv): string {
  return String(env.DRONE_HUB_OPENAI_REALTIME_TRANSCRIPTION_MODEL ?? env.OPENAI_REALTIME_TRANSCRIPTION_MODEL ?? 'gpt-realtime-whisper').trim() || 'gpt-realtime-whisper';
}

function realtimeTranscriptionDelay(env: NodeJS.ProcessEnv, model: string): string | null {
  const raw = String(env.DRONE_HUB_OPENAI_REALTIME_TRANSCRIPTION_DELAY ?? env.OPENAI_REALTIME_TRANSCRIPTION_DELAY ?? '').trim().toLowerCase();
  if (raw === 'default' || raw === 'auto' || raw === 'off' || raw === 'none') return null;
  if (raw === 'minimal' || raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'xhigh') return raw;
  return model === 'gpt-realtime-whisper' ? 'high' : null;
}

function safetyIdentifier(): string {
  const seed = `${process.env.USER ?? ''}:${process.cwd()}`;
  return `drone-hub-${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 32)}`;
}

function cleanText(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

function realtimeResponseId(event: any): string {
  return cleanText(event?.response?.id ?? event?.response_id ?? event?.responseId);
}

function realtimeCallIdFromLocation(locationRaw: string | null): string {
  const location = cleanText(locationRaw);
  if (!location) return '';
  const path = (() => {
    try {
      return new URL(location).pathname;
    } catch {
      return location.split(/[?#]/, 1)[0] ?? '';
    }
  })();
  const parts = path.split('/').map((part) => part.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

type RealtimeFunctionCall = {
  id: string;
  callId: string;
  name: string;
  argumentsJson: string;
};

function realtimeFunctionCallFromItem(item: any, index: number): RealtimeFunctionCall[] {
  if (String(item?.type ?? '') !== 'function_call') return [];
  const name = cleanText(item?.name);
  const callId = cleanText(item?.call_id);
  if (!name || !callId) return [];
  return [{
    id: cleanText(item?.id) || callId || `realtime_call_${index}`,
    callId,
    name,
    argumentsJson: typeof item?.arguments === 'string' ? item.arguments : JSON.stringify(item?.arguments ?? {}),
  }];
}

function realtimeFunctionCalls(event: any): RealtimeFunctionCall[] {
  const calls: RealtimeFunctionCall[] = [];
  if (event?.item) calls.push(...realtimeFunctionCallFromItem(event.item, 0));
  const output = Array.isArray(event?.response?.output) ? event.response.output : [];
  calls.push(...output.flatMap((item: any, index: number) => realtimeFunctionCallFromItem(item, index)));
  return calls;
}

function realtimeMessageInputText(item: any): string {
  if (String(item?.type ?? '') !== 'message' || String(item?.role ?? '') !== 'user') return '';
  const content = Array.isArray(item?.content) ? item.content : [];
  return cleanText(content
    .map((part: any) => {
      const type = String(part?.type ?? '');
      if (type === 'input_text' || type === 'text') return String(part?.text ?? '');
      return '';
    })
    .filter(Boolean)
    .join('\n'));
}

function uniqueRealtimeFunctionCalls(calls: RealtimeFunctionCall[]): RealtimeFunctionCall[] {
  const seen = new Set<string>();
  return calls.filter((call) => {
    const key = call.callId || call.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseRealtimeFunctionArguments(raw: string): unknown {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function realtimeFunctionOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? '');
  }
}

function clampPcm16(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-32768, Math.min(32767, Math.round(value)));
}

function pcm16leMonoResample(pcm: Buffer, sourceRate: number, targetRate: number): Buffer {
  if (sourceRate === targetRate || pcm.byteLength < 2) return Buffer.from(pcm);
  const sourceSamples = Math.floor(pcm.byteLength / 2);
  if (sourceSamples <= 0) return Buffer.alloc(0);
  const targetSamples = Math.max(1, Math.round((sourceSamples * targetRate) / sourceRate));
  const out = Buffer.alloc(targetSamples * 2);
  const ratio = sourceRate / targetRate;
  for (let i = 0; i < targetSamples; i += 1) {
    const sourceIndex = i * ratio;
    const leftIndex = Math.min(sourceSamples - 1, Math.floor(sourceIndex));
    const rightIndex = Math.min(sourceSamples - 1, leftIndex + 1);
    const fraction = sourceIndex - leftIndex;
    const left = pcm.readInt16LE(leftIndex * 2);
    const right = pcm.readInt16LE(rightIndex * 2);
    out.writeInt16LE(clampPcm16(left + ((right - left) * fraction)), i * 2);
  }
  return out;
}

function desktopPcmToRealtimePcm(pcm: Buffer): Buffer {
  return pcm16leMonoResample(pcm, DESKTOP_VOICE_INPUT_SAMPLE_RATE, OPENAI_REALTIME_INPUT_SAMPLE_RATE);
}

function realtimeTurnDetection(): Record<string, unknown> {
  return {
    type: 'semantic_vad',
    eagerness: 'low',
    create_response: true,
    interrupt_response: true,
  };
}

function realtimeSessionConfig(opts: {
  env: NodeJS.ProcessEnv;
  model?: string;
  voice?: string;
  instructions?: string;
  tools?: OpenAiRealtimeFunctionTool[];
  pcmTransport: boolean;
}): Record<string, unknown> {
  const model = opts.model?.trim() || realtimeModel(opts.env);
  const voice = opts.voice?.trim() || realtimeVoice(opts.env);
  const transcriptionModel = realtimeTranscriptionModel(opts.env);
  const transcriptionDelay = realtimeTranscriptionDelay(opts.env, transcriptionModel);
  const tools = Array.isArray(opts.tools) ? opts.tools : [];
  return {
    type: 'realtime',
    model,
    instructions: opts.instructions ?? 'You are Sebastian, the Drone Hub desktop voice assistant. Keep spoken replies brief and useful.',
    ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
    output_modalities: ['audio'],
    audio: {
      input: {
        ...(opts.pcmTransport
          ? {
              format: {
                type: 'audio/pcm',
                rate: OPENAI_REALTIME_INPUT_SAMPLE_RATE,
              },
            }
          : {}),
        transcription: {
          model: transcriptionModel,
          ...(transcriptionDelay ? { delay: transcriptionDelay } : {}),
        },
        turn_detection: realtimeTurnDetection(),
      },
      output: {
        ...(opts.pcmTransport
          ? {
              format: {
                type: 'audio/pcm',
                rate: OPENAI_REALTIME_OUTPUT_SAMPLE_RATE,
              },
            }
          : {}),
        voice,
      },
    },
  };
}

function emit(callback: (() => void | Promise<void>) | undefined): void {
  if (!callback) return;
  void Promise.resolve(callback()).catch(() => {});
}

function emitWith<T>(callback: ((value: T) => void | Promise<void>) | undefined, value: T): void {
  if (!callback) return;
  void Promise.resolve(callback(value)).catch(() => {});
}

function createRealtimeFunctionCallHandler(opts: {
  executeTool?: (call: OpenAiRealtimeToolCall) => Promise<string>;
  callbacks: OpenAiRealtimeAssistantCallbacks;
  send: (payload: unknown) => void;
  requestAudioResponse: () => void;
}): (calls: RealtimeFunctionCall[]) => Promise<void> {
  const handledFunctionCalls = new Set<string>();
  return async (calls: RealtimeFunctionCall[]): Promise<void> => {
    if (!opts.executeTool) return;
    let outputCreated = false;
    for (const call of calls) {
      const key = call.callId || call.id;
      if (handledFunctionCalls.has(key)) continue;
      handledFunctionCalls.add(key);
      try {
        emitWith(opts.callbacks.onStatus, `Realtime assistant is using ${call.name}.`);
        const output = await opts.executeTool({
          id: call.id,
          callId: call.callId,
          name: call.name,
          arguments: parseRealtimeFunctionArguments(call.argumentsJson),
        });
        opts.send({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: call.callId,
            output: realtimeFunctionOutput(output),
          },
        });
        outputCreated = true;
      } catch (error: any) {
        const message = cleanText(error?.message ?? error) || `${call.name} failed.`;
        opts.send({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: call.callId,
            output: realtimeFunctionOutput({ ok: false, error: message }),
          },
        });
        outputCreated = true;
      }
    }
    if (outputCreated) opts.requestAudioResponse();
  };
}

async function createOpenAiRealtimeSidebandSession(opts: OpenAiRealtimeAssistantOptions & {
  callId: string;
  sessionConfig: Record<string, unknown>;
}): Promise<{ cancel: () => Promise<void> }> {
  const env = opts.env ?? process.env;
  const apiKey = String(opts.apiKey ?? '').trim();
  if (!apiKey) throw new Error('OpenAI API key is not configured. Add it in Drone Hub settings.');
  const callId = cleanText(opts.callId);
  if (!callId) throw new Error('OpenAI Realtime call ID is missing.');
  const callbacks = opts.callbacks ?? {};
  const upstream = new WebSocket(`${OPENAI_REALTIME_URL}?call_id=${encodeURIComponent(callId)}`, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      'openai-safety-identifier': safetyIdentifier(),
    },
  });
  let closed = false;
  let ready = false;
  let inputTranscript = '';
  let outputTranscript = '';
  let outputText = '';
  const handledUserMessageItemIds = new Set<string>();
  const pendingFunctionCalls: RealtimeFunctionCall[] = [];

  const send = (payload: unknown): void => {
    if (closed || upstream.readyState !== WebSocket.OPEN) return;
    upstream.send(JSON.stringify(payload));
  };
  const requestAudioResponse = (): void => {
    send({ type: 'response.create', response: { output_modalities: ['audio'] } });
  };
  const handleRealtimeFunctionCalls = createRealtimeFunctionCallHandler({
    executeTool: opts.executeTool,
    callbacks,
    send,
    requestAudioResponse,
  });

  return await new Promise<{ cancel: () => Promise<void> }>((resolve, reject) => {
    let settled = false;
    const startupTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      closed = true;
      upstream.close();
      reject(new Error('OpenAI Realtime sideband connection timed out.'));
    }, 12_000);
    startupTimer.unref?.();

    upstream.on('open', () => {
      ready = true;
      send({ type: 'session.update', session: opts.sessionConfig });
      emitWith(callbacks.onStatus, 'Realtime assistant is listening.');
      if (!settled) {
        settled = true;
        clearTimeout(startupTimer);
        resolve({
          cancel: async () => {
            if (closed) return;
            closed = true;
            upstream.close(1000, 'cancelled');
          },
        });
      }
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
          upstream.close(1000, 'OpenAI Realtime sideband error');
        }
        if (!settled) {
          settled = true;
          clearTimeout(startupTimer);
          reject(new Error(message));
        }
        return;
      }
      if (type === 'conversation.item.input_audio_transcription.delta') {
        const itemId = cleanText(event?.item_id ?? event?.item?.id);
        inputTranscript += String(event.delta ?? '');
        const transcript = cleanText(inputTranscript);
        if (transcript) emitWith(callbacks.onUserTranscriptDelta, { text: transcript, ...(itemId ? { itemId } : {}) });
        return;
      }
      if (type === 'conversation.item.input_audio_transcription.completed' || type === 'conversation.item.input_audio_transcription.done') {
        const transcript = cleanText(event.transcript ?? inputTranscript);
        inputTranscript = '';
        if (transcript) emitWith(callbacks.onUserTranscript, transcript);
        return;
      }
      if (type === 'conversation.item.done' || type === 'conversation.item.added') {
        const itemId = cleanText(event?.item?.id);
        if (itemId && handledUserMessageItemIds.has(itemId)) return;
        const text = realtimeMessageInputText(event?.item);
        if (text) {
          if (itemId) handledUserMessageItemIds.add(itemId);
          emitWith(callbacks.onUserTranscript, text);
        }
        return;
      }
      if (type === 'input_audio_buffer.speech_started') {
        emit(callbacks.onUserSpeechStarted);
        emitWith(callbacks.onStatus, 'Realtime assistant is listening.');
        return;
      }
      if (type === 'response.output_audio_transcript.delta' || type === 'response.audio_transcript.delta') {
        const responseId = realtimeResponseId(event);
        const itemId = cleanText(event?.item_id ?? event?.item?.id);
        outputTranscript += String(event.delta ?? '');
        const assistantText = cleanText(outputTranscript);
        if (assistantText) {
          emitWith(callbacks.onAssistantTranscriptDelta, {
            text: assistantText,
            ...(itemId ? { itemId } : {}),
            ...(responseId ? { responseId } : {}),
          });
        }
        return;
      }
      if (type === 'response.output_audio_transcript.done' || type === 'response.audio_transcript.done') {
        const assistantText = cleanText(event.transcript ?? outputTranscript);
        outputTranscript = '';
        if (assistantText) emitWith(callbacks.onAssistantTranscript, assistantText);
        return;
      }
      if (type === 'response.output_text.delta') {
        const responseId = realtimeResponseId(event);
        const itemId = cleanText(event?.item_id ?? event?.item?.id);
        outputText += String(event.delta ?? '');
        const assistantText = cleanText(outputText);
        if (assistantText) {
          emitWith(callbacks.onAssistantTranscriptDelta, {
            text: assistantText,
            ...(itemId ? { itemId } : {}),
            ...(responseId ? { responseId } : {}),
          });
        }
        return;
      }
      if (type === 'response.output_text.done') {
        const assistantText = cleanText(event.text ?? outputText);
        outputText = '';
        if (assistantText) emitWith(callbacks.onAssistantTranscript, assistantText);
        return;
      }
      if (type === 'response.created') {
        outputText = '';
        emitWith(callbacks.onStatus, 'Realtime assistant is responding.');
        return;
      }
      if (type === 'response.output_item.done') {
        pendingFunctionCalls.push(...realtimeFunctionCalls(event));
        return;
      }
      if (type === 'response.done') {
        const calls = uniqueRealtimeFunctionCalls([...pendingFunctionCalls.splice(0), ...realtimeFunctionCalls(event)]);
        if (calls.length > 0) {
          void handleRealtimeFunctionCalls(calls);
          return;
        }
        emitWith(callbacks.onStatus, 'Realtime assistant is listening.');
      }
    });

    upstream.on('close', () => {
      closed = true;
      ready = false;
      if (!settled) {
        settled = true;
        clearTimeout(startupTimer);
        reject(new Error('OpenAI Realtime sideband closed before it was ready.'));
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
}

async function createOpenAiRealtimeWebRtcCall(opts: OpenAiRealtimeWebRtcAssistantOptions, sessionConfig: Record<string, unknown>): Promise<{
  callId: string;
  sdpAnswer: string;
}> {
  const apiKey = String(opts.apiKey ?? '').trim();
  if (!apiKey) throw new Error('OpenAI API key is not configured. Add it in Drone Hub settings.');
  const sdpOffer = String(opts.sdpOffer ?? '');
  if (!sdpOffer.trim()) throw new Error('WebRTC SDP offer is empty.');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const fd = new FormData();
  fd.set('sdp', sdpOffer);
  fd.set('session', JSON.stringify(sessionConfig));
  const response = await fetchImpl(OPENAI_REALTIME_CALLS_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'OpenAI-Safety-Identifier': safetyIdentifier(),
    },
    body: fd,
  });
  const sdpAnswer = await response.text();
  if (!response.ok) {
    const message = cleanText(sdpAnswer) || `OpenAI Realtime WebRTC session failed (${response.status} ${response.statusText})`;
    throw new Error(message);
  }
  const callId = realtimeCallIdFromLocation(response.headers.get('location'));
  if (!callId) throw new Error('OpenAI Realtime WebRTC response did not include a call ID.');
  return { callId, sdpAnswer };
}

export async function createOpenAiRealtimeWebRtcAssistantSession(opts: OpenAiRealtimeWebRtcAssistantOptions): Promise<OpenAiRealtimeWebRtcAssistantSession> {
  const env = opts.env ?? process.env;
  const apiKey = String(opts.apiKey ?? '').trim();
  if (!apiKey) throw new Error('OpenAI API key is not configured. Add it in Drone Hub settings.');
  const sdpOffer = String(opts.sdpOffer ?? '');
  if (!sdpOffer.trim()) throw new Error('WebRTC SDP offer is empty.');
  const sessionConfig = realtimeSessionConfig({
    env,
    model: opts.model,
    voice: opts.voice,
    instructions: opts.instructions,
    tools: opts.tools,
    pcmTransport: false,
  });
  const { callId, sdpAnswer } = await createOpenAiRealtimeWebRtcCall(opts, sessionConfig);
  const callbacks = opts.callbacks ?? {};
  let cancelled = false;
  let sideband: { cancel: () => Promise<void> } | null = null;
  void createOpenAiRealtimeSidebandSession({
    ...opts,
    env,
    callId,
    sessionConfig,
  }).then(async (createdSideband) => {
    if (cancelled) {
      await createdSideband.cancel();
      return;
    }
    sideband = createdSideband;
  }).catch((error: any) => {
    if (cancelled) return;
    const message = cleanText(error?.message ?? error) || 'OpenAI Realtime sideband failed.';
    emitWith(callbacks.onError, message);
  });
  return {
    callId,
    sdpAnswer,
    cancel: async () => {
      cancelled = true;
      if (sideband) {
        await sideband.cancel();
      }
    },
  };
}

export async function createOpenAiRealtimeAssistantSession(opts: OpenAiRealtimeAssistantOptions): Promise<OpenAiRealtimeAssistantSession> {
  const env = opts.env ?? process.env;
  const apiKey = String(opts.apiKey ?? '').trim();
  if (!apiKey) throw new Error('OpenAI API key is not configured. Add it in Drone Hub settings.');

  const model = opts.model?.trim() || realtimeModel(env);
  const callbacks = opts.callbacks ?? {};
  const tools = Array.isArray(opts.tools) ? opts.tools : [];
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
  let outputText = '';
  let responseAudio: Buffer[] = [];
  let responseAudioBytes = 0;
  let lastAssistantText = '';
  let responseActive = false;
  let activeResponseId = '';
  let activeAssistantAudioItemId = '';
  let activeAssistantAudioContentIndex = 0;
  let currentResponseCancelled = false;
  const cancelledResponseIds = new Set<string>();
  const handledUserMessageItemIds = new Set<string>();
  const pendingAudio: Buffer[] = [];
  const pendingFunctionCalls: RealtimeFunctionCall[] = [];

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

  const clearResponseOutput = (): void => {
    responseAudio = [];
    responseAudioBytes = 0;
    outputTranscript = '';
    outputText = '';
    activeAssistantAudioItemId = '';
    activeAssistantAudioContentIndex = 0;
    pendingFunctionCalls.length = 0;
  };

  const truncateActiveResponseAudio = (): void => {
    if (!activeAssistantAudioItemId || responseAudioBytes <= 0) return;
    send({
      type: 'conversation.item.truncate',
      item_id: activeAssistantAudioItemId,
      content_index: activeAssistantAudioContentIndex,
      audio_end_ms: 0,
    });
  };

  const finishResponseAudio = (): void => {
    if (currentResponseCancelled) {
      clearResponseOutput();
      return;
    }
    if (responseAudioBytes <= 0) return;
    const pcm = Buffer.concat(responseAudio, responseAudioBytes);
    responseAudio = [];
    responseAudioBytes = 0;
    emitWith(callbacks.onAssistantAudio, {
      wav: pcm16leToWav(pcm, OPENAI_REALTIME_OUTPUT_SAMPLE_RATE, 1),
      text: lastAssistantText,
    });
  };

  const requestAudioResponse = (): void => {
    send({ type: 'response.create', response: { output_modalities: ['audio'] } });
  };

  const handleRealtimeFunctionCalls = createRealtimeFunctionCallHandler({
    executeTool: opts.executeTool,
    callbacks,
    send,
    requestAudioResponse,
  });

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
          const realtimePcm = desktopPcmToRealtimePcm(pcm);
          if (realtimePcm.byteLength <= 0) return;
          if (!ready) {
            pendingAudio.push(realtimePcm);
            return;
          }
          send({ type: 'input_audio_buffer.append', audio: realtimePcm.toString('base64') });
        },
        stop: async () => {
          if (closed) return;
          send({ type: 'input_audio_buffer.commit' });
          requestAudioResponse();
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
        session: realtimeSessionConfig({
          env,
          model,
          voice: opts.voice,
          instructions: opts.instructions,
          tools,
          pcmTransport: true,
        }),
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
        const itemId = cleanText(event?.item_id ?? event?.item?.id);
        inputTranscript += String(event.delta ?? '');
        const transcript = cleanText(inputTranscript);
        if (transcript) emitWith(callbacks.onUserTranscriptDelta, { text: transcript, ...(itemId ? { itemId } : {}) });
        return;
      }
      if (type === 'conversation.item.input_audio_transcription.completed' || type === 'conversation.item.input_audio_transcription.done') {
        const transcript = cleanText(event.transcript ?? inputTranscript);
        inputTranscript = '';
        if (transcript) emitWith(callbacks.onUserTranscript, transcript);
        return;
      }
      if (type === 'conversation.item.done' || type === 'conversation.item.added') {
        const itemId = cleanText(event?.item?.id);
        if (itemId && handledUserMessageItemIds.has(itemId)) return;
        const text = realtimeMessageInputText(event?.item);
        if (text) {
          if (itemId) handledUserMessageItemIds.add(itemId);
          emitWith(callbacks.onUserTranscript, text);
        }
        return;
      }
      if (type === 'input_audio_buffer.speech_started') {
        if (activeResponseId) cancelledResponseIds.add(activeResponseId);
        if (responseActive || responseAudioBytes > 0) currentResponseCancelled = true;
        truncateActiveResponseAudio();
        clearResponseOutput();
        emit(callbacks.onUserSpeechStarted);
        emitWith(callbacks.onStatus, 'Realtime assistant is listening.');
        return;
      }
      if (type === 'response.cancelled') {
        const responseId = realtimeResponseId(event);
        if (responseId) cancelledResponseIds.add(responseId);
        if (!responseId || responseId === activeResponseId) {
          responseActive = false;
          activeResponseId = '';
          currentResponseCancelled = true;
          clearResponseOutput();
        }
        emit(callbacks.onUserSpeechStarted);
        emitWith(callbacks.onStatus, 'Realtime assistant is listening.');
        return;
      }
      if (type === 'response.output_audio.delta' || type === 'response.audio.delta') {
        const responseId = realtimeResponseId(event);
        if ((responseId && cancelledResponseIds.has(responseId)) || currentResponseCancelled) return;
        const itemId = cleanText(event?.item_id ?? event?.item?.id);
        if (itemId) activeAssistantAudioItemId = itemId;
        const contentIndex = Number(event?.content_index);
        if (Number.isInteger(contentIndex) && contentIndex >= 0) activeAssistantAudioContentIndex = contentIndex;
        const delta = String(event.delta ?? '');
        if (delta) {
          const pcm = Buffer.from(delta, 'base64');
          responseAudio.push(pcm);
          responseAudioBytes += pcm.byteLength;
        }
        return;
      }
      if (type === 'response.output_audio.done' || type === 'response.audio.done') {
        const responseId = realtimeResponseId(event);
        if (responseId && cancelledResponseIds.has(responseId)) return;
        finishResponseAudio();
        return;
      }
      if (type === 'response.output_audio_transcript.delta' || type === 'response.audio_transcript.delta') {
        const responseId = realtimeResponseId(event);
        if ((responseId && cancelledResponseIds.has(responseId)) || currentResponseCancelled) return;
        const itemId = cleanText(event?.item_id ?? event?.item?.id);
        outputTranscript += String(event.delta ?? '');
        const assistantText = cleanText(outputTranscript);
        if (assistantText) {
          emitWith(callbacks.onAssistantTranscriptDelta, {
            text: assistantText,
            ...(itemId ? { itemId } : {}),
            ...(responseId ? { responseId } : {}),
          });
        }
        return;
      }
      if (type === 'response.output_audio_transcript.done' || type === 'response.audio_transcript.done') {
        const responseId = realtimeResponseId(event);
        if (responseId && cancelledResponseIds.has(responseId)) return;
        const assistantText = cleanText(event.transcript ?? outputTranscript);
        outputTranscript = '';
        if (assistantText) {
          lastAssistantText = assistantText;
          emitWith(callbacks.onAssistantTranscript, assistantText);
        }
        return;
      }
      if (type === 'response.output_text.delta') {
        const responseId = realtimeResponseId(event);
        if ((responseId && cancelledResponseIds.has(responseId)) || currentResponseCancelled) return;
        const itemId = cleanText(event?.item_id ?? event?.item?.id);
        outputText += String(event.delta ?? '');
        const assistantText = cleanText(outputText);
        if (assistantText) {
          emitWith(callbacks.onAssistantTranscriptDelta, {
            text: assistantText,
            ...(itemId ? { itemId } : {}),
            ...(responseId ? { responseId } : {}),
          });
        }
        return;
      }
      if (type === 'response.output_text.done') {
        const responseId = realtimeResponseId(event);
        if (responseId && cancelledResponseIds.has(responseId)) return;
        const assistantText = cleanText(event.text ?? outputText);
        outputText = '';
        if (assistantText) {
          lastAssistantText = assistantText;
          emitWith(callbacks.onAssistantTranscript, assistantText);
        }
        return;
      }
      if (type === 'response.created') {
        activeResponseId = realtimeResponseId(event);
        responseActive = true;
        currentResponseCancelled = false;
        clearResponseOutput();
        emitWith(callbacks.onStatus, 'Realtime assistant is responding.');
        return;
      }
      if (type === 'response.output_item.done') {
        const responseId = realtimeResponseId(event);
        if ((responseId && cancelledResponseIds.has(responseId)) || currentResponseCancelled) return;
        pendingFunctionCalls.push(...realtimeFunctionCalls(event));
        return;
      }
      if (type === 'response.done') {
        const responseId = realtimeResponseId(event);
        const status = cleanText(event?.response?.status);
        if (status === 'cancelled' && responseId) cancelledResponseIds.add(responseId);
        if (responseId && activeResponseId && responseId !== activeResponseId) return;
        responseActive = false;
        activeResponseId = '';
        if (status === 'cancelled' || currentResponseCancelled) {
          currentResponseCancelled = true;
          clearResponseOutput();
          emitWith(callbacks.onStatus, 'Realtime assistant is listening.');
          return;
        }
        finishResponseAudio();
        currentResponseCancelled = false;
        const calls = uniqueRealtimeFunctionCalls([...pendingFunctionCalls.splice(0), ...realtimeFunctionCalls(event)]);
        if (calls.length > 0) {
          void handleRealtimeFunctionCalls(calls);
          return;
        }
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

export const __openAiRealtimeAssistantTestInternals = {
  DESKTOP_VOICE_INPUT_SAMPLE_RATE,
  OPENAI_REALTIME_INPUT_SAMPLE_RATE,
  pcm16leMonoResample,
  desktopPcmToRealtimePcm,
  realtimeCallIdFromLocation,
  realtimeSessionConfig,
  realtimeTurnDetection,
  createRealtimeFunctionCallHandler,
  createOpenAiRealtimeWebRtcCall,
};
