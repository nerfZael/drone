export function isAssistantTransferTemporaryName(value: unknown): boolean {
  return /^\.(?:.+\.)?blip-transfer-[a-zA-Z0-9_-]{1,240}\.part(?:\.receipt\.json(?:\.[a-zA-Z0-9-]+\.tmp)?)?$/.test(
    String(value ?? ''),
  );
}
