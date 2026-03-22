import {
  AUTOMATION_LABEL_MAX_CHARS,
  AUTOMATION_RUNS_DEFAULT,
  automationSleepSecondsFromConfig,
  normalizeAutomationRuns,
  normalizeAutomationSleepAmount,
  normalizeAutomationSleepUnit,
  type AutomationSleepUnit,
} from './automation-config';
import { makeId } from './helpers';

export const CHAT_DRAFT_AUTOMATION_STOP_PHRASE_DEFAULT = '<DONE>';
export const CHAT_DRAFT_AUTOMATION_LABEL_FALLBACK = 'Repeated message';

const CHAT_DRAFT_AUTOMATION_LABEL_PREFIX = 'Repeat: ';

export type DraftChatAutomationLaunch = {
  automationId: string;
  automationLabel: string;
  prompt: string;
  onFailurePrompt: string;
  runs: number;
  sleepBetweenRunsSeconds: number;
  stopPhrase: string;
  stopPhraseCaseSensitive: boolean;
};

export function formatDraftChatAutomationLabel(promptRaw: unknown): string {
  const prompt = String(promptRaw ?? '').replace(/\s+/g, ' ').trim();
  if (!prompt) return CHAT_DRAFT_AUTOMATION_LABEL_FALLBACK;
  const maxPromptChars = Math.max(1, AUTOMATION_LABEL_MAX_CHARS - CHAT_DRAFT_AUTOMATION_LABEL_PREFIX.length);
  const promptPreview =
    prompt.length <= maxPromptChars
      ? prompt
      : `${prompt.slice(0, Math.max(1, maxPromptChars - 3)).trimEnd()}...`;
  return `${CHAT_DRAFT_AUTOMATION_LABEL_PREFIX}${promptPreview}`.slice(0, AUTOMATION_LABEL_MAX_CHARS);
}

export function createDraftChatAutomationLaunch(seed: {
  prompt: unknown;
  runs?: unknown;
  sleepAmount?: unknown;
  sleepUnit?: unknown;
}): DraftChatAutomationLaunch {
  const prompt = String(seed.prompt ?? '').trim();
  const sleepAmount = normalizeAutomationSleepAmount(seed.sleepAmount);
  const sleepUnit = normalizeAutomationSleepUnit(seed.sleepUnit) as AutomationSleepUnit;
  return {
    automationId: `draft-chat:${makeId()}`,
    automationLabel: formatDraftChatAutomationLabel(prompt),
    prompt,
    onFailurePrompt: '',
    runs: normalizeAutomationRuns(seed.runs ?? AUTOMATION_RUNS_DEFAULT),
    sleepBetweenRunsSeconds: automationSleepSecondsFromConfig({ sleepAmount, sleepUnit }),
    stopPhrase: CHAT_DRAFT_AUTOMATION_STOP_PHRASE_DEFAULT,
    stopPhraseCaseSensitive: false,
  };
}
