// Claude Code can end a turn while background work (a long command, a Monitor
// watch, a subagent) keeps running, and later start a turn on its own when that
// work reports. Such a turn has no user message; this prompt stands in for one.

import { xmlDecode, xmlEscape } from './xml-text.js';

const ROOT = 'background-task-notification';

export type BackgroundTaskNotificationDisplay = {
  summaries: string[];
};

export function renderBackgroundTaskNotificationPrompt(summaries: readonly string[]): string {
  const tasks = summaries.map((summary) => summary.trim()).filter(Boolean);
  return [
    `<${ROOT}>`,
    ...tasks.map((summary) => `<task>${xmlEscape(summary)}</task>`),
    `</${ROOT}>`,
  ].join('\n');
}

export function parseBackgroundTaskNotificationPrompt(
  value: unknown,
): BackgroundTaskNotificationDisplay | null {
  const prompt = String(value ?? '').trim();
  if (!prompt.startsWith(`<${ROOT}>`) || !prompt.endsWith(`</${ROOT}>`)) return null;
  const summaries = Array.from(prompt.matchAll(/<task>([\s\S]*?)<\/task>/g), (match) =>
    xmlDecode(match[1] ?? '').trim(),
  ).filter(Boolean);
  return { summaries };
}

/** Matches exactly the prompts that parse, so no message is claimed and then dropped. */
export function isBackgroundTaskNotificationPrompt(value: unknown): boolean {
  return parseBackgroundTaskNotificationPrompt(value) !== null;
}
