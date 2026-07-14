let fallbackCounter = 0;

/**
 * Generates runtime correlation ids without importing a platform crypto module.
 * These ids are for local event/session correlation, not authentication.
 */
export function createPortableId(): string {
  const cryptoApi = (
    globalThis as {
      crypto?: {
        randomUUID?: () => string;
        getRandomValues?: <T extends Uint8Array>(array: T) => T;
      };
    }
  ).crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  fallbackCounter = (fallbackCounter + 1) >>> 0;
  return `${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export type BlipRuntimeDiagnostics = {
  activeHandles: Array<{ type: string; count: number }>;
  activeRequests: Array<{ type: string; count: number }>;
};
