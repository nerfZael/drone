import { sameAgentPlan } from '@drone/assistant-chat';
import type { ChatSendPayload } from '../chat';
import type { PendingPrompt, TranscriptItem } from '../types';
import {
  normalizeChatResourceSubscriptionsPayload,
  type ChatResourceSubscriptionInfo,
} from '../../domain';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

export type SendDroneChatPromptResponse = {
  ok: true;
  accepted: true;
  promptId: string;
  pendingState?: PendingPrompt['state'];
  autoRenameChat?: boolean;
};

export type SendInNewChatActionResponse = {
  ok: true;
  accepted: true;
  actionId: string;
  pendingState: PendingPrompt['state'];
  targetChatName?: string;
};

export type PromoteNewChatActionResponse = {
  ok: true;
  status: 'created' | 'executing';
  actionId: string;
  targetChatName?: string;
};

export type FetchDroneChatTranscriptResult = {
  transcripts: TranscriptItem[];
  etag: string | null;
  notModified: boolean;
};

export type FetchDroneChatStateResult = {
  transcripts: TranscriptItem[];
  pending: PendingPrompt[];
  chatId: string | null;
  subscriptions: ChatResourceSubscriptionInfo[];
};

export type DroneChatEventRef = {
  droneId?: string;
  chatName?: string;
};

export type DroneChatDeltaEvent = {
  ok?: boolean;
  chats?: DroneChatEventRef[];
  removed?: DroneChatEventRef[];
};

function normalizeEventText(raw: unknown): string {
  return String(raw ?? '').trim();
}

export function droneChatEventMatches(
  data: DroneChatDeltaEvent,
  droneIdRaw: string | null | undefined,
  chatNameRaw: string | null | undefined,
): boolean {
  const droneId = normalizeEventText(droneIdRaw);
  const chatName = normalizeEventText(chatNameRaw) || 'default';
  if (!droneId || !chatName) return false;
  const refs = [
    ...(Array.isArray(data?.chats) ? data.chats : []),
    ...(Array.isArray(data?.removed) ? data.removed : []),
  ];
  return refs.some(
    (ref) =>
      normalizeEventText(ref?.droneId) === droneId &&
      (normalizeEventText(ref?.chatName) || 'default') === chatName,
  );
}

function buildUnexpectedHtmlError(url: string): string {
  const path = String(url ?? '').trim();
  if (path.startsWith('/api/')) {
    return `Expected JSON from ${path}, but received HTML. The Hub API is likely unreachable. Start via 'drone hub' or set DRONE_HUB_API_PORT for the Vite dev server.`;
  }
  return `Expected JSON from ${path || 'request'}, but received HTML.`;
}

function sameOptionalText(left: unknown, right: unknown): boolean {
  return String(left ?? '') === String(right ?? '');
}

function sameAttachments(
  leftRaw: TranscriptItem['attachments'],
  rightRaw: TranscriptItem['attachments'],
): boolean {
  const left = Array.isArray(leftRaw) ? leftRaw : [];
  const right = Array.isArray(rightRaw) ? rightRaw : [];
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    const a = left[i];
    const b = right[i];
    if (!a || !b) return false;
    if (a.name !== b.name) return false;
    if (a.mime !== b.mime) return false;
    if (a.size !== b.size) return false;
    if (!sameOptionalText(a.fileName, b.fileName)) return false;
    if (!sameOptionalText(a.path, b.path)) return false;
    if (!sameOptionalText(a.relativePath, b.relativePath)) return false;
    if (!sameOptionalText(a.previewDataUrl, b.previewDataUrl)) return false;
  }
  return true;
}

function sameDockerSnapshot(
  left: TranscriptItem['dockerSnapshot'],
  right: TranscriptItem['dockerSnapshot'],
): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return (
    sameOptionalText(left.id, right.id) &&
    sameOptionalText(left.status, right.status) &&
    sameOptionalText(left.createdAt, right.createdAt) &&
    sameOptionalText(left.readyAt, right.readyAt) &&
    sameOptionalText(left.restoredAt, right.restoredAt) &&
    sameOptionalText(left.error, right.error) &&
    left.sizeBytes === right.sizeBytes
  );
}

