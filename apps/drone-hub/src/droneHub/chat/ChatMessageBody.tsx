import React from 'react';

import { CollapsibleMarkdown } from './CollapsibleMarkdown';
import type { MarkdownFileReference, MarkdownTextMentionLink } from './MarkdownMessage';

export type ChatMessageImage = {
  key: string;
  src: string;
  alt: string;
};

export function ChatMessageBody({
  role,
  text,
  error = false,
  errorMessage,
  images = [],
  muted = false,
  preserveLeadParagraph = false,
  toggleOnMessageClick = false,
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
  muted?: boolean;
  preserveLeadParagraph?: boolean;
  toggleOnMessageClick?: boolean;
  onOpenFileReference?: (ref: MarkdownFileReference) => void;
  onOpenLink?: (href: string) => boolean;
  textMentionLinks?: MarkdownTextMentionLink[];
  onOpenTextMention?: (mention: MarkdownTextMentionLink) => void;
}) {
  const rawText = String(text ?? '');
  const hasText = Boolean(rawText.trim());
  const normalizedError = String(errorMessage ?? '').trim();
  const className =
    role === 'user'
      ? 'dh-markdown--user'
      : `dh-markdown--transcript ${muted ? 'dh-markdown--muted' : error ? 'dh-markdown--error' : 'dh-markdown--agent'}`;

  if (!hasText && !normalizedError && images.length === 0) return null;

  return (
    <div className="space-y-2">
      {hasText ? (
        <CollapsibleMarkdown
          text={rawText}
          fadeTo={role === 'user' ? 'var(--user-dim)' : error ? 'var(--red-subtle)' : 'var(--accent-subtle)'}
          className={className}
          preserveLeadParagraph={preserveLeadParagraph}
          toggleOnMessageClick={toggleOnMessageClick}
          onOpenFileReference={onOpenFileReference}
          onOpenLink={onOpenLink}
          textMentionLinks={textMentionLinks}
          onOpenTextMention={onOpenTextMention}
        />
      ) : null}
      {!hasText && normalizedError ? (
        <div className="text-[12px] text-[var(--red)]">{normalizedError}</div>
      ) : null}
      {images.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {images.map((image) => (
            <img
              key={image.key}
              src={image.src}
              alt={image.alt}
              className="max-h-44 max-w-[min(260px,100%)] rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.18)] object-contain"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
