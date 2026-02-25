import React from 'react';
import { stripAnsi, timeAgo } from '../../domain';
import type { TranscriptItem } from '../types';
import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';
import { CollapsibleMarkdown } from './CollapsibleMarkdown';
import { ImageAttachmentChips, isAttachmentOnlyPrompt, normalizeImageAttachmentRefs } from './ImageAttachmentChips';
import type { MarkdownFileReference } from './MarkdownMessage';
import { IconBot, IconImage, IconJobs, IconSpinner, IconTldr, IconUser } from './icons';

type TldrState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; summary: string }
  | { status: 'error'; error: string };

type InlineAgentImage = {
  id: string;
  src: string;
  linkHref: string | null;
  fileRef: MarkdownFileReference | null;
  label: string;
};

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'ico',
  'avif',
  'tif',
  'tiff',
]);

function imagePathHasKnownExtension(rawPath: string): boolean {
  const pathOnly = String(rawPath ?? '').split('?')[0].split('#')[0].trim();
  if (!pathOnly) return false;
  const decoded = (() => {
    try {
      return decodeURIComponent(pathOnly);
    } catch {
      return pathOnly;
    }
  })();
  const lower = decoded.toLowerCase();
  const slash = Math.max(lower.lastIndexOf('/'), lower.lastIndexOf('\\'));
  const base = slash >= 0 ? lower.slice(slash + 1) : lower;
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return false;
  const ext = base.slice(dot + 1);
  return IMAGE_EXTENSIONS.has(ext);
}

function normalizeInlineImageBasePath(rawBase: string | undefined): string {
  let base = String(rawBase ?? '').trim().replace(/\\/g, '/');
  if (!base) return '/work/repo';
  if (!base.startsWith('/')) base = `/${base.replace(/^\/+/, '')}`;
  base = base.replace(/\/+/g, '/');
  if (base.length > 1 && base.endsWith('/')) base = base.slice(0, -1);
  return base || '/work/repo';
}

