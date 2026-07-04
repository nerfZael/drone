import crypto from 'node:crypto';

import WebSocket from 'ws';

const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime';
const OPENAI_REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

export type OpenAiRealtimeTranscriptDelta = {
  text: string;
  itemId?: string;
  responseId?: string;
};

export type OpenAiRealtimeCallbacks = {
  onUserTranscript?: (text: string) => void | Promise<void>;
  onUserTranscriptDelta?: (delta: OpenAiRealtimeTranscriptDelta) => void | Promise<void>;
  onUserSpeechStarted?: () => void | Promise<void>;
  onAssistantTranscript?: (text: string) => void | Promise<void>;
  onAssistantTranscriptDelta?: (delta: OpenAiRealtimeTranscriptDelta) => void | Promise<void>;
  onStatus?: (message: string) => void | Promise<void>;
  onError?: (message: string) => void | Promise<void>;
  onClose?: () => void | Promise<void>;
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

export type OpenAiRealtimeWebRtcSession = {
  callId: string;
  sdpAnswer: string;
  cancel: () => Promise<void>;
};

export type OpenAiRealtimeWebRtcOptions = {
  apiKey: string;
  sdpOffer: string;
  safetyIdentifier: string;
  model?: string;
  voice?: string;
  instructions?: string;
  tools?: OpenAiRealtimeFunctionTool[];
  executeTool?: (call: OpenAiRealtimeToolCall) => Promise<string>;
  callbacks?: OpenAiRealtimeCallbacks;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
};

type FetchLike = (input: string, init?: any) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get: (name: string) => string | null };
  text: () => Promise<string>;
}>;

type RealtimeFunctionCall = {
  id: string;
  callId: string;
  name: string;
  argumentsJson: string;
};

