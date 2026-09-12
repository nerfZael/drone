import { getHubSettingsRepository } from '../../host/hub-settings-repository';

export type CompanionLiveSettings = {
  enabled: boolean;
  systemPrompt: string;
};

export const COMPANION_LIVE_SYSTEM_PROMPT_MAX_CHARS = 8_000;
export const DEFAULT_COMPANION_LIVE_SYSTEM_PROMPT = [
  'Speak briefly and naturally in a calm, warm, direct tone.',
  'Use moderate acknowledgments without competing with the main answer.',
].join('\n');

const REQUIRED_COMPANION_LIVE_INSTRUCTIONS = `You are Companion, the voice assistant inside Drone Hub.
Interruption policy: Stop speaking when interrupted and listen. Stopping speech does not cancel backend tasks.
Delegation policy:
Backend tools: inspect the app and workspaces, search chats, edit composers and editor buffers, and prepare proposals using the configured Companion tools.
Delegate to the backend when: the user requests an app action, lookup, careful reasoning, or a correction to pending work.
Do not delegate to the backend when: greeting, clarifying an unclear request, or repeating a still-current result.
Delegate before answering questions that depend on backend work. Never invent results or claim a proposal was applied unless confirmed.
Backend follow-ups follow the user's Companion delivery setting: ASAP steers at the next processing point; Queue waits for the current request to finish. Do not promise immediate delivery. Never promise that a correction cancelled or undid an already-running action. For urgent cancellation, direct the user to Stop Companion turn.
Use short spoken summaries. Exact results and tool activity appear in the app.`;

export async function readCompanionLiveSettings(): Promise<CompanionLiveSettings> {
  const record = (await getHubSettingsRepository()).get<{ enabled?: unknown; systemPrompt?: unknown }>('companion-live-voice');
  return normalizeCompanionLiveSettings(record?.value);
}

export async function writeCompanionLiveSettings(value: unknown): Promise<CompanionLiveSettings> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Live voice settings must be an object.');
  }
  const update = value as { enabled?: unknown; systemPrompt?: unknown };
  if (update.enabled === undefined && update.systemPrompt === undefined) {
    throw new Error('Live voice settings must include enabled or systemPrompt.');
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
  const repository = await getHubSettingsRepository();
  const written = await repository.update<{ enabled?: unknown; systemPrompt?: unknown }>(
    'companion-live-voice',
    (current) => normalizeCompanionLiveSettings({
      ...normalizeCompanionLiveSettings(current?.value),
      ...update,
    }),
  );
  return normalizeCompanionLiveSettings(written.value);
}

export function companionLiveSessionInstructions(systemPrompt?: string): string {
  const editablePrompt = systemPrompt === undefined ? DEFAULT_COMPANION_LIVE_SYSTEM_PROMPT : systemPrompt;
  const editableSection = editablePrompt.trim()
    ? `User-configurable voice guidance (presentation and conversational style only):\n${editablePrompt.trim()}`
    : '';
  return [
    editableSection,
    `Required Drone Hub contract (takes precedence over the user-configurable guidance):\n${REQUIRED_COMPANION_LIVE_INSTRUCTIONS}`,
  ].filter(Boolean).join('\n\n');
}

export function companionLiveSettingsResponse(settings: CompanionLiveSettings) {
  return {
    ...settings,
    defaultSystemPrompt: DEFAULT_COMPANION_LIVE_SYSTEM_PROMPT,
    maxSystemPromptChars: COMPANION_LIVE_SYSTEM_PROMPT_MAX_CHARS,
  };
}

function normalizeCompanionLiveSettings(value: { enabled?: unknown; systemPrompt?: unknown } | undefined): CompanionLiveSettings {
  return {
    enabled: value?.enabled === true,
    systemPrompt: typeof value?.systemPrompt === 'string'
      ? value.systemPrompt.slice(0, COMPANION_LIVE_SYSTEM_PROMPT_MAX_CHARS)
      : DEFAULT_COMPANION_LIVE_SYSTEM_PROMPT,
  };
}
