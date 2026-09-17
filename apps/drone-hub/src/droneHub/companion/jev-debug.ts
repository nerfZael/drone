export type JevDebugRequest = {
  model: 'typesafe-ai/jev'; state: string; instructions: string;
  criteria: { send: string; wait: string };
};
export type JevDebugEntry = {
  id: string; startedAt: number; durationMs: number;
  decision?: 'send' | 'wait'; error?: string; delegated: boolean;
  request?: JevDebugRequest;
  input: { transcript: string; context: string; silenceMs: number };
  probabilities?: { send?: number; wait?: number };
};

// Session-only, bounded independently of the never-truncated transcript history.
export function retainJevDebugEntries(entries: JevDebugEntry[]): JevDebugEntry[] {
  let size = 0;
  // Frequent waits should not immediately evict the send decisions being debugged.
  const prioritized = [...entries.filter(entry => entry.decision === 'send').slice(0, 50),
    ...entries.filter(entry => entry.decision !== 'send').slice(0, 50)];
  return prioritized.filter(entry => {
    size += JSON.stringify(entry).length;
    return size <= 2_000_000;
  }).sort((left, right) => right.startedAt - left.startedAt);
}