function cleanText(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

function realtimeModel(env: NodeJS.ProcessEnv): string {
  return String(env.VOICE_STREAM_NEXT_OPENAI_REALTIME_MODEL ?? env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime-2').trim() || 'gpt-realtime-2';
}

function realtimeVoice(env: NodeJS.ProcessEnv): string {
  return String(env.VOICE_STREAM_NEXT_OPENAI_REALTIME_VOICE ?? env.OPENAI_REALTIME_VOICE ?? 'marin').trim() || 'marin';
}

function realtimeTranscriptionModel(env: NodeJS.ProcessEnv): string {
  return String(env.VOICE_STREAM_NEXT_OPENAI_REALTIME_TRANSCRIPTION_MODEL ?? env.OPENAI_REALTIME_TRANSCRIPTION_MODEL ?? 'gpt-realtime-whisper').trim() || 'gpt-realtime-whisper';
}

function realtimeTranscriptionDelay(env: NodeJS.ProcessEnv, model: string): string | null {
  const raw = String(env.VOICE_STREAM_NEXT_OPENAI_REALTIME_TRANSCRIPTION_DELAY ?? env.OPENAI_REALTIME_TRANSCRIPTION_DELAY ?? '').trim().toLowerCase();
  if (raw === 'default' || raw === 'auto' || raw === 'off' || raw === 'none') return null;
  if (raw === 'minimal' || raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'xhigh') return raw;
  return model === 'gpt-realtime-whisper' ? 'minimal' : null;
}

function realtimeResponseId(event: any): string {
  return cleanText(event?.response?.id ?? event?.response_id ?? event?.responseId);
}

export function realtimeCallIdFromLocation(locationRaw: string | null): string {
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

function realtimeMessageInputText(item: any): string {
  if (String(item?.type ?? '') !== 'message' || String(item?.role ?? '') !== 'user') return '';
  const content = Array.isArray(item?.content) ? item.content : [];
  return cleanText(content
    .map((part: any) => {
      const type = String(part?.type ?? '');
      return type === 'input_text' || type === 'text' ? String(part?.text ?? '') : '';
    })
    .filter(Boolean)
    .join('\n'));
}

function realtimeTurnDetection(): Record<string, unknown> {
  return {
    type: 'semantic_vad',
    eagerness: 'low',
    create_response: true,
    interrupt_response: true,
  };
}

export function openAiRealtimeWebRtcSessionConfig(opts: {
  env?: NodeJS.ProcessEnv;
  model?: string;
  voice?: string;
  instructions?: string;
  tools?: OpenAiRealtimeFunctionTool[];
}): Record<string, unknown> {
  const env = opts.env ?? process.env;
  const model = opts.model?.trim() || realtimeModel(env);
  const voice = opts.voice?.trim() || realtimeVoice(env);
  const transcriptionModel = realtimeTranscriptionModel(env);
  const transcriptionDelay = realtimeTranscriptionDelay(env, transcriptionModel);
  const tools = Array.isArray(opts.tools) ? opts.tools : [];
  return {
    type: 'realtime',
    model,
    instructions: opts.instructions ?? 'You are Sebastian, a concise spoken assistant inside Voice Stream Next.',
    ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
    output_modalities: ['audio'],
    audio: {
      input: {
        transcription: {
          model: transcriptionModel,
          ...(transcriptionDelay ? { delay: transcriptionDelay } : {}),
        },
        turn_detection: realtimeTurnDetection(),
      },
      output: {
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

async function createOpenAiRealtimeWebRtcCall(opts: OpenAiRealtimeWebRtcOptions, sessionConfig: Record<string, unknown>): Promise<{
  callId: string;
  sdpAnswer: string;
}> {
  const apiKey = String(opts.apiKey ?? '').trim();
  if (!apiKey) throw new Error('OpenAI Realtime is not configured.');
  const sdpOffer = String(opts.sdpOffer ?? '');
  if (!sdpOffer.trim()) throw new Error('WebRTC SDP offer is empty.');
  const fd = new FormData();
  fd.set('sdp', sdpOffer);
  fd.set('session', JSON.stringify(sessionConfig));
  const response = await (opts.fetchImpl ?? fetch)(OPENAI_REALTIME_CALLS_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'OpenAI-Safety-Identifier': opts.safetyIdentifier,
    },
    body: fd,
  });
  const sdpAnswer = await response.text();
  if (!response.ok) {
    throw new Error(cleanText(sdpAnswer) || `OpenAI Realtime WebRTC session failed (${response.status} ${response.statusText})`);
  }
  const callId = realtimeCallIdFromLocation(response.headers.get('location'));
  if (!callId) throw new Error('OpenAI Realtime WebRTC response did not include a call ID.');
  return { callId, sdpAnswer };
}

async function createOpenAiRealtimeSidebandSession(opts: OpenAiRealtimeWebRtcOptions & {
  callId: string;
  sessionConfig: Record<string, unknown>;
}): Promise<{ cancel: () => Promise<void> }> {
  const apiKey = String(opts.apiKey ?? '').trim();
  if (!apiKey) throw new Error('OpenAI Realtime is not configured.');
  const callId = cleanText(opts.callId);
  if (!callId) throw new Error('OpenAI Realtime call ID is missing.');
  const callbacks = opts.callbacks ?? {};
  const upstream = new WebSocket(`${OPENAI_REALTIME_URL}?call_id=${encodeURIComponent(callId)}`, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      'openai-safety-identifier': opts.safetyIdentifier,
    },
  });
  let closed = false;
  let inputTranscript = '';
  let inputTranscriptItemId = '';
  let outputTranscript = '';
  let outputText = '';
  const handledUserMessageItemIds = new Set<string>();
  const handledFunctionCalls = new Set<string>();
  const pendingFunctionCalls: RealtimeFunctionCall[] = [];

  const send = (payload: unknown): void => {
    if (closed || upstream.readyState !== WebSocket.OPEN) return;
    upstream.send(JSON.stringify(payload));
  };
  const requestAudioResponse = (): void => {
    send({ type: 'response.create', response: { output_modalities: ['audio'] } });
  };
  const handleRealtimeFunctionCalls = async (calls: RealtimeFunctionCall[]): Promise<void> => {
    if (!opts.executeTool) return;
    let outputCreated = false;
    for (const call of calls) {
      const key = call.callId || call.id;
      if (handledFunctionCalls.has(key)) continue;
      handledFunctionCalls.add(key);
      try {
        emitWith(callbacks.onStatus, `Realtime assistant is using ${call.name}.`);
        const output = await opts.executeTool({
          id: call.id,
          callId: call.callId,
          name: call.name,
          arguments: parseRealtimeFunctionArguments(call.argumentsJson),
        });
        send({
          type: 'conversation.item.create',
          item: { type: 'function_call_output', call_id: call.callId, output: realtimeFunctionOutput(output) },
        });
        outputCreated = true;
      } catch (error: any) {
        const message = cleanText(error?.message ?? error) || `${call.name} failed.`;
        send({
          type: 'conversation.item.create',
          item: { type: 'function_call_output', call_id: call.callId, output: realtimeFunctionOutput({ ok: false, error: message }) },
        });
        outputCreated = true;
      }
    }
    if (outputCreated) requestAudioResponse();
  };

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
        if (itemId) inputTranscriptItemId = itemId;
        inputTranscript += String(event.delta ?? '');
        const transcript = cleanText(inputTranscript);
        if (transcript) emitWith(callbacks.onUserTranscriptDelta, { text: transcript, ...(itemId ? { itemId } : {}) });
        return;
      }
      if (type === 'conversation.item.input_audio_transcription.completed' || type === 'conversation.item.input_audio_transcription.done') {
        const itemId = cleanText(event?.item_id ?? event?.item?.id) || inputTranscriptItemId;
        const transcript = cleanText(event.transcript ?? inputTranscript);
        inputTranscript = '';
        inputTranscriptItemId = '';
        if (itemId) handledUserMessageItemIds.add(itemId);
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
        outputTranscript += String(event.delta ?? '');
        const text = cleanText(outputTranscript);
        if (text) {
          emitWith(callbacks.onAssistantTranscriptDelta, {
            text,
            ...(cleanText(event?.item_id ?? event?.item?.id) ? { itemId: cleanText(event?.item_id ?? event?.item?.id) } : {}),
            ...(realtimeResponseId(event) ? { responseId: realtimeResponseId(event) } : {}),
          });
        }
        return;
      }
      if (type === 'response.output_audio_transcript.done' || type === 'response.audio_transcript.done') {
        const text = cleanText(event.transcript ?? outputTranscript);
        outputTranscript = '';
        if (text) emitWith(callbacks.onAssistantTranscript, text);
        return;
      }
      if (type === 'response.output_text.delta') {
        outputText += String(event.delta ?? '');
        const text = cleanText(outputText);
        if (text) {
          emitWith(callbacks.onAssistantTranscriptDelta, {
            text,
            ...(cleanText(event?.item_id ?? event?.item?.id) ? { itemId: cleanText(event?.item_id ?? event?.item?.id) } : {}),
            ...(realtimeResponseId(event) ? { responseId: realtimeResponseId(event) } : {}),
          });
        }
        return;
      }
      if (type === 'response.output_text.done') {
        const text = cleanText(event.text ?? outputText);
        outputText = '';
        if (text) emitWith(callbacks.onAssistantTranscript, text);
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

export async function createOpenAiRealtimeWebRtcSession(opts: OpenAiRealtimeWebRtcOptions): Promise<OpenAiRealtimeWebRtcSession> {
  const sessionConfig = openAiRealtimeWebRtcSessionConfig({
    env: opts.env,
    model: opts.model,
    voice: opts.voice,
    instructions: opts.instructions,
    tools: opts.tools,
  });
  const { callId, sdpAnswer } = await createOpenAiRealtimeWebRtcCall(opts, sessionConfig);
  const callbacks = opts.callbacks ?? {};
  let cancelled = false;
  let sideband: { cancel: () => Promise<void> } | null = null;
  void createOpenAiRealtimeSidebandSession({
    ...opts,
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
    emitWith(callbacks.onError, cleanText(error?.message ?? error) || 'OpenAI Realtime sideband failed.');
  });
  return {
    callId,
    sdpAnswer,
    cancel: async () => {
      cancelled = true;
      if (sideband) await sideband.cancel();
    },
  };
}

export function fallbackOpenAiSafetyIdentifier(seed: string): string {
  return `vsn_${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 32)}`.slice(0, 64);
}
