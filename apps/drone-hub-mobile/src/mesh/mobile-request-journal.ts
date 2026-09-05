import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from '@noble/hashes/sha2.js';
import type { SignedCapabilityRequest } from '@drone/device-protocol';

const prefix = 'droneHub.httpRequest.v2.';
let queue: Promise<unknown> = Promise.resolve();
let lastPruned = 0;

/** Persist acceptance before invoking phone-local mutations; never silently replay after restart. */
export function acceptMobileRequest(request: SignedCapabilityRequest): Promise<boolean> {
  const result = queue.then(async () => {
    if (Date.now() - lastPruned > 5 * 60_000) {
      lastPruned = Date.now();
      const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefix));
      for (const key of keys) {
        const raw = await AsyncStorage.getItem(key);
        if (!raw) continue;
        let expires = NaN;
        try {
          expires = Date.parse(JSON.parse(raw).expiresAt);
        } catch {
          /* Preserve unreadable acceptance records. */
        }
        if (expires < Date.now() - 60 * 60_000) await AsyncStorage.removeItem(key);
      }
    }
    const digest = [
      ...sha256(new TextEncoder().encode(`${request.sourceDeviceId}:${request.requestId}`)),
    ]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    const key = prefix + digest;
    if ((await AsyncStorage.getItem(key)) !== null) return false;
    await AsyncStorage.setItem(
      key,
      JSON.stringify({
        requestId: request.requestId,
        sourceDeviceId: request.sourceDeviceId,
        operation: request.operation,
        expiresAt: request.expiresAt,
        acceptedAt: new Date().toISOString(),
      }),
    );
    return true;
  });
  queue = result.catch(() => undefined);
  return result;
}
