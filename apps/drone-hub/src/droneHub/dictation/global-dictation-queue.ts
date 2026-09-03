export type OrderedTranscriptionResult = {
  status: 'pending' | 'ready' | 'failed';
  text: string;
};

export function drainReadyTranscriptionResults<T extends OrderedTranscriptionResult>(
  queue: T[],
): string[] {
  const transcripts: string[] = [];
  while (queue[0]?.status === 'ready') {
    const item = queue.shift();
    const transcript = String(item?.text ?? '').trim();
    if (transcript) transcripts.push(transcript);
  }
  return transcripts;
}

export function appendGlobalDictationTranscript(current: string, transcript: string): string {
  const cleanTranscript = String(transcript ?? '').trim();
  if (!cleanTranscript) return current;
  const separator = current && !current.endsWith('\n') ? '\n' : '';
  return `${current}${separator}${cleanTranscript}`;
}
