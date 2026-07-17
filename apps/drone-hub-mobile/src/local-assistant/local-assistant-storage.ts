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

const THREADS_KEY = 'droneHub.nativeChats.threads.v1';
const LEGACY_ASSISTANT_THREADS_KEY = 'droneHub.localAssistant.threads.v1';
const LEGACY_ASSISTANT_PURGE_KEY = 'droneHub.nativeChats.legacyAssistantPurged.v1';
const LEGACY_ASSISTANT_PREFERENCE_KEYS = [
  'droneHub.localAssistant.model.v1',
  'droneHub.localAssistant.thinkingLevel.v1',
  'droneHub.localAssistant.provider.v1',
];
const MAX_MESSAGES_PER_THREAD = 120;
const MAX_STORED_MESSAGE_CHARS = 24_000;
const MAX_STORED_THREAD_CHARS = 650_000;
const MAX_STORED_TRANSFER_DETAILS_CHARS = 250_000;

function cleanTransferDetails(value: any): unknown {
  const serialized = JSON.stringify(value);
  if (serialized.length <= MAX_STORED_TRANSFER_DETAILS_CHARS) return value;
  const rawFiles = Array.isArray(value.files) ? value.files : [];
  const important = rawFiles.filter(
    (file: any) =>
      file?.status === 'failed' || file?.status === 'retrying' || file?.status === 'transferring',
  );
  const nearby = [
    ...rawFiles.filter((file: any) => file?.status === 'completed').slice(-20),
    ...rawFiles.filter((file: any) => file?.status === 'pending').slice(0, 40),
  ];
  const files = Array.from(new Set([...important, ...nearby]))
    .slice(0, 80)
    .map((file: any) => ({
      sourcePath: String(file?.sourcePath ?? '').slice(0, 800),
      destinationPath: String(file?.destinationPath ?? '').slice(0, 800),
      size: Number(file?.size) || 0,
      mtimeMs: Number.isFinite(Number(file?.mtimeMs)) ? Number(file.mtimeMs) : null,
      transferredBytes: Number(file?.transferredBytes) || 0,
      retries: Number(file?.retries) || 0,
      status: String(file?.status ?? 'pending'),
      ...(file?.error ? { error: String(file.error).slice(0, 2_000) } : {}),
    }));
  const endpoint = (candidate: any) => ({
    targetId: String(candidate?.targetId ?? '').slice(0, 500),
    targetLabel: String(candidate?.targetLabel ?? '').slice(0, 500),
    path: String(candidate?.path ?? '').slice(0, 2_000),
  });
  return {
    ...value,
    source: endpoint(value.source),
    destination: endpoint(value.destination),
    ...(value.failure
      ? {
          failure: {
            ...value.failure,
            sourcePath: String(value.failure.sourcePath ?? '').slice(0, 2_000) || undefined,
            destinationPath:
              String(value.failure.destinationPath ?? '').slice(0, 2_000) || undefined,
            error: String(value.failure.error ?? '').slice(0, 4_000),
            cleanupError: String(value.failure.cleanupError ?? '').slice(0, 4_000) || undefined,
          },
        }
      : {}),
    files,
    filesTruncated: Math.max(0, rawFiles.length - files.length),
  };
}

function cleanDetails(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    if ((value as any)?.type === 'workspace_transfer') return cleanTransferDetails(value);
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
    const read = workspace.read === true || previous?.read === true;
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
    autoApprove: value.autoApprove === true,
    artifactWorkspace: value.artifactWorkspace === true,
    workspaceTargets,
    messages,
    queuedPrompts,
  };
}

export async function loadLocalAssistantThreads(): Promise<LocalAssistantThread[]> {
  if ((await AsyncStorage.getItem(LEGACY_ASSISTANT_PURGE_KEY)) !== '1') {
    await AsyncStorage.multiRemove([
      LEGACY_ASSISTANT_THREADS_KEY,
      ...LEGACY_ASSISTANT_PREFERENCE_KEYS,
    ]);
    // The legacy transcript directory is not indexed by AsyncStorage. Purge it once before any
    // native drone chat can create a replacement session with the same repository. Expo's module
    // needs to stay lazy because this storage module also runs in the portable Bun test runtime.
    const { Directory, Paths } = await import('expo-file-system');
    const legacySessions = new Directory(Paths.document, 'drone-hub-blip-sessions-v1');
    if (legacySessions.exists) legacySessions.delete();
    await AsyncStorage.setItem(LEGACY_ASSISTANT_PURGE_KEY, '1');
  }
  const stored = await AsyncStorage.getItem(THREADS_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) throw new Error('invalid Built-in chats');
    return parsed
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
    .map(cleanThread)
    .filter((thread: LocalAssistantThread | null): thread is LocalAssistantThread =>
      Boolean(thread),
    );
  await AsyncStorage.setItem(THREADS_KEY, JSON.stringify(clean));
}
