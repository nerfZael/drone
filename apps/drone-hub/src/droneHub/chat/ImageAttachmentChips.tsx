import React from 'react';
import type { ChatImageAttachmentRef } from '../types';
import type { MarkdownFileReference } from './MarkdownMessage';

function formatBytes(raw: number): string {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let value = n;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const shown = idx === 0 ? String(Math.floor(value)) : value.toFixed(value >= 10 ? 1 : 2);
  return `${shown} ${units[idx]}`;
}

function normalizePath(raw: string): string {
  const s = String(raw ?? '').trim().replace(/\\/g, '/');
  if (!s) return '';
  return s.replace(/\/+/g, '/');
}

export function normalizeImageAttachmentRefs(raw: unknown): ChatImageAttachmentRef[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: ChatImageAttachmentRef[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const name = String((item as any).name ?? '').trim();
    const mime = String((item as any).mime ?? '').trim().toLowerCase();
    const sizeNum = Number((item as any).size ?? 0);
    if (!name || !mime.startsWith('image/') || !Number.isFinite(sizeNum) || sizeNum <= 0) continue;
    const path = normalizePath((item as any).path ?? '');
    const relativePath = normalizePath((item as any).relativePath ?? '');
    out.push({
      name,
      mime,
      size: Math.floor(sizeNum),
      ...(path ? { path } : {}),
      ...(relativePath ? { relativePath } : {}),
    });
  }
  return out.slice(0, 8);
}

export function isAttachmentOnlyPrompt(promptRaw: string, attachments: ChatImageAttachmentRef[]): boolean {
  const prompt = String(promptRaw ?? '').trim();
  if (!prompt || attachments.length === 0) return false;
  if (prompt === '[image attachment]') return attachments.length === 1;
  const match = /^\[(\d+)\s+image attachments\]$/i.exec(prompt);
  if (!match) return false;
  return Number(match[1]) === attachments.length;
}

function toFileRef(pathRaw: string): MarkdownFileReference | null {
  const path = normalizePath(pathRaw);
  if (!path) return null;
  return { raw: path, path, line: null, column: null };
}

export function ImageAttachmentChips({
  attachments,
  onOpenFileReference,
}: {
  attachments: ChatImageAttachmentRef[];
  onOpenFileReference?: (ref: MarkdownFileReference) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {attachments.map((a, idx) => {
        const targetPath = String(a.path ?? a.relativePath ?? '').trim();
        const fileRef = toFileRef(targetPath);
        const fileLabel = String(a.relativePath ?? a.path ?? '').trim();
        return (
          <div
            key={`${a.name}:${a.size}:${idx}`}
            className="inline-flex max-w-full items-center gap-1.5 rounded border border-[rgba(148,163,184,.2)] bg-[rgba(255,255,255,.03)] px-2 py-1 text-[10px]"
          >
            <span className="truncate max-w-[220px]">{a.name}</span>
            <span className="text-[var(--muted-dim)]">{formatBytes(a.size)}</span>
            {fileRef && onOpenFileReference ? (
              <button
                type="button"
                className="inline-flex items-center rounded border border-[var(--border-subtle)] px-1 text-[9px] uppercase tracking-wide text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]"
                style={{ fontFamily: 'var(--display)' }}
                onClick={() => onOpenFileReference(fileRef)}
                title={fileLabel ? `Open ${fileLabel}` : 'Open attachment'}
              >
                Open
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
