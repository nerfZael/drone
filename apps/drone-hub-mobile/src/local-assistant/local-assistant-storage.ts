import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  LocalAssistantMessage,
  LocalAssistantQueuedPrompt,
  LocalAssistantThread,
  LocalWorkspaceTarget,
} from './local-assistant-types';
import {
  migrateLocalAssistantModel,
  normalizeLocalAssistantThinkingLevel,
} from './local-assistant-model';

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

export function cleanLocalWorkspaceTargets(values: unknown[]): LocalWorkspaceTarget[] {
  const targets = new Map<string, LocalWorkspaceTarget>();
  for (const workspace of values.slice(0, 100) as any[]) {
    const targetDeviceId = String(workspace?.targetDeviceId ?? '')
      .trim()
      .slice(0, 160);
    const workspaceId = String(workspace?.workspaceId ?? workspace?.rootId ?? '')
      .trim()
      .slice(0, 160);
    if (!targetDeviceId || !workspaceId) continue;
    const previous = targets.get(`${targetDeviceId}\0${workspaceId}`);
    const write = workspace.write === true || previous?.write === true;
    const read = workspace.read === true || write || previous?.read === true;
    const execute = workspace.execute === true || previous?.execute === true;
    if (!read && !write && !execute) continue;
    targets.set(`${targetDeviceId}\0${workspaceId}`, {
      targetDeviceId,
      deviceName:
        String(workspace.deviceName ?? previous?.deviceName ?? targetDeviceId)
          .trim()
          .slice(0, 80) || targetDeviceId,
      workspaceId,
      workspaceName:
        String(
          workspace.workspaceName ?? workspace.rootId ?? previous?.workspaceName ?? workspaceId,
        )
          .trim()
          .slice(0, 160) || workspaceId,
      read,
      write,
      execute,
    });
  }
  return [...targets.values()].slice(0, 24);
}

function cleanThread(value: any): LocalAssistantThread | null {
  if (!value?.id) return null;
  const legacyWorkspace = value.workspaceTarget;
  const rawWorkspaces = Array.isArray(value.workspaceTargets)
    ? value.workspaceTargets
    : legacyWorkspace?.targetDeviceId && legacyWorkspace?.rootId
      ? [
          {
            targetDeviceId: legacyWorkspace.targetDeviceId,
            deviceName: legacyWorkspace.targetDeviceId,
            workspaceId: legacyWorkspace.rootId,
            workspaceName: legacyWorkspace.rootId,
            read: legacyWorkspace.read,
            write: legacyWorkspace.write,
            execute: false,
          },
        ]
      : [];
  const workspaceTargets = cleanLocalWorkspaceTargets(rawWorkspaces);
  const messages = boundLocalAssistantMessages(Array.isArray(value.messages) ? value.messages : []);
  const queuedPrompts = (Array.isArray(value.queuedPrompts) ? value.queuedPrompts : [])
    .slice(0, 20)
    .map(
      (prompt: any): LocalAssistantQueuedPrompt => ({
        id: String(prompt?.id ?? '')
          .trim()
          .slice(0, 120),
        prompt: String(prompt?.prompt ?? '')
          .trim()
          .slice(0, 32_000),
        createdAt: String(prompt?.createdAt ?? new Date().toISOString()),
        status: prompt?.status === 'failed' ? ('failed' as const) : ('queued' as const),
        error: prompt?.error ? String(prompt.error).slice(0, 2_000) : null,
      }),
    )
    .filter((prompt: LocalAssistantQueuedPrompt) => Boolean(prompt.id && prompt.prompt));
  return {
    id: String(value.id).slice(0, 100),
    title: String(value.title ?? 'Phone assistant').slice(0, 160),
    createdAt: String(value.createdAt ?? new Date().toISOString()),
    updatedAt: String(value.updatedAt ?? new Date().toISOString()),
    model: migrateLocalAssistantModel(value.model),
    thinkingLevel: normalizeLocalAssistantThinkingLevel(value.thinkingLevel),
    status: value.status === 'error' ? 'error' : 'idle',
    error: value.status === 'error' && value.error ? String(value.error).slice(0, 2_000) : null,
    workspaceTargets,
    messages,
    queuedPrompts,
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
