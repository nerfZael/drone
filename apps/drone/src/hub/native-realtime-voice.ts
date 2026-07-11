import type { BlipRuntimeEvent } from '@blip/core';

import type { DesktopVoiceRealtimeCallbacks, DesktopVoiceRealtimeSession } from './desktop-voice-service';
import { realtimeStopTranscript } from './realtime-transcript';
import { SileroVadStream } from './silero-vad-stream';
import { pcm16leToWav } from './voice-transcription-segmenter';

const MAX_TTS_CHARS = 180;
const TOOL_STATUS_COOLDOWN_MS = 1_200;

type SpeechDetector = {
  appendPcm: (pcm: Buffer) => Promise<void>;
  flush: () => Promise<void>;
  close: () => Promise<void>;
};

export type NativeRealtimeVoiceOptions = {
  callbacks?: Partial<DesktopVoiceRealtimeCallbacks>;
  transcribePcm: (wav: Buffer, signal: AbortSignal) => Promise<string>;
  synthesizeSpeech: (text: string, signal: AbortSignal) => Promise<Buffer>;
  isAssistantRunning: () => boolean;
  submitPrompt: (prompt: string) => void | Promise<void>;
  steerPrompt: (prompt: string) => void;
  subscribeAssistantEvents: (listener: (event: BlipRuntimeEvent) => void | Promise<void>) => () => void;
  createSpeechDetector?: (callbacks: {
    onSpeechStart: () => void;
    onSpeechEnd: (pcm: Buffer) => void;
    onError: (error: Error) => void;
  }) => Promise<SpeechDetector>;
};

