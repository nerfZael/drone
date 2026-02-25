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

function normalizeBasePath(raw: string | undefined): string {
  let base = normalizePath(raw ?? '');
  if (!base) return '/work/repo';
  if (!base.startsWith('/')) base = `/${base}`;
  if (base.length > 1 && base.endsWith('/')) base = base.slice(0, -1);
  return base || '/work/repo';
}

function resolveAttachmentPath(relativePathRaw: string | undefined, droneHomePathRaw?: string): string {
  const rel = normalizePath(relativePathRaw ?? '');
  if (!rel || rel.startsWith('/')) return '';
  if (rel.startsWith('../') || rel.endsWith('/..') || rel.includes('/../')) return '';
  const base = normalizeBasePath(droneHomePathRaw);
  return `${base}/${rel}`.replace(/\/+/g, '/');
}

function alternateHomePath(rawPath: string): string {
  const p = normalizePath(rawPath);
  if (!p.startsWith('/')) return '';
  if (p === '/work/repo' || p.startsWith('/work/repo/')) {
    const suffix = p.slice('/work/repo'.length);
    return `/dvm-data/home${suffix}`;
  }
  if (p === '/dvm-data/home' || p.startsWith('/dvm-data/home/')) {
    const suffix = p.slice('/dvm-data/home'.length);
    return `/work/repo${suffix}`;
  }
  return '';
}

export function normalizeImageAttachmentRefs(raw: unknown): ChatImageAttachmentRef[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: ChatImageAttachmentRef[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const name = String((item as any).name ?? '').trim();
    const mime = String((item as any).mime ?? '').trim().toLowerCase();
    const sizeNum = Number((item as any).size ?? 0);
    const previewDataUrl = String((item as any).previewDataUrl ?? '').trim();
    if (!name || !mime.startsWith('image/') || !Number.isFinite(sizeNum) || sizeNum <= 0) continue;
    const path = normalizePath((item as any).path ?? '');
    const relativePath = normalizePath((item as any).relativePath ?? '');
    out.push({
      name,
      mime,
      size: Math.floor(sizeNum),
      ...(path ? { path } : {}),
      ...(relativePath ? { relativePath } : {}),
      ...(previewDataUrl ? { previewDataUrl } : {}),
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
  droneId,
  droneHomePath,
  onOpenFileReference,
}: {
  attachments: ChatImageAttachmentRef[];
  droneId?: string;
  droneHomePath?: string;
  onOpenFileReference?: (ref: MarkdownFileReference) => void;
}) {
  if (attachments.length === 0) return null;
  const [thumbFailCountByKey, setThumbFailCountByKey] = React.useState<Record<string, number>>({});
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {attachments.map((a, idx) => {
        const key = `${a.name}:${a.size}:${a.path ?? ''}:${a.relativePath ?? ''}:${idx}`;
        const previewDataUrlRaw = String((a as any).previewDataUrl ?? '').trim();
        const hasPreviewDataUrl = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(previewDataUrlRaw);
        const pathFromRelative = resolveAttachmentPath(a.relativePath, droneHomePath);
        const absolutePath = normalizePath(a.path ?? '');
        const path = pathFromRelative || absolutePath;
        const altPath = alternateHomePath(path);
        const srcCandidates: string[] = [];
        if (hasPreviewDataUrl) srcCandidates.push(previewDataUrlRaw);
        if (droneId && path) {
          srcCandidates.push(`/api/drones/${encodeURIComponent(droneId)}/fs/thumb?path=${encodeURIComponent(path)}`);
          srcCandidates.push(`/api/drones/${encodeURIComponent(droneId)}/fs/media?path=${encodeURIComponent(path)}`);
          if (altPath && altPath !== path) {
            srcCandidates.push(`/api/drones/${encodeURIComponent(droneId)}/fs/thumb?path=${encodeURIComponent(altPath)}`);
            srcCandidates.push(`/api/drones/${encodeURIComponent(droneId)}/fs/media?path=${encodeURIComponent(altPath)}`);
          }
        }
        const srcList = Array.from(new Set(srcCandidates.filter(Boolean)));
        const failCount = Math.max(0, Math.floor(Number(thumbFailCountByKey[key] ?? 0)));
        const thumbSrc = failCount < srcList.length ? srcList[failCount] : '';
        const showThumb = Boolean(thumbSrc);
        const targetPath = String(path || a.path || a.relativePath || '').trim();
        const fileRef = toFileRef(targetPath);
        const fileLabel = String(a.relativePath ?? path ?? a.path ?? '').trim();
        return (
          <div
            key={key}
            className="inline-flex max-w-full items-center gap-1.5 rounded border border-[rgba(148,163,184,.2)] bg-[rgba(255,255,255,.03)] px-2 py-1 text-[10px]"
          >
            {showThumb ? (
              <img
                src={thumbSrc}
                alt={a.name}
                loading="lazy"
                className="w-12 h-12 rounded object-cover border border-[rgba(148,163,184,.2)] bg-[rgba(0,0,0,.18)] flex-shrink-0"
                onError={() =>
                  setThumbFailCountByKey((prev) => {
                    const cur = Math.max(0, Math.floor(Number(prev[key] ?? 0)));
                    if (cur >= srcList.length) return prev;
                    return { ...prev, [key]: cur + 1 };
                  })
                }
              />
            ) : null}
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
