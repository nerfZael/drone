import { describe, expect, test } from 'bun:test';
import { ensureMobileRecordingPermission } from '../src/local-assistant/mobile-recording-permission';

describe('mobile recording permission', () => {
  test('does not invoke the native request when microphone access is already granted', async () => {
    let requests = 0;
    const result = await ensureMobileRecordingPermission({
      getPermission: async () => ({ granted: true }),
      requestPermission: async () => {
        requests += 1;
        return { granted: true };
      },
    });

    expect(result.granted).toBe(true);
    expect(requests).toBe(0);
  });

  test('requests microphone access when it is not already granted', async () => {
    let requests = 0;
    const result = await ensureMobileRecordingPermission({
      getPermission: async () => ({ granted: false }),
      requestPermission: async () => {
        requests += 1;
        return { granted: true };
      },
    });

    expect(result.granted).toBe(true);
    expect(requests).toBe(1);
  });

  test('does not repeat the native request after permission was permanently denied', async () => {
    let requests = 0;
    const result = await ensureMobileRecordingPermission({
      getPermission: async () => ({ granted: false, canAskAgain: false }),
      requestPermission: async () => {
        requests += 1;
        return { granted: false, canAskAgain: false };
      },
    });

    expect(result.granted).toBe(false);
    expect(requests).toBe(0);
  });
});
