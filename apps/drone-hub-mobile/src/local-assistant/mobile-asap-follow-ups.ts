import type { AssistantMessage } from '@drone/assistant-chat';

export type MobileAsapFollowUpAttachment = {
  name: string;
  mime?: string;
  size?: number | null;
};

export type MobileAsapFollowUp = {
  id: string;
  prompt: string;
  at?: string;
  attachmentCount?: number;
  attachments?: MobileAsapFollowUpAttachment[];
};

function positiveCount(value: unknown): number {
  return Math.max(0, Number(value) || 0);
}

export function normalizeMobileAsapFollowUps(value: unknown): MobileAsapFollowUp[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const followUp = item as Record<string, unknown>;
    const prompt = String(followUp.prompt ?? '');
    const attachments = Array.isArray(followUp.attachments)
      ? followUp.attachments.flatMap((entry) => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
          const attachment = entry as Record<string, unknown>;
          const name = String(attachment.name ?? '').trim();
          if (!name) return [];
          const size = Number(attachment.size);
          return [
            {
              name,
              ...(String(attachment.mime ?? '').trim()
                ? { mime: String(attachment.mime).trim() }
                : {}),
              ...(Number.isFinite(size) && size >= 0 ? { size } : {}),
            },
          ];
        })
      : [];
    const attachmentCount = positiveCount(
      followUp.attachmentCount ?? followUp.imageCount ?? attachments.length,
    );
    return [
      {
        id: String(followUp.id ?? '').trim() || `asap-follow-up-${index}`,
        prompt,
        ...(String(followUp.at ?? '').trim() ? { at: String(followUp.at).trim() } : {}),
        ...(attachmentCount > 0 ? { attachmentCount } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
      },
    ];
  });
}

export function mobileMessageAsapFollowUps(message: AssistantMessage): MobileAsapFollowUp[] {
  const details = message.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return [];
  return normalizeMobileAsapFollowUps((details as Record<string, unknown>).asapFollowUps);
}

export function mobileMessageDetailsWithAsapFollowUps(
  details: unknown,
  followUps: readonly MobileAsapFollowUp[],
): Record<string, unknown> | undefined {
  const base =
    details && typeof details === 'object' && !Array.isArray(details)
      ? (details as Record<string, unknown>)
      : {};
  return followUps.length > 0
    ? { ...base, asapFollowUps: followUps }
    : Object.keys(base).length > 0
      ? base
      : undefined;
}

export function mobileAsapFollowUpTimestampLabel(value: unknown): string {
  const date = new Date(String(value ?? ''));
  if (!Number.isFinite(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