function sameFileChanges(
  left: TranscriptItem['fileChanges'],
  right: TranscriptItem['fileChanges'],
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameActivity(
  left: TranscriptItem['activity'],
  right: TranscriptItem['activity'],
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  if (
    left.version !== right.version ||
    left.source !== right.source ||
    left.updatedAt !== right.updatedAt ||
    left.truncated !== right.truncated ||
    left.messages.length !== right.messages.length
  ) {
    return false;
  }
  return JSON.stringify(left.messages) === JSON.stringify(right.messages);
}

export function sameTranscriptItem(left: TranscriptItem, right: TranscriptItem): boolean {
  return (
    left.turn === right.turn &&
    sameOptionalText(left.at, right.at) &&
    sameOptionalText(left.promptAt, right.promptAt) &&
    sameOptionalText(left.startedAt, right.startedAt) &&
    sameOptionalText(left.completedAt, right.completedAt) &&
    sameOptionalText(left.id, right.id) &&
    left.prompt === right.prompt &&
    sameOptionalText(left.model, right.model) &&
    sameOptionalText(left.reasoning, right.reasoning) &&
    left.inheritedFromClone === right.inheritedFromClone &&
    sameOptionalText(left.session, right.session) &&
    sameOptionalText(left.logPath, right.logPath) &&
    left.ok === right.ok &&
    sameOptionalText(left.error, right.error) &&
    left.output === right.output &&
    sameAttachments(left.attachments, right.attachments) &&
    sameAgentPlan(left.agentPlan, right.agentPlan) &&
    sameFileChanges(left.fileChanges, right.fileChanges) &&
    sameActivity(left.activity, right.activity) &&
    sameDockerSnapshot(left.dockerSnapshot, right.dockerSnapshot)
  );
}

export function sameTranscriptItems(
  left: TranscriptItem[] | null | undefined,
  right: TranscriptItem[] | null | undefined,
): boolean {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    const a = left[i];
    const b = right[i];
    if (!a || !b || !sameTranscriptItem(a, b)) return false;
  }
  return true;
}

export async function createDroneChatEntry(
  requestJson: RequestJson,
  opts: {
    droneId: string;
    chatName: string;
    copyFromChat?: string | null;
  },
): Promise<void> {
  const droneId = String(opts.droneId ?? '').trim();
  const chatName = String(opts.chatName ?? '').trim();
  const copyFromChat = String(opts.copyFromChat ?? '').trim();
  await requestJson<{ ok: true }>(`/api/drones/${encodeURIComponent(droneId)}/chats`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: chatName,
      ...(copyFromChat ? { copyFromChat } : {}),
    }),
  });
}

export async function sendDroneChatPrompt(
  requestJson: RequestJson,
  opts: {
    droneId: string;
    chatName: string;
    prompt: string;
    promptId?: string;
    attachments?: ChatSendPayload['attachments'];
    submittedAt?: string;
    autoRenameHandledByClient?: boolean;
    deliveryMode?: 'queue' | 'asap';
  },
): Promise<SendDroneChatPromptResponse> {
  const droneId = String(opts.droneId ?? '').trim();
  const chatName = String(opts.chatName ?? '').trim() || 'default';
  const prompt = String(opts.prompt ?? '');
  const promptId = String(opts.promptId ?? '').trim();
  const attachments = Array.isArray(opts.attachments) ? opts.attachments : [];
  const submittedAt = String(opts.submittedAt ?? '').trim() || new Date().toISOString();
  return await requestJson<SendDroneChatPromptResponse>(
    `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/prompt`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt,
        ...(promptId ? { promptId } : {}),
        attachments,
        submittedAt,
        ...(opts.deliveryMode ? { deliveryMode: opts.deliveryMode } : {}),
        ...(opts.autoRenameHandledByClient ? { autoRenameHandledByClient: true } : {}),
      }),
    },
  );
}

export async function sendInNewDroneChatAction(
  requestJson: RequestJson,
  opts: {
    droneId: string;
    chatName: string;
    prompt: string;
    actionId?: string;
    attachments?: ChatSendPayload['attachments'];
    submittedAt?: string;
  },
): Promise<SendInNewChatActionResponse> {
  const droneId = String(opts.droneId ?? '').trim();
  const chatName = String(opts.chatName ?? '').trim() || 'default';
  return await requestJson<SendInNewChatActionResponse>(
    `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/new-chat-action`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: String(opts.prompt ?? ''),
        attachments: Array.isArray(opts.attachments) ? opts.attachments : [],
        ...(opts.actionId ? { promptId: opts.actionId } : {}),
        submittedAt: opts.submittedAt ?? new Date().toISOString(),
      }),
    },
  );
}

export async function promoteNewDroneChatAction(
  requestJson: RequestJson,
  opts: { droneId: string; chatName: string; actionId: string },
): Promise<PromoteNewChatActionResponse> {
  const droneId = String(opts.droneId ?? '').trim();
  const chatName = String(opts.chatName ?? '').trim() || 'default';
  const actionId = String(opts.actionId ?? '').trim();
  return await requestJson<PromoteNewChatActionResponse>(
    `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/pending/${encodeURIComponent(actionId)}/create-now`,
    { method: 'POST' },
  );
}

