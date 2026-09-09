import React from 'react';
import { eventNotificationCopyText, parseEventNotificationPrompt } from '@drone/assistant-chat';

import {
  ImageAttachmentChips,
  isAttachmentOnlyPrompt,
  normalizeImageAttachmentRefs,
} from '../chat/ImageAttachmentChips';
import type { MarkdownFileReference } from '../chat/MarkdownMessage';
import type { UserChatMessageFollowUp } from '../chat/UserChatMessage';
import { EventNotificationBody } from '../chat/SubscriptionEventBadge';
import type { TranscriptItem } from '../types';
import type { ChatTimelineGroup } from './chat-timeline-items';
import { transcriptMessageId as defaultTranscriptMessageId } from './transcript-message-id';

export function timelineUserFollowUps(
  entries: ChatTimelineGroup['followUps'],
  options: {
    droneId: string;
    droneHomePath?: string;
    onOpenFileReference?: (ref: MarkdownFileReference) => void;
    transcriptMessageId?: (item: TranscriptItem) => string;
  },
): UserChatMessageFollowUp[] {
  const messageId = options.transcriptMessageId ?? defaultTranscriptMessageId;
  return entries.map((entry) => {
    const item = entry.item;
    const attachments = normalizeImageAttachmentRefs(item.attachments);
    const notification = parseEventNotificationPrompt(item.prompt);
    return {
      key:
        entry.kind === 'pending'
          ? `pending:${entry.item.id}`
          : `transcript:${messageId(entry.item)}`,
      contentKey: JSON.stringify({
        ...(notification ? { prompt: item.prompt } : {}),
        updatedAt: entry.kind === 'pending' ? entry.item.updatedAt : entry.item.completedAt,
        attachments: attachments.map((attachment) => ({
          name: attachment.name,
          mime: attachment.mime,
          size: attachment.size,
          path: attachment.path,
          relativePath: attachment.relativePath,
          previewLength: attachment.previewDataUrl?.length ?? 0,
        })),
      }),
      at: entry.kind === 'turn' ? entry.item.promptAt || entry.item.at : entry.item.at,
      text: notification
        ? (notification.userMessage ?? '')
        : isAttachmentOnlyPrompt(item.prompt, attachments)
          ? ''
          : item.prompt,
      ...(notification ? { copyText: eventNotificationCopyText(notification) } : {}),
      attachmentContent: (
        <>
          <ImageAttachmentChips
            attachments={attachments}
            droneId={options.droneId}
            droneHomePath={options.droneHomePath}
            onOpenFileReference={options.onOpenFileReference}
          />
          {notification ? <EventNotificationBody notification={notification} /> : null}
        </>
      ),
    };
  });
}
