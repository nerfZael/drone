export type MobileDronePendingPrompt = {
  id: string;
  prompt: string;
  status: 'queued' | 'pending' | 'failed';
  error: string | null;
  imageCount: number;
  cancelable: boolean;
};

export function mobileDronePendingPrompts(
  raw: unknown,
  turnsRaw: unknown,
): MobileDronePendingPrompt[] {
  const completedTurnIds = new Set(
    (Array.isArray(turnsRaw) ? turnsRaw : [])
      .map((turn: any) => String(turn?.id ?? '').trim())
      .filter(Boolean),
  );
  return (Array.isArray(raw) ? raw : []).flatMap((item: any) => {
    const id = String(item?.id ?? '').trim();
    const state = String(item?.state ?? 'queued');
    if (!id || !['queued', 'sending', 'sent', 'failed'].includes(state)) return [];
    // The Hub deliberately retains recently completed pending rows for reconciliation. Once the
    // matching transcript turn is visible, rendering that row again would duplicate the prompt.
    if (state !== 'failed' && completedTurnIds.has(id)) return [];
    return [
      {
        id,
        prompt: String(item?.prompt ?? ''),
        status: state === 'failed' ? 'failed' : state === 'queued' ? 'queued' : 'pending',
        error: item?.error ? String(item.error) : null,
        imageCount: Math.max(
          0,
          Number(
            item?.imageCount ?? (Array.isArray(item?.attachments) ? item.attachments.length : 0),
          ) || 0,
        ),
        cancelable: state === 'queued' && !item?.automation,
      } satisfies MobileDronePendingPrompt,
    ];
  });
}
