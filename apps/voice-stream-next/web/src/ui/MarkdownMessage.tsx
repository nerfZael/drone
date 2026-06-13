import { MarkdownMessage as SharedMarkdownMessage } from '@drone/assistant-markdown';
import type { MarkdownFileReference } from '@drone/assistant-markdown';
import type * as React from 'react';
import { cn } from './cn.js';

type MarkdownMessageProps = React.ComponentProps<typeof SharedMarkdownMessage>;

export function MarkdownMessage({ className = '', ...props }: MarkdownMessageProps) {
  return <SharedMarkdownMessage {...props} className={cn('assistant-markdown', className)} />;
}

export type { MarkdownFileReference };
