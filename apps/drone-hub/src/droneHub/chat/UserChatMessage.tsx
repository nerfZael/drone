import React from 'react';

import { ChatMessageBody, type ChatMessageImage } from './ChatMessageBody';
import { ChatMessageCopyAction } from './ChatMessageCopyAction';
import { ChatMessageFrame } from './ChatMessageFrame';
import type { MarkdownFileReference, MarkdownTextMentionLink } from './MarkdownMessage';

export type UserChatMessageFollowUp = {
  key: string;
  contentKey?: string;
  at?: string;
  text?: string;
  images?: ChatMessageImage[];
  attachmentContent?: React.ReactNode;
};

function messageClockTime(at: string | undefined): string {
  const date = new Date(String(at ?? ''));
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function UserChatMessage({
  at,
  text = '',
  copyText,
  images = [],
  attachmentContent,
  followUps = [],
  autoExpand = false,
  showRoleIcons = false,
  showRoleLabel = showRoleIcons,
  headerEnd,
  headerAttached = false,
  onOpenFileReference,
  onOpenLink,
  textMentionLinks,
  onOpenTextMention,
}: {
  at?: string;
  text?: string;
  copyText?: string;
  images?: ChatMessageImage[];
  attachmentContent?: React.ReactNode;
  followUps?: UserChatMessageFollowUp[];
  autoExpand?: boolean;
  showRoleIcons?: boolean;
  showRoleLabel?: boolean;
  headerEnd?: React.ReactNode;
  headerAttached?: boolean;
  onOpenFileReference?: (ref: MarkdownFileReference) => void;
  onOpenLink?: (href: string) => boolean;
  textMentionLinks?: MarkdownTextMentionLink[];
  onOpenTextMention?: (mention: MarkdownTextMentionLink) => void;
}) {
  const resolvedCopyText =
    copyText ??
    [text, ...followUps.map((followUp) => `ASAP:\n${followUp.text ?? ''}`)]
      .filter(Boolean)
      .join('\n\n');
  return (
    <ChatMessageFrame
      role="user"
      at={at}
      showRoleIcon={showRoleIcons}
      showRoleLabel={showRoleLabel}
      headerEnd={headerEnd}
      headerAttached={headerAttached}
      hoverActions={
        resolvedCopyText ? (
          <ChatMessageCopyAction text={resolvedCopyText} position="hover-rail" />
        ) : undefined
      }
    >
      <ChatMessageBody
        role="user"
        text={text}
        images={images}
        autoExpand={autoExpand}
        onOpenFileReference={onOpenFileReference}
        onOpenLink={onOpenLink}
        textMentionLinks={textMentionLinks}
        onOpenTextMention={onOpenTextMention}
      />
      {attachmentContent}
      {followUps.map((followUp) => {
        const clockTime = messageClockTime(followUp.at);
        return (
          <div key={followUp.key} data-user-message-follow-up="asap">
            <div className="my-3 flex items-center gap-2 text-[var(--type-caption)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--user-muted)]">
              <span className="h-px min-w-4 flex-1 bg-[var(--user-bubble-border)]" />
              <span style={{ fontFamily: 'var(--display)' }}>ASAP</span>
              <span className="h-px min-w-4 flex-1 bg-[var(--user-bubble-border)]" />
              {clockTime ? (
                <time
                  dateTime={followUp.at}
                  title={new Date(followUp.at!).toLocaleString()}
                  className="font-normal normal-case tracking-normal tabular-nums text-[var(--chat-user-message-time)]"
                >
                  {clockTime}
                </time>
              ) : null}
            </div>
            <ChatMessageBody
              role="user"
              text={followUp.text ?? ''}
              images={followUp.images ?? []}
              autoExpand={autoExpand}
              onOpenFileReference={onOpenFileReference}
              onOpenLink={onOpenLink}
              textMentionLinks={textMentionLinks}
              onOpenTextMention={onOpenTextMention}
            />
            {followUp.attachmentContent}
          </div>
        );
      })}
    </ChatMessageFrame>
  );
}