export async function fetchDroneChatTranscript(
  requestJson: RequestJson,
  opts: {
    droneId: string;
    chatName: string;
    turn?: 'all' | 'last' | number;
    tail?: number;
  },
): Promise<TranscriptItem[]> {
  const droneId = String(opts.droneId ?? '').trim();
  const chatName = String(opts.chatName ?? '').trim() || 'default';
  const turn = opts.turn ?? 'all';
  const qs = new URLSearchParams({ turn: String(turn) });
  if (typeof opts.tail === 'number' && Number.isFinite(opts.tail) && opts.tail > 0) {
    qs.set('tail', String(Math.floor(opts.tail)));
  }
  qs.set('transcript', 'selected');
  qs.set('pending', 'none');
  const data = await requestJson<{ ok: true; transcripts: TranscriptItem[] }>(
    `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/state?${qs.toString()}`,
  );
  return Array.isArray(data?.transcripts) ? data.transcripts : [];
}

export async function fetchDroneChatState(
  requestJson: RequestJson,
  opts: {
    droneId: string;
    chatName: string;
    turn?: 'all' | 'last' | number;
    tail?: number;
  },
): Promise<FetchDroneChatStateResult> {
  const droneId = String(opts.droneId ?? '').trim();
  const chatName = String(opts.chatName ?? '').trim() || 'default';
  const turn = opts.turn ?? 'all';
  const qs = new URLSearchParams({ turn: String(turn) });
  if (typeof opts.tail === 'number' && Number.isFinite(opts.tail) && opts.tail > 0) {
    qs.set('tail', String(Math.floor(opts.tail)));
    qs.set('transcript', 'tail');
  }
  qs.set('subscriptions', 'true');
  const data = await requestJson<{
    ok: true;
    chatId?: string | null;
    transcripts: TranscriptItem[];
    pending: PendingPrompt[];
    subscriptions?: unknown;
  }>(
    `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/state?${qs.toString()}`,
  );
  return {
    transcripts: Array.isArray(data?.transcripts) ? data.transcripts : [],
    pending: Array.isArray(data?.pending) ? data.pending : [],
    chatId: String(data?.chatId ?? '').trim() || null,
    subscriptions: normalizeChatResourceSubscriptionsPayload(data?.subscriptions),
  };
}

export async function fetchDroneChatTranscriptCached(opts: {
  droneId: string;
  chatName: string;
  turn?: 'all' | 'last' | number;
  tail?: number;
  etag?: string | null;
}): Promise<FetchDroneChatTranscriptResult> {
  const droneId = String(opts.droneId ?? '').trim();
  const chatName = String(opts.chatName ?? '').trim() || 'default';
  const turn = opts.turn ?? 'all';
  const qs = new URLSearchParams({ turn: String(turn) });
  if (typeof opts.tail === 'number' && Number.isFinite(opts.tail) && opts.tail > 0) {
    qs.set('tail', String(Math.floor(opts.tail)));
  }
  qs.set('transcript', 'selected');
  qs.set('pending', 'none');
  const url = `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/state?${qs.toString()}`;
  const headers = new Headers();
  const etag = String(opts.etag ?? '').trim();
  if (etag) headers.set('if-none-match', etag);
  const response = await fetch(url, { headers });
  if (response.status === 304) {
    return { transcripts: [], etag: etag || null, notModified: true };
  }
  const text = await response.text();
  const contentType = String(response.headers.get('content-type') ?? '').toLowerCase();
  const looksHtml = contentType.includes('text/html') || /^\s*</.test(text);
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      const error = new Error(
        looksHtml
          ? buildUnexpectedHtmlError(url)
          : `Expected JSON from ${url}, but response was not valid JSON.`,
      ) as Error & {
        status?: number;
        data?: any;
      };
      error.status = response.status;
      throw error;
    }
  }
  if (!response.ok) {
    const error = new Error(
      data?.error ? String(data.error) : `${response.status} ${response.statusText}`,
    ) as Error & {
      status?: number;
      data?: any;
    };
    error.status = response.status;
    error.data = data;
    throw error;
  }
  if (data == null) {
    const error = new Error(`Expected JSON from ${url}, but response body was empty.`) as Error & {
      status?: number;
      data?: any;
    };
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return {
    transcripts: Array.isArray(data?.transcripts) ? data.transcripts : [],
    etag: response.headers.get('etag'),
    notModified: false,
  };
}
