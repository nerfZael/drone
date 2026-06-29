import type { ChatSendPayload } from '../chat';
import type { PendingPrompt, TranscriptItem } from '../types';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

export type SendDroneChatPromptResponse = {
  ok: true;
  accepted: true;
  promptId: string;
  pendingState?: PendingPrompt['state'];
  blockedByAutomation?: boolean;
};

export type FetchDroneChatTranscriptResult = {
  transcripts: TranscriptItem[];
  etag: string | null;
  notModified: boolean;
};

export type FetchDroneChatStateResult = {
  transcripts: TranscriptItem[];
  pending: PendingPrompt[];
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

export function droneChatEventMatches(data: DroneChatDeltaEvent, droneIdRaw: string | null | undefined, chatNameRaw: string | null | undefined): boolean {
  const droneId = normalizeEventText(droneIdRaw);
  const chatName = normalizeEventText(chatNameRaw) || 'default';
  if (!droneId || !chatName) return false;
  const refs = [...(Array.isArray(data?.chats) ? data.chats : []), ...(Array.isArray(data?.removed) ? data.removed : [])];
  return refs.some((ref) => normalizeEventText(ref?.droneId) === droneId && (normalizeEventText(ref?.chatName) || 'default') === chatName);
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

function sameAttachments(leftRaw: TranscriptItem['attachments'], rightRaw: TranscriptItem['attachments']): boolean {
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

function sameAutomation(left: TranscriptItem['automation'], right: TranscriptItem['automation']): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return (
    left.kind === right.kind &&
    sameOptionalText(left.stage, right.stage) &&
    sameOptionalText(left.jobKey, right.jobKey) &&
    sameOptionalText(left.automationId, right.automationId) &&
    sameOptionalText(left.automationLabel, right.automationLabel) &&
    left.runIndex === right.runIndex &&
    left.runsTotal === right.runsTotal &&
    left.sleepBetweenRunsSeconds === right.sleepBetweenRunsSeconds &&
    sameOptionalText(left.stopPhrase, right.stopPhrase) &&
    left.stopPhraseCaseSensitive === right.stopPhraseCaseSensitive &&
    left.stopMatchedRunIndex === right.stopMatchedRunIndex &&
    sameOptionalText(left.promptPreview, right.promptPreview)
  );
}

function sameAgentMessageAutoContinue(
  left: TranscriptItem['agentMessageAutoContinue'],
  right: TranscriptItem['agentMessageAutoContinue'],
): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return (
    sameOptionalText(left.status, right.status) &&
    sameOptionalText(left.bucket, right.bucket) &&
    sameOptionalText(left.source, right.source) &&
    sameOptionalText(left.classifiedAt, right.classifiedAt) &&
    sameOptionalText(left.continuedAt, right.continuedAt) &&
    sameOptionalText(left.error, right.error) &&
    sameOptionalText(left.updatedAt, right.updatedAt)
  );
}

function sameAgentSuggestion(
  left: TranscriptItem['agentSuggestion'],
  right: TranscriptItem['agentSuggestion'],
): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return (
    sameOptionalText(left.usedDirectAt, right.usedDirectAt) &&
    sameOptionalText(left.suggestionHash, right.suggestionHash) &&
    sameOptionalText(left.policyFingerprint, right.policyFingerprint) &&
    sameOptionalText(left.updatedAt, right.updatedAt)
  );
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

export function sameTranscriptItem(left: TranscriptItem, right: TranscriptItem): boolean {
  return (
    left.turn === right.turn &&
    sameOptionalText(left.at, right.at) &&
    sameOptionalText(left.promptAt, right.promptAt) &&
    sameOptionalText(left.completedAt, right.completedAt) &&
    sameOptionalText(left.id, right.id) &&
    left.prompt === right.prompt &&
    left.inheritedFromClone === right.inheritedFromClone &&
    sameOptionalText(left.session, right.session) &&
    sameOptionalText(left.logPath, right.logPath) &&
    left.ok === right.ok &&
    sameOptionalText(left.error, right.error) &&
    left.output === right.output &&
    sameAttachments(left.attachments, right.attachments) &&
    sameAutomation(left.automation, right.automation) &&
    sameAgentMessageAutoContinue(left.agentMessageAutoContinue, right.agentMessageAutoContinue) &&
    sameAgentSuggestion(left.agentSuggestion, right.agentSuggestion) &&
    sameDockerSnapshot(left.dockerSnapshot, right.dockerSnapshot)
  );
}

export function sameTranscriptItems(left: TranscriptItem[] | null | undefined, right: TranscriptItem[] | null | undefined): boolean {
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
    attachments?: ChatSendPayload['attachments'];
    submittedAt?: string;
  },
): Promise<SendDroneChatPromptResponse> {
  const droneId = String(opts.droneId ?? '').trim();
  const chatName = String(opts.chatName ?? '').trim() || 'default';
  const prompt = String(opts.prompt ?? '');
  const attachments = Array.isArray(opts.attachments) ? opts.attachments : [];
  const submittedAt = String(opts.submittedAt ?? '').trim() || new Date().toISOString();
  return await requestJson<SendDroneChatPromptResponse>(
    `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/prompt`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, attachments, submittedAt }),
    },
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
  const data = await requestJson<{ ok: true; transcripts: TranscriptItem[] }>(
    `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/transcript?${qs.toString()}`,
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
  }
  const data = await requestJson<{ ok: true; transcripts: TranscriptItem[]; pending: PendingPrompt[] }>(
    `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/state?${qs.toString()}`,
  );
  return {
    transcripts: Array.isArray(data?.transcripts) ? data.transcripts : [],
    pending: Array.isArray(data?.pending) ? data.pending : [],
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
  const url = `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/transcript?${qs.toString()}`;
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
      const error = new Error(looksHtml ? buildUnexpectedHtmlError(url) : `Expected JSON from ${url}, but response was not valid JSON.`) as Error & {
        status?: number;
        data?: any;
      };
      error.status = response.status;
      throw error;
    }
  }
  if (!response.ok) {
    const error = new Error(data?.error ? String(data.error) : `${response.status} ${response.statusText}`) as Error & {
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
