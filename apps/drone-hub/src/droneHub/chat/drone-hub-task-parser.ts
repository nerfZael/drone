import {
  extractStructuredMessageItems,
  MessageLiteralParser,
  type ExtractedLiteralRange,
} from './helpers/message-literal-parser';

export type DroneHubTask = {
  type: 'drone-hub-task';
  name: string;
  description: string;
};

function normalizeDroneHubTask(raw: unknown): DroneHubTask | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const type = String((raw as Record<string, unknown>).type ?? '').trim();
  if (type !== 'drone-hub-task') return null;
  const name = String((raw as Record<string, unknown>).name ?? '').trim();
  const description = String((raw as Record<string, unknown>).description ?? '').trim();
  if (!name || !description) return null;
  if (isPlaceholderTaskField(name) || isPlaceholderTaskField(description)) return null;
  return {
    type: 'drone-hub-task',
    name,
    description,
  };
}

function normalizeDroneHubTaskList(raw: unknown): DroneHubTask[] | null {
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    const tasks = raw.map(normalizeDroneHubTask);
    if (tasks.some((task) => task == null)) return null;
    return tasks as DroneHubTask[];
  }
  const single = normalizeDroneHubTask(raw);
  return single ? [single] : null;
}

function tryParseDroneHubTaskLiteral(text: string): DroneHubTask[] | null {
  const parser = new MessageLiteralParser(text);
  const parsed = parser.parseRoot();
  if (!parsed) return null;
  if (parsed.nextIndex !== text.length) return null;
  return normalizeDroneHubTaskList(parsed.value);
}

function tryParseDroneHubTaskLiteralAt(text: string, startIndex: number): ExtractedLiteralRange<DroneHubTask> | null {
  const parser = new MessageLiteralParser(text, startIndex);
  const parsed = parser.parseRoot();
  if (!parsed) return null;
  const items = normalizeDroneHubTaskList(parsed.value);
  if (!items || items.length === 0) return null;
  let end = parsed.nextIndex;
  while (end > startIndex && /\s/.test(text[end - 1] ?? '')) end -= 1;
  if (text[end - 1] === ';') {
    end -= 1;
    while (end > startIndex && /\s/.test(text[end - 1] ?? '')) end -= 1;
  }
  return {
    start: startIndex,
    end,
    items,
  };
}

function isPlaceholderTaskField(valueRaw: string): boolean {
  const value = String(valueRaw ?? '').trim();
  if (!value) return true;
  return /^(?:\.\.\.|…+)$/.test(value);
}

export function extractDroneHubTasksFromAgentMessage(textRaw: string): {
  cleanedText: string;
  tasks: DroneHubTask[];
} {
  const extracted = extractStructuredMessageItems<DroneHubTask>({
    text: textRaw,
    tryParseLiteral: tryParseDroneHubTaskLiteral,
    tryParseLiteralAt: tryParseDroneHubTaskLiteralAt,
  });
  return {
    cleanedText: extracted.cleanedText,
    tasks: extracted.items,
  };
}