function cleanText(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

export function speechText(raw: unknown): string {
  return String(raw ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|[-*+] |\d+[.)] )/gm, '')
    .replace(/[*_~>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitLongChunk(text: string): string[] {
  const chunks: string[] = [];
  let remaining = cleanText(text);
  while (remaining.length > MAX_TTS_CHARS) {
    const boundary = remaining.lastIndexOf(' ', MAX_TTS_CHARS);
    const end = boundary >= Math.floor(MAX_TTS_CHARS * 0.6) ? boundary : MAX_TTS_CHARS;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function takeSpeechChunks(textRaw: string, flush = false): { chunks: string[]; remainder: string } {
  let text = String(textRaw ?? '');
  const chunks: string[] = [];
  while (text.length > 0) {
    const match = /[.!?](?:["')\]]*)\s+/.exec(text);
    if (match) {
      const end = match.index + match[0].length;
      chunks.push(...splitLongChunk(speechText(text.slice(0, end))));
      text = text.slice(end);
      continue;
    }
    if (text.length > MAX_TTS_CHARS) {
      const boundary = text.lastIndexOf(' ', MAX_TTS_CHARS);
      const end = boundary >= Math.floor(MAX_TTS_CHARS * 0.6) ? boundary : MAX_TTS_CHARS;
      chunks.push(...splitLongChunk(speechText(text.slice(0, end))));
      text = text.slice(end);
      continue;
    }
    break;
  }
  if (flush) {
    chunks.push(...splitLongChunk(speechText(text)));
    text = '';
  }
  return { chunks: chunks.filter(Boolean), remainder: text };
}

export function nativeToolStatus(toolRaw: unknown): string | null {
  const tool = cleanText(toolRaw).replace(/^drone_hub__/, '');
  if (tool === 'list_drones' || tool === 'list_repos' || tool === 'list_groups') return 'I’m checking the drone fleet.';
  if (tool === 'read_chat_messages' || tool === 'read_chat' || tool === 'list_chats') return 'I’m checking the latest drone activity.';
  if (tool === 'message_drone' || tool === 'send_message') return 'I’m sending that to the drone.';
  if (tool === 'web_search' || tool === 'fetch_content') return 'I’m looking that up.';
  if (tool === 'bash' || tool === 'search_files' || tool === 'read_file') return 'I’m running the requested check.';
  if (tool === 'create_drone' || tool === 'clone_drone') return 'I’m preparing the drone.';
  return null;
}

class NativeSpeechQueue {
  private pending: Array<{ text: string; generation: number }> = [];
  private processing = false;
  private generation = 0;
  private controller: AbortController | null = null;

  constructor(
    private readonly synthesize: NativeRealtimeVoiceOptions['synthesizeSpeech'],
    private readonly callbacks: Partial<DesktopVoiceRealtimeCallbacks>,
  ) {}

  enqueue(textRaw: string): void {
    const text = speechText(textRaw).slice(0, MAX_TTS_CHARS).trim();
    if (!text) return;
    this.pending.push({ text, generation: this.generation });
    void this.process();
  }

  interrupt(): void {
    this.generation += 1;
    this.pending = [];
    this.controller?.abort();
    this.controller = null;
  }

  close(): void {
    this.interrupt();
  }

  private async process(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.pending.length > 0) {
        const item = this.pending.shift()!;
        if (item.generation !== this.generation) continue;
        const controller = new AbortController();
        this.controller = controller;
        try {
          const wav = await this.synthesize(item.text, controller.signal);
          if (controller.signal.aborted || item.generation !== this.generation || wav.byteLength === 0) continue;
          await this.callbacks.onAssistantAudio?.({ wav, text: item.text });
        } catch (error: any) {
          if (!controller.signal.aborted && item.generation === this.generation) {
            await this.callbacks.onError?.(`Native voice synthesis failed: ${cleanText(error?.message ?? error)}`);
          }
        } finally {
          if (this.controller === controller) this.controller = null;
        }
      }
    } finally {
      this.processing = false;
      if (this.pending.length > 0) void this.process();
    }
  }
}

export async function createNativeRealtimeVoiceSession(options: NativeRealtimeVoiceOptions): Promise<DesktopVoiceRealtimeSession> {
  const callbacks = options.callbacks ?? {};
  const speechQueue = new NativeSpeechQueue(options.synthesizeSpeech, callbacks);
  const assistantBuffers = new Map<string, string>();
  const streamingAssistantTurns = new Set<string>();
  const interruptedAssistantTurns = new Set<string>();
  let utteranceQueue = Promise.resolve();
  let transcriptionController: AbortController | null = null;
  let pendingUserUtterances = 0;
  let closed = false;
  let lastAssistantSpeechAt = 0;
  let lastToolStatusAt = 0;

  const queueAssistantSpeech = (text: string): void => {
    const cleaned = speechText(text);
    if (!cleaned || closed) return;
    lastAssistantSpeechAt = Date.now();
    speechQueue.enqueue(cleaned);
  };

  const dispatchPrompt = (text: string): boolean => {
    if (options.isAssistantRunning()) {
      try {
        options.steerPrompt(text);
        return true;
      } catch {
        // The turn may have ended between the running check and steering. Submitting
        // through the host preserves the utterance and lets it choose steer or prompt.
      }
    }
    void Promise.resolve(options.submitPrompt(text)).catch((error: any) => {
      if (!closed) void callbacks.onError?.(`Native realtime assistant failed: ${cleanText(error?.message ?? error)}`);
    });
    return false;
  };

  const unsubscribe = options.subscribeAssistantEvents((event) => {
    if (closed) return;
    const turnId = cleanText(event.turnId) || 'current';
    if (event.type === 'assistant_delta') {
      if (pendingUserUtterances > 0) {
        interruptedAssistantTurns.add(turnId);
        assistantBuffers.delete(turnId);
        streamingAssistantTurns.delete(turnId);
        return;
      }
      interruptedAssistantTurns.delete(turnId);
      streamingAssistantTurns.add(turnId);
      const buffered = `${assistantBuffers.get(turnId) ?? ''}${event.text}`;
      const next = takeSpeechChunks(buffered);
      assistantBuffers.set(turnId, next.remainder);
      for (const chunk of next.chunks) queueAssistantSpeech(chunk);
      return;
    }
    if (event.type === 'assistant_message') {
      if (pendingUserUtterances > 0) {
        assistantBuffers.delete(turnId);
        streamingAssistantTurns.delete(turnId);
        interruptedAssistantTurns.delete(turnId);
        return;
      }
      void callbacks.onAssistantTranscript?.(event.text);
      const buffered = assistantBuffers.get(turnId) ?? '';
      assistantBuffers.delete(turnId);
      const streamed = streamingAssistantTurns.delete(turnId);
      if (interruptedAssistantTurns.delete(turnId) && !streamed) return;
      const next = takeSpeechChunks(streamed ? buffered : event.text, true);
      for (const chunk of next.chunks) queueAssistantSpeech(chunk);
      return;
    }
    if (event.type === 'tool_call_started') {
      if (pendingUserUtterances > 0) return;
      const status = nativeToolStatus(event.tool);
      const now = Date.now();
      if (status && now - lastAssistantSpeechAt >= TOOL_STATUS_COOLDOWN_MS && now - lastToolStatusAt >= TOOL_STATUS_COOLDOWN_MS) {
        lastToolStatusAt = now;
        speechQueue.enqueue(status);
      }
      void callbacks.onStatus?.(`Native realtime assistant is using ${event.tool}.`);
      return;
    }
    if (event.type === 'session_error') {
      void callbacks.onError?.(event.error);
    }
  });

  const handleUtterance = async (pcm: Buffer): Promise<void> => {
    if (closed || pcm.byteLength === 0) return;
    const controller = new AbortController();
    transcriptionController = controller;
    try {
      await callbacks.onStatus?.('Native realtime assistant is transcribing.');
      const transcript = cleanText(await options.transcribePcm(pcm16leToWav(pcm), controller.signal));
      if (!transcript || closed) return;
      await callbacks.onUserTranscript?.(transcript);
      const stop = realtimeStopTranscript(transcript);
      if (stop.stop || closed) return;
      const steered = dispatchPrompt(transcript);
      speechQueue.enqueue(steered ? 'Got it. I’ll adjust.' : 'Got it. I’m on it.');
      await callbacks.onStatus?.(steered ? 'Native realtime assistant updated the active work.' : 'Native realtime assistant is working.');
    } catch (error: any) {
      if (!closed && !controller.signal.aborted) {
        await callbacks.onError?.(`Native realtime transcription failed: ${cleanText(error?.message ?? error)}`);
      }
    } finally {
      if (transcriptionController === controller) transcriptionController = null;
      pendingUserUtterances = Math.max(0, pendingUserUtterances - 1);
    }
  };

  const createSpeechDetector = options.createSpeechDetector ?? (async (detectorCallbacks) => await SileroVadStream.create({ callbacks: detectorCallbacks }));
  let detector: SpeechDetector;
  try {
    detector = await createSpeechDetector({
      onSpeechStart: () => {
        if (closed) return;
        pendingUserUtterances += 1;
        speechQueue.interrupt();
        for (const turnId of assistantBuffers.keys()) interruptedAssistantTurns.add(turnId);
        assistantBuffers.clear();
        streamingAssistantTurns.clear();
        void callbacks.onUserSpeechStarted?.();
        void callbacks.onStatus?.('Native realtime assistant is listening.');
      },
      onSpeechEnd: (pcm) => {
        if (closed) return;
        if (pcm.byteLength === 0) {
          pendingUserUtterances = Math.max(0, pendingUserUtterances - 1);
          return;
        }
        utteranceQueue = utteranceQueue.catch(() => {}).then(async () => await handleUtterance(pcm));
      },
      onError: (error) => {
        if (!closed) void callbacks.onError?.(`Silero voice detection failed: ${cleanText(error.message)}`);
      },
    });
  } catch (error: any) {
    unsubscribe();
    speechQueue.close();
    throw new Error(`Silero voice detection failed to start: ${cleanText(error?.message ?? error)}`);
  }

  await callbacks.onStatus?.('Native realtime assistant is listening with Silero.');
  const sendText = async (textRaw: string): Promise<void> => {
    const text = cleanText(textRaw);
    if (!text || closed) return;
    speechQueue.interrupt();
    const steered = dispatchPrompt(text);
    await callbacks.onStatus?.(steered ? 'Native realtime assistant updated the active work.' : 'Native realtime assistant is working.');
  };

  return {
    appendPcm: async (pcm) => {
      if (!closed) await detector.appendPcm(pcm);
    },
    stop: async () => {
      if (!closed) await detector.flush();
    },
    sendText,
    cancel: async () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      speechQueue.close();
      transcriptionController?.abort();
      await detector.close();
      await callbacks.onClose?.();
    },
  };
}
