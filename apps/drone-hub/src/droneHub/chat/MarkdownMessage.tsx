import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type CalloutKind = 'note' | 'tip' | 'important' | 'warning' | 'caution';
const COMMON_FILE_BASENAMES = new Set([
  'dockerfile',
  'makefile',
  'readme',
  'readme.md',
  'license',
  'license.md',
  'package.json',
  'tsconfig.json',
  '.gitignore',
  'agents.md',
]);

const CALLOUT_LABEL: Record<CalloutKind, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

function flattenText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((part) => flattenText(part)).join('');
  if (React.isValidElement(node)) {
    return flattenText((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}

function detectCalloutKind(node: React.ReactNode): CalloutKind | null {
  const text = flattenText(node).trimStart();
  const m = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.exec(text);
  if (!m) return null;
  return String(m[1]).toLowerCase() as CalloutKind;
}

function stripLeadingCalloutMarker(node: React.ReactNode): React.ReactNode {
  let stripped = false;
  const marker = /^\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;

  const strip = (value: React.ReactNode): React.ReactNode => {
    if (value == null || typeof value === 'boolean') return value;
    if (typeof value === 'string' || typeof value === 'number') {
      const raw = String(value);
      if (stripped) return raw;
      const next = raw.replace(marker, '');
      if (next !== raw) stripped = true;
      return next;
    }
    if (Array.isArray(value)) return value.map((part) => strip(part));
    if (React.isValidElement(value)) {
      const child = (value.props as { children?: React.ReactNode }).children;
      return React.cloneElement(value as React.ReactElement<any>, undefined, strip(child));
    }
    return value;
  };

  return strip(node);
}

function parseInlineCodeLinkHref(raw: string): string | null {
  const candidate = String(raw ?? '').trim();
  if (!/^https?:\/\/\S+$/i.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export type MarkdownFileReference = {
  raw: string;
  path: string;
  line: number | null;
  column: number | null;
};

function isLikelyFilePath(raw: string): boolean {
  const candidate = String(raw ?? '').trim();
  if (!candidate || /\s/.test(candidate) || candidate.includes('\0')) return false;
  if (candidate.startsWith('~')) return false;
  if (/^https?:\/\//i.test(candidate)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) return false;
  const normalized = candidate.replace(/\\/g, '/');
  const segs = normalized.split('/').filter(Boolean);
  if (segs.some((seg) => seg === '..')) return false;
  const base = (segs.length ? segs[segs.length - 1] : normalized).toLowerCase();
  if (COMMON_FILE_BASENAMES.has(base)) return true;
  if (normalized.includes('/')) return true;
  if (/\.[a-z0-9_-]{1,12}$/i.test(base)) return true;
  return false;
}

function parsePositiveInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function normalizeFileRefPath(raw: string): string {
  let next = String(raw ?? '').trim().replace(/\\/g, '/');
  if (next.startsWith('./')) next = next.slice(2);
  next = next.replace(/\/+/g, '/');
  if (next.length > 1 && next.endsWith('/')) next = next.slice(0, -1);
  return next;
}

function parseInlineCodeFileReference(raw: string): MarkdownFileReference | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  let pathToken = text;
  let line: number | null = null;
  let column: number | null = null;

  const hashMatch = /^(.*)#L(\d+)(?:C(\d+))?$/i.exec(pathToken);
  if (hashMatch) {
    pathToken = String(hashMatch[1] ?? '').trim();
    line = parsePositiveInt(hashMatch[2]);
    column = parsePositiveInt(hashMatch[3]);
  } else {
    const lineSuffix = /:(\d+)(?::(\d+))?$/.exec(pathToken);
    if (lineSuffix && typeof lineSuffix.index === 'number') {
      const maybePath = pathToken.slice(0, lineSuffix.index).trim();
      if (isLikelyFilePath(maybePath)) {
        pathToken = maybePath;
        line = parsePositiveInt(lineSuffix[1]);
        column = parsePositiveInt(lineSuffix[2]);
      }
    }
  }

  if (!isLikelyFilePath(pathToken)) return null;
  const normalizedPath = normalizeFileRefPath(pathToken);
  if (!normalizedPath || normalizedPath === '/' || normalizedPath.includes('/../') || normalizedPath.startsWith('../') || normalizedPath.startsWith('/..')) {
    return null;
  }
  return { raw: text, path: normalizedPath, line, column };
}

export function MarkdownMessage({
  text,
  className,
  onOpenFileReference,
  onOpenLink,
}: {
  text: string;
  className?: string;
  onOpenFileReference?: (ref: MarkdownFileReference) => void;
  onOpenLink?: (href: string) => boolean;
}) {
  const handleAnchorClick = React.useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, hrefText: string) => {
      if (!onOpenLink || !hrefText) return;
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        window.open(hrefText, '_blank', 'noopener,noreferrer');
        return;
      }
      if (event.shiftKey || event.altKey) return;
      const handled = Boolean(onOpenLink(hrefText));
      if (handled) event.preventDefault();
    },
    [onOpenLink],
  );

  return (
    <div className={`dh-markdown ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }) => {
            const hrefText = typeof href === 'string' ? href : '';
            return (
              <a
                href={hrefText}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => handleAnchorClick(event, hrefText)}
                {...props}
              >
                {children}
              </a>
            );
          },
          code: ({ children, className: codeClassName, ...props }) => {
            const raw = flattenText(children);
            const hasLanguageClass = typeof codeClassName === 'string' && codeClassName.includes('language-');
            const isInline = !hasLanguageClass && !raw.includes('\n');
            const href = isInline ? parseInlineCodeLinkHref(raw) : null;
            if (href) {
              return (
                <a
                  className="dh-inline-code-link"
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open link ${href}`}
                  onClick={(event) => handleAnchorClick(event, href)}
                >
                  <code className={codeClassName} {...props}>
                    {raw}
                  </code>
                </a>
              );
            }
            const fileRef = isInline ? parseInlineCodeFileReference(raw) : null;
            if (fileRef && onOpenFileReference) {
              const targetDescription =
                fileRef.line == null
                  ? fileRef.path
                  : `${fileRef.path}:${fileRef.line}${fileRef.column == null ? '' : `:${fileRef.column}`}`;
              return (
                <button
                  type="button"
                  className="dh-inline-code-file-link"
                  onClick={() => onOpenFileReference(fileRef)}
                  title={`Open ${targetDescription}`}
                  aria-label={`Open file ${targetDescription}`}
                >
                  <code className={codeClassName} {...props}>
                    {raw}
                  </code>
                </button>
              );
            }
            return (
              <code className={codeClassName} {...props}>
                {children}
              </code>
            );
          },
          blockquote: ({ children, ...props }) => {
            const kind = detectCalloutKind(children);
            const cleanedChildren = kind ? stripLeadingCalloutMarker(children) : children;
            return (
              <blockquote data-callout={kind ?? undefined} {...props}>
                {kind ? (
                  <span className="dh-markdown-callout-label" aria-label={`${CALLOUT_LABEL[kind]} callout`}>
                    {CALLOUT_LABEL[kind]}
                  </span>
                ) : null}
                {cleanedChildren}
              </blockquote>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
