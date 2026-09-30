import fs from 'node:fs';
import path from 'node:path';
import { droneRootPath } from '../../host/paths';
import { resolveChatStepsSettings, type ChatStepsSettings } from '../hub-settings';
import { countTranscriptTurnsFromStore, readChatRowsFromStore, readTranscriptTurnsFromStore } from '../transcript-store';
import { getUsageStore } from '../usage/UsageStore';
import { SUMMARY_PROMPT, summarizeWork } from '../entity/entity-summarizer';
import { ChatStepTracker, type ChatSteps, type ChatTurnActivity } from './ChatStepTracker';

const TICK_MS = 5_000;
const SETTINGS_CACHE_MS = 10_000;

function readRunningTurn(droneId: string, chatName: string): ChatTurnActivity | null {
  const rows = readChatRowsFromStore({ droneId, chatName, indexes: [], includePending: true, activityMode: 'full' });
  const pending = (rows.pending ?? []).filter((prompt) => prompt.executionState === 'running' || prompt.activity);
  const current = pending[pending.length - 1];
  return current ? { turnId: current.id, prompt: current.prompt, activity: current.activity } : null;
}

function readLastTurn(droneId: string, chatName: string): ChatTurnActivity | null {
  const { count } = countTranscriptTurnsFromStore({ droneId, chatName });
  if (count <= 0) return null;
  const turn = readTranscriptTurnsFromStore({ droneId, chatName, indexes: [count - 1], activityMode: 'full' }).turns[0]?.turn;
  return turn?.id ? { turnId: turn.id, prompt: turn.prompt, activity: turn.activity } : null;
}

function readSaved(file: string): ChatSteps[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed?.steps) ? parsed.steps : [];
  } catch {
    return [];
  }
}

function writeSaved(file: string, steps: ChatSteps[]): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ version: 1, steps }));
    fs.renameSync(temp, file);
  } catch (error) {
    console.warn('Chat steps could not be saved:', error instanceof Error ? error.message : String(error));
  }
}

let service: { tracker: ChatStepTracker; timer: ReturnType<typeof setInterval> } | null = null;
let cachedSettings: { value: ChatStepsSettings; at: number } | null = null;

/** Drops the cached settings, so a change applies on the next tick. */
export function invalidateChatStepsSettings(): void {
  cachedSettings = null;
}

/** The Hub's step tracker, started once: it does nothing while step tracking is off. */
export function startChatStepService(opts: { onChange?: (steps: ChatSteps) => void; log?: (message: string) => void } = {}): ChatStepTracker {
  if (service) return service.tracker;
  const file = droneRootPath('chat-steps.json');
  const tracker = new ChatStepTracker({
    settings: async () => {
      if (cachedSettings && Date.now() - cachedSettings.at < SETTINGS_CACHE_MS) return cachedSettings.value;
      const value = await resolveChatStepsSettings();
      cachedSettings = { value, at: Date.now() };
      return value;
    },
    runningChats: () => getUsageStore().runningChats(),
    readRunningTurn,
    readLastTurn,
    summarize: ({ modelRef, reasoning, input, signal, attribution }) =>
      summarizeWork({ modelRef, reasoning, prompt: SUMMARY_PROMPT, input, signal, attribution }),
    load: () => readSaved(file),
    save: (steps) => writeSaved(file, steps),
    onChange: opts.onChange,
    onError: opts.log,
  });
  const timer = setInterval(() => void tracker.tick(), TICK_MS);
  timer.unref?.();
  service = { tracker, timer };
  return tracker;
}

export function getChatStepTracker(): ChatStepTracker | null {
  return service?.tracker ?? null;
}
