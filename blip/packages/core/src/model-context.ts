import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { TranscriptEntry } from './types.js';

/** Rebuild the model context from a durable transcript, honoring its latest compaction boundary. */
export function modelMessagesFromTranscript(transcript: TranscriptEntry[]): AgentMessage[] {
  let compactionIndex = -1;
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    if (transcript[index].type === 'compaction') {
      compactionIndex = index;
      break;
    }
  }
  if (compactionIndex < 0) {
    return transcript.flatMap((entry) => (entry.type === 'message' ? [entry.message] : []));
  }

  const compaction = transcript[compactionIndex] as Extract<
    TranscriptEntry,
    { type: 'compaction' }
  >;
  const messages: AgentMessage[] = [
    {
      role: 'user',
      content: `Summary of earlier conversation:\n${compaction.summary}`,
      timestamp: Date.parse(compaction.createdAt) || Date.now(),
    },
  ];

  let foundFirstKept = false;
  for (let index = 0; index < compactionIndex; index += 1) {
    const entry = transcript[index];
    if (entry.id === compaction.firstKeptEntryId) foundFirstKept = true;
    if (foundFirstKept && entry.type === 'message') messages.push(entry.message);
  }
  if (!foundFirstKept) {
    // A damaged boundary must not discard conversation history.
    return transcript.flatMap((entry) => (entry.type === 'message' ? [entry.message] : []));
  }
  for (let index = compactionIndex + 1; index < transcript.length; index += 1) {
    const entry = transcript[index];
    if (entry.type === 'message') messages.push(entry.message);
  }
  return messages;
}
