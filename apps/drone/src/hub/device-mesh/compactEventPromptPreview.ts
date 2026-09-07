import { parseEventNotificationPrompt, renderEventNotificationPrompt } from '@drone/assistant-chat';

/** A display-only preview; delivery always uses the complete canonical prompt. */
export function compactEventPromptPreview(value: unknown, maxBytes: number): string | null {
  const notification = parseEventNotificationPrompt(value);
  if (!notification) return null;
  const events = notification.events.slice(0, 3).map((event) => ({
    provider: truncate(event.provider, 40),
    resourceType: truncate(event.resourceType, 40),
    resourceId: truncate(event.resourceId, 80),
    eventType: truncate(event.eventType, 80),
    occurredAt: event.occurredAt,
    summary: truncate(event.summary, 160),
  }));
  let userMessage =
    notification.userMessage === undefined
      ? undefined
      : truncate(notification.userMessage, Math.floor(maxBytes / 3));
  for (;;) {
    const preview = renderEventNotificationPrompt({ userMessage, events })
      .replace(/  <instructions>[\s\S]*?<\/instructions>\n/, '')
      .replace(/\s*<intent>[\s\S]*?<\/intent>/g, '')
      .replace(/\s*<provider_content[^>]*>[\s\S]*?<\/provider_content>/g, '')
      .replace(/\n\s*(?=<)/g, '')
      .replace(
        'version="1"',
        `version="1" event_count="${notification.eventCount ?? notification.events.length}"`,
      );
    if (Buffer.byteLength(preview) <= maxBytes) return preview;
    if (events.length > 0) events.pop();
    else if (userMessage)
      userMessage = truncate(userMessage, Math.floor(Buffer.byteLength(userMessage) / 2));
    else return preview;
  }
}

function truncate(value: unknown, maxBytes: number): string {
  const source = String(value ?? '');
  if (maxBytes < 3) return '';
  if (Buffer.byteLength(source) <= maxBytes) return source;
  return (
    Buffer.from(source)
      .subarray(0, maxBytes - 3)
      .toString('utf8')
      .replace(/\uFFFD+$/u, '') + '…'
  );
}
