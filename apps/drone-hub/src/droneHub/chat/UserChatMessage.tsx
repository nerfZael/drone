import React from 'react';

import { ChatMessageBody, type ChatMessageImage } from './ChatMessageBody';
import { ChatMessageCopyAction } from './ChatMessageCopyAction';
import { ChatMessageFrame } from './ChatMessageFrame';
import type { MarkdownFileReference, MarkdownTextMentionLink } from './MarkdownMessage';

export function UserChatMessage({
  at,
  text = '',
  copyText = text,
  images = [],
  attachmentContent,
  autoExpand = false,
  showRoleIcons = false,
  showRoleLabel = showRoleIcons,
  headerEnd,
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
  autoExpand?: boolean;
  showRoleIcons?: boolean;
  showRoleLabel?: boolean;
  headerEnd?: React.ReactNode;
  onOpenFileReference?: (ref: MarkdownFileReference) => void;
  onOpenLink?: (href: string) => boolean;
  textMentionLinks?: MarkdownTextMentionLink[];
  onOpenTextMention?: (mention: MarkdownTextMentionLink) => void;
}) {
  return (
    <ChatMessageFrame
      role="user"
      at={at}
      showRoleIcon={showRoleIcons}
      showRoleLabel={showRoleLabel}
      headerEnd={headerEnd}
      hoverActions={
        copyText ? <ChatMessageCopyAction text={copyText} position="hover-rail" /> : undefined
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
    </ChatMessageFrame>
  );
}
