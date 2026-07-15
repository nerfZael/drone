export function isAssistantTransferTemporaryName(value: unknown): boolean {
  return /^\.(?:.+\.)?blip-transfer-[a-zA-Z0-9_-]{1,240}\.part$/.test(String(value ?? ''));
}
