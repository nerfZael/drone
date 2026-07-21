import React from 'react';

import { ChatMessageCopyAction } from './ChatMessageCopyAction';
import { CollapsibleMarkdown } from './CollapsibleMarkdown';
import type { MarkdownFileReference, MarkdownTextMentionLink } from './MarkdownMessage';

export type ChatMessageImage = {
  key: string;
  src: string;
  alt: string;
};

function fenceMarker(line: string): { character: '`' | '~'; length: number } | null {
  const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
  const marker = match?.[1] ?? '';
  const character = marker[0];
  if (character !== '`' && character !== '~') return null;
  return { character, length: marker.length };
}

function stripMarkdownImagesFromLine(
  line: string,
  renderedImageHrefs: ReadonlySet<string> | null,
): string {
  let output = '';
  let cursor = 0;
  let codeMarkerLength = 0;

  while (cursor < line.length) {
    if (line[cursor] === '`') {
      let markerEnd = cursor + 1;
      while (line[markerEnd] === '`') markerEnd += 1;
      const markerLength = markerEnd - cursor;
      if (codeMarkerLength === 0) codeMarkerLength = markerLength;
      else if (codeMarkerLength === markerLength) codeMarkerLength = 0;
      output += line.slice(cursor, markerEnd);
      cursor = markerEnd;
      continue;
    }

    if (codeMarkerLength > 0 || line[cursor] !== '!' || line[cursor + 1] !== '[') {
      output += line[cursor];
      cursor += 1;
      continue;
    }

    let labelEnd = cursor + 2;
    for (; labelEnd < line.length; labelEnd += 1) {
      if (line[labelEnd] !== ']') continue;
      let backslashCount = 0;
      for (let i = labelEnd - 1; i >= 0 && line[i] === '\\'; i -= 1) backslashCount += 1;
      if (backslashCount % 2 === 0) break;
    }
    if (labelEnd >= line.length) {
      output += line[cursor];
      cursor += 1;
      continue;
    }

    let destinationStart = labelEnd + 1;
    while (line[destinationStart] === ' ' || line[destinationStart] === '\t') destinationStart += 1;
    if (line[destinationStart] !== '(') {
      output += line[cursor];
      cursor += 1;
      continue;
    }

    let depth = 1;
    let destinationEnd = destinationStart + 1;
    for (; destinationEnd < line.length; destinationEnd += 1) {
      if (line[destinationEnd] === '\\') {
        destinationEnd += 1;
        continue;
      }
      if (line[destinationEnd] === '(') depth += 1;
      else if (line[destinationEnd] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) {
      output += line[cursor];
      cursor += 1;
      continue;
    }

    const imageHref = line
      .slice(destinationStart + 1, destinationEnd)
      .trim()
      .replace(/^<|>$/g, '');
    if (renderedImageHrefs && !renderedImageHrefs.has(imageHref)) {
      output += line.slice(cursor, destinationEnd + 1);
    }

    cursor = destinationEnd + 1;
  }

  return output;
}

export function stripRenderedMarkdownImages(
  textRaw: string,
  renderedImageHrefs?: readonly string[],
): string {
  const lines = String(textRaw ?? '').replace(/\r\n/g, '\n').split('\n');
  const normalizedImageHrefs = renderedImageHrefs
    ? new Set(renderedImageHrefs.map((href) => String(href ?? '').trim()).filter(Boolean))
    : null;
  let activeFence: { character: '`' | '~'; length: number } | null = null;
  const renderedLines = lines.map((line) => {
    const marker = fenceMarker(line);
    if (activeFence) {
      if (marker?.character === activeFence.character && marker.length >= activeFence.length) activeFence = null;
      return line;
    }
    if (marker) {
      activeFence = marker;
      return line;
    }
    return stripMarkdownImagesFromLine(line, normalizedImageHrefs);
  });
  return renderedLines.join('\n').replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n');
}

export function ChatMessageBody({
  role,
  text,
  error = false,
  errorMessage,
  images = [],
  preserveLeadParagraph = false,
  toggleOnMessageClick = false,
  autoExpand = false,
  renderedInlineMediaHrefs,
  onOpenFileReference,
  onOpenLink,
  textMentionLinks,
  onOpenTextMention,
}: {
  role: 'user' | 'assistant';
  text?: string;
  error?: boolean;
  errorMessage?: string;
  images?: ChatMessageImage[];
  preserveLeadParagraph?: boolean;
  toggleOnMessageClick?: boolean;
  autoExpand?: boolean;
  renderedInlineMediaHrefs?: readonly string[];
  onOpenFileReference?: (ref: MarkdownFileReference) => void;
  onOpenLink?: (href: string) => boolean;
  textMentionLinks?: MarkdownTextMentionLink[];
  onOpenTextMention?: (mention: MarkdownTextMentionLink) => void;
}) {
  const rawText = String(text ?? '');
  const renderedText =
    role === 'assistant' && renderedInlineMediaHrefs
      ? stripRenderedMarkdownImages(rawText, renderedInlineMediaHrefs)
      : rawText;
  const hasText = Boolean(renderedText.trim());
  const normalizedError = String(errorMessage ?? '').trim();
  const className =
    role === 'user'
      ? 'dh-markdown--user'
      : `dh-markdown--transcript ${error ? 'dh-markdown--error' : 'dh-markdown--agent'}`;

  if (!hasText && !normalizedError && images.length === 0) return null;

  return (
    <div className="space-y-2">
      {hasText ? (
        <CollapsibleMarkdown
          text={renderedText}
          fadeTo={role === 'user' ? 'var(--user-bubble)' : error ? 'var(--red-subtle)' : 'var(--assistant-bubble-fade)'}
          className={className}
          preserveLeadParagraph={preserveLeadParagraph}
          toggleOnMessageClick={toggleOnMessageClick}
          autoExpand={autoExpand}
          onOpenFileReference={onOpenFileReference}
          onOpenLink={onOpenLink}
          textMentionLinks={textMentionLinks}
          onOpenTextMention={onOpenTextMention}
          renderBlockCopyAction={(blockText) => (
            <ChatMessageCopyAction text={blockText} position="block" copyLabel="block" />
          )}
        />
      ) : null}
      {!hasText && normalizedError ? (
        <div className="text-[var(--text-12)] text-[var(--red)]">{normalizedError}</div>
      ) : null}
      {images.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {images.map((image) => (
            <img
              key={image.key}
              src={image.src}
              alt={image.alt}
              className="max-h-44 max-w-[min(260px,100%)] rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] object-contain"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