function normalizeInlineImageFilePath(rawRef: string, basePathRaw?: string): string | null {
  const trimmed = String(rawRef ?? '').trim();
  if (!trimmed) return null;
  if (trimmed.includes('\0')) return null;
  if (/^https?:\/\//i.test(trimmed)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  if (trimmed.startsWith('~')) return null;

  let token = trimmed.replace(/\\/g, '/');
  const hashMatch = /^(.*)#L\d+(?:C\d+)?$/i.exec(token);
  if (hashMatch) token = String(hashMatch[1] ?? '').trim();
  const lineSuffix = /:(\d+)(?::(\d+))?$/.exec(token);
  if (lineSuffix && typeof lineSuffix.index === 'number') {
    token = token.slice(0, lineSuffix.index).trim();
  }

  if (!token) return null;
  if (token.startsWith('./')) token = token.slice(2);
  token = token.replace(/\/+/g, '/');
  if (!token) return null;
  if (token.includes('/../') || token.startsWith('../') || token.endsWith('/..')) return null;
  if (!imagePathHasKnownExtension(token)) return null;
  const basePath = normalizeInlineImageBasePath(basePathRaw);
  if (token.startsWith('/')) return token;
  if (token.startsWith('work/repo/') || token.startsWith('dvm-data/home/')) return `/${token}`;
  return `${basePath}/${token}`;
}

function inlineImageLabelFromPath(rawPath: string): string {
  const pathOnly = String(rawPath ?? '').split('?')[0].split('#')[0].trim();
  if (!pathOnly) return 'image';
  const slash = Math.max(pathOnly.lastIndexOf('/'), pathOnly.lastIndexOf('\\'));
  const base = slash >= 0 ? pathOnly.slice(slash + 1) : pathOnly;
  return base || pathOnly;
}

function imageHttpUrlLabel(u: URL): string {
  const fromPath = inlineImageLabelFromPath(u.pathname);
  if (fromPath && fromPath !== '/') return fromPath;
  return u.hostname || 'image';
}

function collectInlineAgentImages(textRaw: string, droneIdRaw?: string, basePathRaw?: string): InlineAgentImage[] {
  const text = String(textRaw ?? '');
  if (!text.trim()) return [];
  const droneId = String(droneIdRaw ?? '').trim();
  const out: InlineAgentImage[] = [];
  const seen = new Set<string>();
  const push = (entry: InlineAgentImage) => {
    if (!entry.src || seen.has(entry.src)) return;
    seen.add(entry.src);
    out.push(entry);
  };

  const urlCandidatePatterns = [/https?:\/\/[^\s<>()]+(?:\([^\s<>()]*\)[^\s<>()]*)*/gi];
  for (const pattern of urlCandidatePatterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = String(match[0] ?? '').trim();
      if (!raw) continue;
      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        continue;
      }
      const isImage =
        imagePathHasKnownExtension(parsed.pathname) ||
        imagePathHasKnownExtension(parsed.searchParams.get('path') ?? '') ||
        imagePathHasKnownExtension(parsed.searchParams.get('file') ?? '') ||
        imagePathHasKnownExtension(parsed.searchParams.get('url') ?? '');
      if (!isImage) continue;
      const href = parsed.toString();
      push({
        id: href,
        src: href,
        linkHref: href,
        fileRef: null,
        label: imageHttpUrlLabel(parsed),
      });
    }
  }

  const markdownHrefRegex = /\[[^\]]*]\(([^)\s]+)\)/g;
  for (const match of text.matchAll(markdownHrefRegex)) {
    const rawHref = String(match[1] ?? '').trim().replace(/^<|>$/g, '');
    if (!rawHref) continue;
    if (/^https?:\/\//i.test(rawHref)) {
      let parsed: URL;
      try {
        parsed = new URL(rawHref);
      } catch {
        continue;
      }
      const isImage =
        imagePathHasKnownExtension(parsed.pathname) ||
        imagePathHasKnownExtension(parsed.searchParams.get('path') ?? '') ||
        imagePathHasKnownExtension(parsed.searchParams.get('file') ?? '') ||
        imagePathHasKnownExtension(parsed.searchParams.get('url') ?? '');
      if (!isImage) continue;
      const href = parsed.toString();
      push({
        id: href,
        src: href,
        linkHref: href,
        fileRef: null,
        label: imageHttpUrlLabel(parsed),
      });
      continue;
    }
    if (!droneId) continue;
    const containerPath = normalizeInlineImageFilePath(rawHref, basePathRaw);
    if (!containerPath) continue;
    const src = `/api/drones/${encodeURIComponent(droneId)}/fs/media?path=${encodeURIComponent(containerPath)}`;
    push({
      id: `${droneId}:${containerPath}`,
      src,
      linkHref: rawHref,
      fileRef: { raw: rawHref, path: containerPath, line: null, column: null },
      label: inlineImageLabelFromPath(containerPath),
    });
  }

  const inlineCodeRegex = /`([^`\n]+)`/g;
  for (const match of text.matchAll(inlineCodeRegex)) {
    if (!droneId) continue;
    const raw = String(match[1] ?? '').trim();
    if (!raw) continue;
    const containerPath = normalizeInlineImageFilePath(raw, basePathRaw);
    if (!containerPath) continue;
    const src = `/api/drones/${encodeURIComponent(droneId)}/fs/media?path=${encodeURIComponent(containerPath)}`;
    push({
      id: `${droneId}:${containerPath}`,
      src,
      linkHref: raw,
      fileRef: { raw, path: containerPath, line: null, column: null },
      label: inlineImageLabelFromPath(containerPath),
    });
  }

  const bareImagePathRegex =
    /(?:^|[\s"'(<[{])((?:\.{1,2}\/)?(?:[^\s"'`<>()[\]{}:]+\/)*[^\s"'`<>()[\]{}:]+\.(?:png|jpg|jpeg|gif|webp|bmp|svg|ico|avif|tif|tiff)(?:\?[^\s"'`<>()[\]{}]+)?(?:#[^\s"'`<>()[\]{}]+)?)/gi;
  for (const match of text.matchAll(bareImagePathRegex)) {
    if (!droneId) continue;
    const rawPath = String(match[1] ?? '').trim();
    if (!rawPath) continue;
    const containerPath = normalizeInlineImageFilePath(rawPath, basePathRaw);
    if (!containerPath) continue;
    const src = `/api/drones/${encodeURIComponent(droneId)}/fs/media?path=${encodeURIComponent(containerPath)}`;
    push({
      id: `${droneId}:${containerPath}`,
      src,
      linkHref: rawPath,
      fileRef: { raw: rawPath, path: containerPath, line: null, column: null },
      label: inlineImageLabelFromPath(containerPath),
    });
  }

  return out.slice(0, 8);
}

function sameAttachments(aRaw: unknown, bRaw: unknown): boolean {
  const a = normalizeImageAttachmentRefs(aRaw);
  const b = normalizeImageAttachmentRefs(bRaw);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (left.name !== right.name) return false;
    if (left.mime !== right.mime) return false;
    if (left.size !== right.size) return false;
    if (String(left.path ?? '') !== String(right.path ?? '')) return false;
    if (String(left.relativePath ?? '') !== String(right.relativePath ?? '')) return false;
  }
  return true;
}

export const TranscriptTurn = React.memo(
  function TranscriptTurn({
    item,
    nowMs,
    parsingJobs,
    onCreateJobs,
    messageId,
    tldr,
    showTldr,
    onToggleTldr,
    onHoverAgentMessage,
    onOpenFileReference,
    onOpenLink,
    droneId,
    droneHomePath,
    showRoleIcons = true,
  }: {
    item: TranscriptItem;
    nowMs: number;
    parsingJobs: boolean;
    onCreateJobs: (opts: { turn: number; message: string }) => void;
    messageId: string;
    tldr: TldrState | null;
    showTldr: boolean;
    onToggleTldr: (item: TranscriptItem) => void;
    onHoverAgentMessage: (item: TranscriptItem | null) => void;
    onOpenFileReference?: (ref: MarkdownFileReference) => void;
    onOpenLink?: (href: string) => boolean;
    droneId?: string;
    droneHomePath?: string;
    showRoleIcons?: boolean;
  }) {
    const transcriptInlineImages = useDroneHubUiStore((s) => s.transcriptInlineImages);
    const inlineImagesOverride = useDroneHubUiStore((s) => s.transcriptInlineImageOverrides[messageId]);
    const setInlineImagesOverride = useDroneHubUiStore((s) => s.setTranscriptInlineImageOverride);
    const attachments = normalizeImageAttachmentRefs((item as any).attachments);
    const promptText = isAttachmentOnlyPrompt(item.prompt, attachments) ? '' : item.prompt;
    const cleaned = item.ok ? stripAnsi(item.output) : stripAnsi(item.error || 'failed');
    const promptIso = item.promptAt || item.at;
    const agentIso = item.completedAt || item.at;
    const tldrStatus = tldr?.status ?? 'idle';
    const tldrLoading = tldrStatus === 'loading';
    const tldrError = tldr && tldr.status === 'error' ? tldr.error : '';
    const tldrSummary = tldr && tldr.status === 'ready' ? tldr.summary : '';
    const showingTldr = Boolean(showTldr);
    const displayedText = showingTldr
      ? tldrStatus === 'ready'
        ? tldrSummary
        : tldrStatus === 'error'
          ? `TLDR failed: ${tldrError || 'unknown error'}`
          : 'Generating TLDR…'
      : cleaned;
    const inlineImages = React.useMemo(
      () => collectInlineAgentImages(cleaned, droneId, droneHomePath),
      [cleaned, droneId, droneHomePath],
    );
    const [failedInlineImagesById, setFailedInlineImagesById] = React.useState<Record<string, true>>({});
    const showInlineImages = Boolean(
      inlineImages.length > 0 &&
        (typeof inlineImagesOverride === 'boolean' ? inlineImagesOverride : transcriptInlineImages),
    );
    const openInlineImageTarget = React.useCallback(
      (image: InlineAgentImage) => {
        if (image.fileRef && onOpenFileReference) {
          onOpenFileReference(image.fileRef);
          return;
        }
        const target = String(image.linkHref ?? image.src ?? '').trim();
        if (!target) return;
        if (onOpenLink) {
          const handled = Boolean(onOpenLink(target));
          if (handled) return;
        }
        window.open(target, '_blank', 'noopener,noreferrer');
      },
      [onOpenFileReference, onOpenLink],
    );
    React.useEffect(() => {
      setFailedInlineImagesById({});
    }, [messageId]);
    return (
      <div className="animate-fade-in">
        {/* User message */}
        <div className="flex justify-end mb-3">
          <div className={`${showRoleIcons ? 'max-w-[85%]' : 'max-w-full'} min-w-[120px]`}>
            <div className="flex items-center justify-end gap-2 mb-1.5">
              <span className="text-[9px] leading-none text-[var(--muted-dim)] font-mono"
                title={new Date(promptIso).toLocaleString()}
              >
                {timeAgo(promptIso, nowMs)}
              </span>
              <span
                className="text-[10px] font-semibold text-[var(--user-muted)] tracking-wide uppercase"
                style={{ fontFamily: 'var(--display)' }}
              >
                You
              </span>
            </div>
            <div className="bg-[var(--user-dim)] border border-[rgba(148,163,184,.14)] rounded-lg rounded-tr-sm px-4 py-3">
              {promptText ? (
                <CollapsibleMarkdown
                  text={promptText}
                  fadeTo="var(--user-dim)"
                  className="dh-markdown--user"
                  onOpenFileReference={onOpenFileReference}
                  onOpenLink={onOpenLink}
                />
              ) : null}
              <ImageAttachmentChips
                attachments={attachments}
                droneId={droneId}
                droneHomePath={droneHomePath}
                onOpenFileReference={onOpenFileReference}
              />
            </div>
          </div>
          {showRoleIcons && (
            <div className="flex-shrink-0 w-7 h-7 rounded bg-[var(--user-subtle)] border border-[rgba(148,163,184,.15)] flex items-center justify-center mt-6 ml-3">
              <IconUser className="text-[var(--user)] w-3.5 h-3.5" />
            </div>
          )}
        </div>

        {/* Agent response */}
        <div className={showRoleIcons ? 'flex gap-3' : 'flex'}>
          {showRoleIcons && (
            <div className="flex-shrink-0 w-7 h-7 rounded bg-[var(--accent-subtle)] border border-[rgba(167,139,250,.15)] flex items-center justify-center mt-6">
              <IconBot className="text-[var(--accent)] w-3.5 h-3.5" />
            </div>
          )}
          <div className={`${showRoleIcons ? 'max-w-[85%]' : 'max-w-full'} min-w-[120px]`}>
            <div className="flex items-center justify-between mb-1.5">
              <span
                className="text-[10px] font-semibold text-[var(--accent)] tracking-wide uppercase"
                style={{ fontFamily: 'var(--display)' }}
              >
                Agent
              </span>
              <span className="text-[9px] leading-none text-[var(--muted-dim)] font-mono"
                title={new Date(agentIso).toLocaleString()}
              >
                {timeAgo(agentIso, nowMs)}
              </span>
            </div>
            <div
              className={`border rounded-lg rounded-tl-sm px-4 py-3 relative group ${
                item.ok
                  ? 'bg-[var(--accent-subtle)] border-[rgba(167,139,250,.12)]'
                  : 'bg-[var(--red-subtle)] border-[rgba(255,90,90,.2)]'
              }`}
              onMouseEnter={() => onHoverAgentMessage(item)}
              onMouseLeave={() => onHoverAgentMessage(null)}
              data-message-id={messageId}
            >
              <CollapsibleMarkdown
                text={displayedText}
                fadeTo={item.ok ? 'var(--accent-subtle)' : 'var(--red-subtle)'}
                className={showingTldr ? 'dh-markdown--muted' : item.ok ? 'dh-markdown--agent' : 'dh-markdown--error'}
                preserveLeadParagraph
                onOpenFileReference={onOpenFileReference}
                onOpenLink={onOpenLink}
              />
              {showInlineImages && (
                <div className="mt-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
                    {inlineImages.map((image) => (
                      <button
                        key={image.id}
                        type="button"
                        onClick={() => openInlineImageTarget(image)}
                        className="block rounded-md bg-[rgba(0,0,0,.16)] overflow-hidden"
                        title={`Open ${image.label} from message link`}
                      >
                        {failedInlineImagesById[image.id] ? (
                          <div className="min-h-[120px] flex items-center justify-center text-[11px] text-[var(--muted)] px-3 text-center">
                            Failed to load image.
                          </div>
                        ) : (
                          <img
                            src={image.src}
                            alt={image.label}
                            loading="lazy"
                            className="w-full h-auto max-h-[340px] object-contain bg-[var(--panel)]"
                            onError={() =>
                              setFailedInlineImagesById((prev) => ({
                                ...prev,
                                [image.id]: true,
                              }))
                            }
                          />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="absolute bottom-2 right-2 flex items-center gap-1">
                {inlineImages.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setInlineImagesOverride(
                        messageId,
                        !(typeof inlineImagesOverride === 'boolean' ? inlineImagesOverride : transcriptInlineImages),
                      )
                    }
                    disabled={false}
                    className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-opacity ${
                      showInlineImages ? 'text-[var(--accent)] border-[var(--accent-muted)] bg-[rgba(0,0,0,.25)]' : 'text-[var(--muted)] border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)]'
                    } opacity-0 group-hover:opacity-100 hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[rgba(0,0,0,.25)]`}
                    title={`${showInlineImages ? 'Hide' : 'Show'} inline images${transcriptInlineImages ? ' (global default on)' : ''}`}
                    aria-label="Toggle inline images"
                  >
                    <IconImage className="w-3.5 h-3.5 opacity-90" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onToggleTldr(item)}
                  disabled={false}
                  className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-opacity ${
                    tldrLoading ? 'opacity-100 cursor-wait' : 'opacity-0 group-hover:opacity-100'
                  } ${
                    showingTldr ? 'text-[var(--accent)] border-[var(--accent-muted)] bg-[rgba(0,0,0,.25)]' : 'text-[var(--muted)] border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)]'
                  } hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[rgba(0,0,0,.25)]`}
                  title={
                    tldrStatus === 'error'
                      ? `TLDR failed: ${tldrError || 'unknown error'}`
                      : showingTldr
                        ? 'Show original (W)'
                        : 'Generate/show TLDR (W)'
                  }
                  aria-label="Toggle TLDR"
                >
                  {tldrLoading ? <IconSpinner className="w-3.5 h-3.5 text-[var(--accent)]" /> : <IconTldr className="w-3.5 h-3.5 opacity-90" />}
                </button>

                {item.ok && (
                  <button
                    type="button"
                    onClick={() => onCreateJobs({ turn: item.turn, message: cleaned })}
                    disabled={parsingJobs}
                    className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-opacity ${
                      parsingJobs ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    } ${
                      parsingJobs ? 'cursor-wait' : ''
                    } bg-[rgba(0,0,0,.15)] border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent-muted)] hover:bg-[rgba(0,0,0,.25)]`}
                    title="Create jobs from this agent message"
                    aria-label="Create jobs from this agent message"
                  >
                    {parsingJobs ? <IconSpinner className="w-3.5 h-3.5 text-[var(--accent)]" /> : <IconJobs className="w-3.5 h-3.5 opacity-90" />}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  },
  (a, b) =>
    a.item.turn === b.item.turn &&
    a.item.at === b.item.at &&
    a.item.ok === b.item.ok &&
    a.item.prompt === b.item.prompt &&
    a.item.session === b.item.session &&
    a.item.logPath === b.item.logPath &&
    a.item.output === b.item.output &&
    (a.item.error ?? '') === (b.item.error ?? '') &&
    a.parsingJobs === b.parsingJobs &&
    a.onCreateJobs === b.onCreateJobs &&
    a.messageId === b.messageId &&
    a.showTldr === b.showTldr &&
    (a.tldr?.status ?? 'idle') === (b.tldr?.status ?? 'idle') &&
    ((a.tldr && a.tldr.status === 'ready' ? a.tldr.summary : '') === (b.tldr && b.tldr.status === 'ready' ? b.tldr.summary : '')) &&
    ((a.tldr && a.tldr.status === 'error' ? a.tldr.error : '') === (b.tldr && b.tldr.status === 'error' ? b.tldr.error : '')) &&
    a.onToggleTldr === b.onToggleTldr &&
    a.onHoverAgentMessage === b.onHoverAgentMessage &&
    a.onOpenFileReference === b.onOpenFileReference &&
    a.onOpenLink === b.onOpenLink &&
    (a.droneId ?? '') === (b.droneId ?? '') &&
    (a.droneHomePath ?? '') === (b.droneHomePath ?? '') &&
    sameAttachments((a.item as any).attachments, (b.item as any).attachments) &&
    (a.showRoleIcons ?? true) === (b.showRoleIcons ?? true),
);
