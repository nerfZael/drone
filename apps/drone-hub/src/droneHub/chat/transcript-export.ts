import { stripAnsi } from '../../domain';
import type { ChatImageAttachmentRef, TranscriptItem } from '../types';

type TranscriptExportAttachment = {
  name: string;
  mime: string;
  size: number;
  fileName?: string;
  path?: string;
  relativePath?: string;
};

type TranscriptExportTurn = {
  turn: number;
  id?: string;
  at: string;
  promptAt?: string;
  completedAt?: string;
  session?: string;
  logPath?: string;
  user: {
    role: 'user';
    text: string;
    attachments: TranscriptExportAttachment[];
  };
  agent: {
    role: 'agent';
    status: 'ok' | 'error';
    text: string;
  };
};

export type TranscriptExportPayload = {
  format: 'drone-hub-transcript';
  version: 1;
  exportedAt: string;
  drone: {
    id: string;
    name: string;
    label?: string;
  };
  chat: {
    name: string;
  };
  turns: TranscriptExportTurn[];
};

function cleanText(raw: string | null | undefined): string {
  return stripAnsi(String(raw ?? ''));
}

function formatBytes(raw: number): string {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = n;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const shown = index === 0 ? String(Math.floor(value)) : value.toFixed(value >= 10 ? 1 : 2);
  return `${shown} ${units[index]}`;
}

function normalizeAttachment(item: ChatImageAttachmentRef): TranscriptExportAttachment {
  const name = String(item?.name ?? '').trim() || 'attachment';
  const mime = String(item?.mime ?? '').trim() || 'application/octet-stream';
  const size = Math.max(0, Math.floor(Number(item?.size ?? 0) || 0));
  const fileName = String((item as any)?.fileName ?? '').trim();
  const path = String(item?.path ?? '').trim();
  const relativePath = String(item?.relativePath ?? '').trim();
  return {
    name,
    mime,
    size,
    ...(fileName ? { fileName } : {}),
    ...(path ? { path } : {}),
    ...(relativePath ? { relativePath } : {}),
  };
}

function normalizeTurn(item: TranscriptItem): TranscriptExportTurn {
  const status = item.ok ? 'ok' : 'error';
  const attachments = Array.isArray(item.attachments) ? item.attachments.map(normalizeAttachment) : [];
  const promptAt = String(item.promptAt ?? '').trim();
  const completedAt = String(item.completedAt ?? '').trim();
  const id = String(item.id ?? '').trim();
  const session = String((item as any)?.session ?? '').trim();
  const logPath = String((item as any)?.logPath ?? '').trim();
  return {
    turn: Number(item.turn ?? 0) || 0,
    at: String(item.at ?? ''),
    ...(promptAt ? { promptAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(id ? { id } : {}),
    ...(session ? { session } : {}),
    ...(logPath ? { logPath } : {}),
    user: {
      role: 'user',
      text: cleanText(item.prompt),
      attachments,
    },
    agent: {
      role: 'agent',
      status,
      text: cleanText(item.ok ? item.output : item.error),
    },
  };
}

export function buildTranscriptExportPayload(args: {
  droneId: string;
  droneName: string;
  droneLabel?: string;
  chatName: string;
  exportedAt?: string;
  transcripts: TranscriptItem[];
}): TranscriptExportPayload {
  const exportedAt = String(args.exportedAt ?? '').trim() || new Date().toISOString();
  const droneId = String(args.droneId ?? '').trim();
  const droneName = String(args.droneName ?? '').trim();
  const droneLabel = String(args.droneLabel ?? '').trim();
  const chatName = String(args.chatName ?? '').trim() || 'default';
  const transcripts = Array.isArray(args.transcripts) ? args.transcripts : [];
  return {
    format: 'drone-hub-transcript',
    version: 1,
    exportedAt,
    drone: {
      id: droneId,
      name: droneName,
      ...(droneLabel && droneLabel !== droneName ? { label: droneLabel } : {}),
    },
    chat: {
      name: chatName,
    },
    turns: transcripts.map(normalizeTurn),
  };
}

function displayDroneName(payload: TranscriptExportPayload): string {
  return String(payload.drone.label ?? payload.drone.name ?? payload.drone.id ?? '').trim() || 'Unknown drone';
}

function sanitizeFileSegment(raw: string, fallback: string): string {
  const cleaned = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function describeAttachment(a: TranscriptExportAttachment): string {
  const suffix: string[] = [];
  if (a.mime) suffix.push(a.mime);
  suffix.push(formatBytes(a.size));
  const ref = String(a.relativePath ?? a.path ?? '').trim();
  if (ref) suffix.push(ref);
  return `- ${a.name}${suffix.length > 0 ? ` (${suffix.join(', ')})` : ''}`;
}

function markdownSectionBody(text: string, emptyLabel: string): string {
  const content = String(text ?? '');
  return content.trim() ? content : `_${emptyLabel}_`;
}

export function formatTranscriptMarkdown(args: {
  droneId: string;
  droneName: string;
  droneLabel?: string;
  chatName: string;
  exportedAt?: string;
  transcripts: TranscriptItem[];
}): string {
  const payload = buildTranscriptExportPayload(args);
  const lines: string[] = [
    '# Drone Transcript',
    '',
    `- Drone: ${displayDroneName(payload)}`,
    `- Drone ID: ${payload.drone.id}`,
    `- Chat: ${payload.chat.name}`,
    `- Exported: ${payload.exportedAt}`,
    `- Turns: ${payload.turns.length}`,
  ];
  for (const turn of payload.turns) {
    lines.push('', `## Turn ${turn.turn}`, '');
    lines.push(`- Prompted: ${turn.promptAt || turn.at}`);
    if (turn.completedAt) lines.push(`- Completed: ${turn.completedAt}`);
    lines.push(`- Agent status: ${turn.agent.status}`);
    lines.push('', '### User', '', markdownSectionBody(turn.user.text, 'No user text.'));
    if (turn.user.attachments.length > 0) {
      lines.push('', '#### Attachments', '');
      for (const attachment of turn.user.attachments) lines.push(describeAttachment(attachment));
    }
    lines.push('', turn.agent.status === 'error' ? '### Agent Error' : '### Agent', '', markdownSectionBody(turn.agent.text, 'No agent text.'));
  }
  return `${lines.join('\n').trim()}\n`;
}

export function formatTranscriptJson(args: {
  droneId: string;
  droneName: string;
  droneLabel?: string;
  chatName: string;
  exportedAt?: string;
  transcripts: TranscriptItem[];
}): string {
  return `${JSON.stringify(buildTranscriptExportPayload(args), null, 2)}\n`;
}

export function buildTranscriptExportFilename(args: {
  droneLabel?: string;
  droneName?: string;
  chatName: string;
  exportedAt?: string;
  extension: 'json' | 'md';
}): string {
  const exportedAt = String(args.exportedAt ?? '').trim() || new Date().toISOString();
  const stamp = exportedAt.replace(/[:]/g, '-');
  const droneSegment = sanitizeFileSegment(args.droneLabel || args.droneName || 'drone', 'drone');
  const chatSegment = sanitizeFileSegment(args.chatName || 'default', 'default');
  return `${droneSegment}-${chatSegment}-transcript-${stamp}.${args.extension}`;
}
