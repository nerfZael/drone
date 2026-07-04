import { hasTranscriptContent, normalizeTranscriptWhitespace, stripCommands } from './voice-transcription-segmenter';

export type RealtimeTranscriptDecision = {
  stop: boolean;
  text: string;
  hasText: boolean;
};

export function realtimeStopTranscript(text: string): RealtimeTranscriptDecision {
  const command = stripCommands(text);
  const cleaned = normalizeTranscriptWhitespace(command.text);
  return {
    stop: command.sleep,
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
