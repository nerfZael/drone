import React from 'react';
import {
  MarkdownMessage as SharedMarkdownMessage,
  type MarkdownMessageProps,
} from '@drone/assistant-markdown';
import { DesktopHighlightedCodeBlock } from './DesktopHighlightedCodeBlock';

export function MarkdownMessage(props: MarkdownMessageProps) {
  return <SharedMarkdownMessage {...props} renderCodeBlock={DesktopHighlightedCodeBlock} />;
}

export type {
  MarkdownBlockCopyActionRenderer,
  MarkdownFileReference,
  MarkdownMessageProps,
  MarkdownTextMentionLink,
} from '@drone/assistant-markdown';
