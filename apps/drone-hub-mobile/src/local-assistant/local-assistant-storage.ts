import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LocalAssistantMessage, LocalAssistantThread } from './local-assistant-types';

const THREADS_KEY = 'droneHub.localAssistant.threads.v1';
const MAX_THREADS = 30;
const MAX_MESSAGES_PER_THREAD = 120;
const MAX_STORED_MESSAGE_CHARS = 24_000;
const MAX_STORED_THREAD_CHARS = 650_000;

function cleanDetails(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.stringify(value).length <= 8_000 ? value : { truncated: true };
  } catch {
    return undefined;
  }
}

function cleanMessage(value: any): LocalAssistantMessage | null {
  if (!value || !['user', 'assistant', 'toolResult'].includes(value.role)) return null;
  const content =
    typeof value.content === 'string'
      ? value.content.slice(0, MAX_STORED_MESSAGE_CHARS)
      : Array.isArray(value.content)
        ? value.content.slice(0, 30)
        : '';
  return {
    id: String(value.id ?? '').slice(0, 100),
    createdAt: String(value.createdAt ?? new Date().toISOString()),
    role: value.role,
    content,
    toolName: value.toolName ? String(value.toolName).slice(0, 100) : undefined,
    toolCallId: value.toolCallId ? String(value.toolCallId).slice(0, 150) : undefined,
    isError: value.isError === true,
    errorMessage: value.errorMessage
      ? String(value.errorMessage).slice(0, MAX_STORED_MESSAGE_CHARS)
      : undefined,
    details: cleanDetails(value.details),
  };
}

export function boundLocalAssistantMessages(values: unknown[]): LocalAssistantMessage[] {
  const messages = values
    .slice(-MAX_MESSAGES_PER_THREAD)
    .map(cleanMessage)
    .filter((message: LocalAssistantMessage | null): message is LocalAssistantMessage =>
      Boolean(message),
    );
  let storedCharacters = messages.reduce(
    (total, message) => total + JSON.stringify(message).length,
    0,
  );
  while (messages.length > 1 && storedCharacters > MAX_STORED_THREAD_CHARS) {
    const removed = messages.shift();
    if (removed) storedCharacters -= JSON.stringify(removed).length;
  }
  while (messages.length > 0 && messages[0].role !== 'user') messages.shift();
  return messages;
}

function cleanThread(value: any): LocalAssistantThread | null {
  if (!value?.id) return null;
  const workspace = value.workspaceTarget;
  const workspaceTarget =
    workspace?.targetDeviceId && workspace?.rootId
      ? {
          targetDeviceId: String(workspace.targetDeviceId),
          rootId: String(workspace.rootId),
          read: workspace.read === true,
          write: workspace.write === true,
        }
      : null;
  const messages = boundLocalAssistantMessages(Array.isArray(value.messages) ? value.messages : []);
  return {
    id: String(value.id).slice(0, 100),
    title: String(value.title ?? 'Phone assistant').slice(0, 160),
    createdAt: String(value.createdAt ?? new Date().toISOString()),
    updatedAt: String(value.updatedAt ?? new Date().toISOString()),
    model: String(value.model ?? '').slice(0, 100),
    status: value.status === 'error' ? 'error' : 'idle',
    error: value.status === 'error' && value.error ? String(value.error).slice(0, 2_000) : null,
    workspaceTarget,
    messages,
  };
}

export async function loadLocalAssistantThreads(): Promise<LocalAssistantThread[]> {
  const stored = await AsyncStorage.getItem(THREADS_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) throw new Error('invalid local assistant threads');
    return parsed
      .slice(0, MAX_THREADS)
      .map(cleanThread)
      .filter((thread: LocalAssistantThread | null): thread is LocalAssistantThread =>
        Boolean(thread),
      );
  } catch {
    await AsyncStorage.removeItem(THREADS_KEY);
    return [];
  }
}

export async function saveLocalAssistantThreads(threads: LocalAssistantThread[]): Promise<void> {
  const clean = threads
    .slice(0, MAX_THREADS)
    .map(cleanThread)
    .filter((thread: LocalAssistantThread | null): thread is LocalAssistantThread =>
      Boolean(thread),
    );
  await AsyncStorage.setItem(THREADS_KEY, JSON.stringify(clean));
}
