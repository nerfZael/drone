import { hasTranscriptContent, stripTranscriptCommands } from './streaming-transcription.js';

export type RealtimeTranscriptDecision = {
  stop: boolean;
  text: string;
  hasText: boolean;
};

function normalizeTranscriptWhitespace(text: string): string {
  return String(text ?? '')
    .replace(/\s+([,.:;!?])/g, '$1')
    .replace(/([([{])\s+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function realtimeStopTranscript(text: string): RealtimeTranscriptDecision {
  const command = stripTranscriptCommands(text);
  const cleaned = normalizeTranscriptWhitespace(command.text).replace(/[\s,.:;!?-]+$/g, '').trim();
  return {
    stop: command.finishDetected,
    text: cleaned,
    hasText: hasTranscriptContent(cleaned),
  };
}

export function realtimeStreamingTranscript(text: string): RealtimeTranscriptDecision {
  const stopTranscript = realtimeStopTranscript(text);
  if (stopTranscript.stop) return stopTranscript;
  const cleaned = normalizeTranscriptWhitespace(text);
  return {
    stop: false,
    text: cleaned,
    hasText: hasTranscriptContent(cleaned),
  };
}
