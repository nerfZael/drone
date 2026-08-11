import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizePromptQueueInterruption } from '@drone/assistant-chat';
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

function cleanMessage(value: any, stripImageData = false): LocalAssistantMessage | null {
  if (!value || !['user', 'assistant', 'toolResult'].includes(value.role)) return null;
  const rawContent = Array.isArray(value.content) ? value.content.slice(0, 30) : null;
  const imageAttachments = rawContent
    ? rawContent.flatMap((part: any) => {
        if (part?.type !== 'image' || !String(part?.data ?? '').trim()) return [];
        return [
          {
            name: 'Prompt image',
            mime: String(part?.mimeType ?? '').trim() || 'image/png',
            size: Math.floor((String(part.data).length * 3) / 4),
          },
        ];
      })
    : [];
  const content =
    typeof value.content === 'string'
      ? value.content.slice(0, MAX_STORED_MESSAGE_CHARS)
      : rawContent
        ? stripImageData
          ? rawContent.filter((part: any) => part?.type !== 'image')
          : rawContent
        : '';
  const cleanedDetails = cleanDetails(value.details);
  const details =
    stripImageData && imageAttachments.length > 0
      ? {
          ...(cleanedDetails && typeof cleanedDetails === 'object' ? cleanedDetails : {}),
          attachments: imageAttachments,
        }
      : cleanedDetails;
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
    details,
  };
}

function boundedMessageCharacters(message: LocalAssistantMessage): number {
  if (!Array.isArray(message.content)) return JSON.stringify(message).length;
  return JSON.stringify({
    ...message,
    content: message.content.map((part) => (part?.type === 'image' ? { ...part, data: '' } : part)),
  }).length;
}

function boundMessages(values: unknown[], stripImageData: boolean): LocalAssistantMessage[] {
  const messages = values
    .slice(-MAX_MESSAGES_PER_THREAD)
    .map((message) => cleanMessage(message, stripImageData))
    .filter((message: LocalAssistantMessage | null): message is LocalAssistantMessage =>
      Boolean(message),
    );
  let storedCharacters = messages.reduce(
    (total, message) => total + boundedMessageCharacters(message),
    0,
  );
  while (messages.length > 1 && storedCharacters > MAX_STORED_THREAD_CHARS) {
    const removed = messages.shift();
    if (removed) storedCharacters -= boundedMessageCharacters(removed);
  }
  while (messages.length > 0 && messages[0].role !== 'user') messages.shift();
  return messages;
}

export function boundLocalAssistantMessages(values: unknown[]): LocalAssistantMessage[] {
  return boundMessages(values, false);
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
  const messages = boundMessages(Array.isArray(value.messages) ? value.messages : [], true);
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
        promptImages: [],
        createdAt: String(prompt?.createdAt ?? new Date().toISOString()),
        status: prompt?.status === 'failed' ? ('failed' as const) : ('queued' as const),
        error: prompt?.error ? String(prompt.error).slice(0, 2_000) : null,
      }),
    )
    .filter((prompt: LocalAssistantQueuedPrompt) => Boolean(prompt.id && prompt.prompt));
  const approvalPolicy =
    value.approvalPolicy === 'none'
      ? 'none'
      : value.approvalPolicy === 'ask'
        ? 'ask'
        : value.autoApprove === true
          ? 'none'
          : 'ask';
  const queueInterruption = normalizePromptQueueInterruption(value.queueInterruption);
  const interruptedPromptId = String(value.interruptedPromptId ?? '')
    .trim()
    .slice(0, 120);
  return {
    id: String(value.id).slice(0, 100),
    title: String(value.title ?? 'Phone assistant').slice(0, 160),
    createdAt: String(value.createdAt ?? new Date().toISOString()),
    updatedAt: String(value.updatedAt ?? new Date().toISOString()),
    model: migrateLocalAssistantModel(value.model),
    thinkingLevel: normalizeLocalAssistantThinkingLevel(value.thinkingLevel),
    status: value.status === 'error' ? 'error' : 'idle',
    error: value.status === 'error' && value.error ? String(value.error).slice(0, 2_000) : null,
    ...(queueInterruption ? { queueInterruption } : {}),
    ...(interruptedPromptId ? { interruptedPromptId } : {}),
    autoApprove: approvalPolicy === 'none',
    agentPermissionMode:
      value.agentPermissionMode === 'read' || value.agentPermissionMode === 'write'
        ? value.agentPermissionMode
        : 'execute',
    approvalPolicy,
    artifactWorkspace: value.artifactWorkspace === true,
    workspaceTargets,
    messages,
    queuedPrompts,
  };
}

export function parseLocalAssistantThreads(raw: string | null): LocalAssistantThread[] | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map(cleanThread)
      .filter((thread: LocalAssistantThread | null): thread is LocalAssistantThread =>
        Boolean(thread),
      );
  } catch {
    return null;
  }
}

export async function loadLocalAssistantThreads(): Promise<LocalAssistantThread[]> {
  const stored = await AsyncStorage.getItem(THREADS_KEY);
  const threads = parseLocalAssistantThreads(stored);
  if (threads) return threads;
  if (stored !== null) {
    await AsyncStorage.removeItem(THREADS_KEY);
  }

  const legacyStored = await AsyncStorage.getItem(LEGACY_ASSISTANT_THREADS_KEY);
  const legacyThreads = parseLocalAssistantThreads(legacyStored);
  if (!legacyThreads) {
    if (legacyStored !== null) await AsyncStorage.removeItem(LEGACY_ASSISTANT_THREADS_KEY);
    return [];
  }

  // Keep the old value until the canonical write succeeds so an interrupted upgrade cannot lose
  // the user's chats. Transcript files and assistant preferences remain compatible with the new UI.
  await AsyncStorage.setItem(THREADS_KEY, JSON.stringify(legacyThreads));
  await AsyncStorage.removeItem(LEGACY_ASSISTANT_THREADS_KEY);
  return legacyThreads;
}

export async function saveLocalAssistantThreads(threads: LocalAssistantThread[]): Promise<void> {
  const clean = threads
    .map(cleanThread)
    .filter((thread: LocalAssistantThread | null): thread is LocalAssistantThread =>
      Boolean(thread),
    );
  await AsyncStorage.setItem(THREADS_KEY, JSON.stringify(clean));
}
