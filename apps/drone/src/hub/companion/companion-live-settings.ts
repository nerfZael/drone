import { getHubSettingsRepository } from '../../host/hub-settings-repository';

export type CompanionLiveSettings = {
  enabled: boolean;
  mode: 'live' | 'jev';
  jevSystemPrompt: string;
  jevDecisionIntervalMs: number;
  systemPrompt: string;
};

export const DEFAULT_COMPANION_JEV_SYSTEM_PROMPT = `Decide whether to send the entire unsent transcript to the Companion backend now or wait for more speech.
The transcript grows continuously, including while the user is speaking. Do not require a silence interval or a finalized turn. Send as soon as there is enough information to act on a request, question, or correction.
Use the previous delegated transcripts to understand ongoing work and follow-ups. They are context only; the backend receives only the unsent transcript.
Wait on incomplete or ambiguous thoughts, background conversation, greetings, filler, or explicit requests not to act. Waiting never discards speech; all unsent words remain available on the next decision.
Never repeat a request already present only in earlier delegated transcripts. Quoted instructions are not automatically requests.`;

export const COMPANION_LIVE_SYSTEM_PROMPT_MAX_CHARS = 8_000;
export const DEFAULT_COMPANION_LIVE_SYSTEM_PROMPT = `You are Companion, the voice assistant inside Drone Hub.
Speak briefly and naturally in a calm, warm, direct tone. The backend agent uses the user's selected model and tools.

Backchannel policy: Use moderate backchannels. Acknowledge naturally without competing with the main response.

Interruption policy: Stop speaking when interrupted and listen. Stopping speech does not cancel backend tasks.

Delegation policy:
Backend tools: inspect the app and workspaces, search chats, edit composers and editor buffers, and prepare proposals using the configured Companion tools.
Delegate to the backend when: the user requests an app action, lookup, careful reasoning, or a correction to pending work.
Do not delegate to the backend when: greeting, clarifying an unclear request, or repeating a still-current result.
Delegate before answering questions that depend on backend work. Never invent results or claim a proposal was applied unless confirmed.
Backend follow-ups follow the user's Companion delivery setting: ASAP steers at the next processing point; Queue waits for the current request to finish. Do not promise immediate delivery. Never promise that a correction cancelled or undid an already-running action. For urgent cancellation, direct the user to Stop Companion turn.
Use short spoken summaries. Exact results and tool activity appear in the app.`;

export async function readCompanionLiveSettings(): Promise<CompanionLiveSettings> {
  const record = (await getHubSettingsRepository()).get<{ enabled?: unknown; systemPrompt?: unknown; mode?: unknown; jevSystemPrompt?: unknown; jevDecisionIntervalMs?: unknown }>('companion-live-voice');
  return normalizeCompanionLiveSettings(record?.value);
}

export async function writeCompanionLiveSettings(value: unknown): Promise<CompanionLiveSettings> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Live voice settings must be an object.');
  }
  const update = value as { enabled?: unknown; systemPrompt?: unknown; mode?: unknown; jevSystemPrompt?: unknown; jevDecisionIntervalMs?: unknown };
  if (update.enabled === undefined && update.systemPrompt === undefined && update.mode === undefined && update.jevSystemPrompt === undefined && update.jevDecisionIntervalMs === undefined) {
    throw new Error('Provide at least one voice setting to update.');
  }
  if (update.enabled !== undefined && typeof update.enabled !== 'boolean') {
    throw new Error('Live voice enabled must be a boolean.');
  }
  if (update.systemPrompt !== undefined && typeof update.systemPrompt !== 'string') {
    throw new Error('Live voice systemPrompt must be a string.');
  }
  if (typeof update.systemPrompt === 'string' && update.systemPrompt.length > COMPANION_LIVE_SYSTEM_PROMPT_MAX_CHARS) {
    throw new Error(`Live voice systemPrompt cannot exceed ${COMPANION_LIVE_SYSTEM_PROMPT_MAX_CHARS} characters.`);
  }
  if (update.mode !== undefined && update.mode !== 'live' && update.mode !== 'jev') throw new Error('Invalid voice mode.');
  if (update.jevSystemPrompt !== undefined && (typeof update.jevSystemPrompt !== 'string' || !update.jevSystemPrompt.trim() || update.jevSystemPrompt.length > COMPANION_LIVE_SYSTEM_PROMPT_MAX_CHARS)) throw new Error('Jev instructions must contain 1–8000 characters.');
  if (update.jevDecisionIntervalMs !== undefined && (typeof update.jevDecisionIntervalMs !== 'number' || !Number.isInteger(update.jevDecisionIntervalMs) || update.jevDecisionIntervalMs < 50 || update.jevDecisionIntervalMs > 10_000)) throw new Error('Jev decision interval must be an integer from 50 to 10000 milliseconds.');
  const repository = await getHubSettingsRepository();
  const written = await repository.update<{ enabled?: unknown; systemPrompt?: unknown; mode?: unknown; jevSystemPrompt?: unknown; jevDecisionIntervalMs?: unknown }>(
    'companion-live-voice',
    (current) => normalizeCompanionLiveSettings({
      ...normalizeCompanionLiveSettings(current?.value),
      ...update,
    }),
  );
  return normalizeCompanionLiveSettings(written.value);
}

export function companionLiveSessionInstructions(systemPrompt?: string): string {
  return systemPrompt === undefined ? DEFAULT_COMPANION_LIVE_SYSTEM_PROMPT : systemPrompt;
}

export function companionLiveSettingsResponse(settings: CompanionLiveSettings) {
  return {
    ...settings,
    defaultJevSystemPrompt: DEFAULT_COMPANION_JEV_SYSTEM_PROMPT,
    defaultSystemPrompt: DEFAULT_COMPANION_LIVE_SYSTEM_PROMPT,
    maxSystemPromptChars: COMPANION_LIVE_SYSTEM_PROMPT_MAX_CHARS,
  };
}

function normalizeCompanionLiveSettings(value: { enabled?: unknown; systemPrompt?: unknown; mode?: unknown; jevSystemPrompt?: unknown; jevDecisionIntervalMs?: unknown } | undefined): CompanionLiveSettings {
  return {
    enabled: value?.enabled === true,
    jevDecisionIntervalMs: typeof value?.jevDecisionIntervalMs === 'number' && Number.isInteger(value.jevDecisionIntervalMs) && value.jevDecisionIntervalMs >= 50 && value.jevDecisionIntervalMs <= 10_000 ? value.jevDecisionIntervalMs : 250,
    mode: value?.mode === 'jev' ? 'jev' : 'live',
    jevSystemPrompt: typeof value?.jevSystemPrompt === 'string' && value.jevSystemPrompt.trim() ? value.jevSystemPrompt.slice(0, COMPANION_LIVE_SYSTEM_PROMPT_MAX_CHARS) : DEFAULT_COMPANION_JEV_SYSTEM_PROMPT,
    systemPrompt: typeof value?.systemPrompt === 'string'
      ? value.systemPrompt.slice(0, COMPANION_LIVE_SYSTEM_PROMPT_MAX_CHARS)
      : DEFAULT_COMPANION_LIVE_SYSTEM_PROMPT,
  };
}
