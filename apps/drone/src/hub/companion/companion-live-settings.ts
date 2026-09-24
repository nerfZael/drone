import { getHubSettingsRepository } from '../../host/hub-settings-repository';

export type CompanionLiveSettings = {
  enabled: boolean;
  mode: 'live';
  systemPrompt: string;
};

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

type LiveSettingsInput = { enabled?: unknown; systemPrompt?: unknown; mode?: unknown };

export async function readCompanionLiveSettings(): Promise<CompanionLiveSettings> {
  const record = (await getHubSettingsRepository()).get<LiveSettingsInput>('companion-live-voice');
  return normalizeCompanionLiveSettings(record?.value);
}

export async function writeCompanionLiveSettings(value: unknown): Promise<CompanionLiveSettings> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Live voice settings must be an object.');
  }
  const update = value as LiveSettingsInput;
  if (update.enabled === undefined && update.systemPrompt === undefined && update.mode === undefined) {
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
  if (update.mode !== undefined && update.mode !== 'live') throw new Error('Invalid voice mode.');
  const repository = await getHubSettingsRepository();
  const written = await repository.update<LiveSettingsInput>(
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
    defaultSystemPrompt: DEFAULT_COMPANION_LIVE_SYSTEM_PROMPT,
    maxSystemPromptChars: COMPANION_LIVE_SYSTEM_PROMPT_MAX_CHARS,
  };
}

function normalizeCompanionLiveSettings(value: LiveSettingsInput | undefined): CompanionLiveSettings {
  return {
    enabled: value?.enabled === true,
    // The retired 'jev' mode (and any other stored value) normalizes to 'live'.
    mode: 'live',
    systemPrompt: typeof value?.systemPrompt === 'string'
      ? value.systemPrompt.slice(0, COMPANION_LIVE_SYSTEM_PROMPT_MAX_CHARS)
      : DEFAULT_COMPANION_LIVE_SYSTEM_PROMPT,
  };
}
