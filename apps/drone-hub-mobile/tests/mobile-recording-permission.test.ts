import { describe, expect, test } from 'bun:test';
import {
  ensureMobileBackgroundRecordingPermission,
  ensureMobileRecordingPermission,
} from '../src/local-assistant/mobile-recording-permission';

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

describe('mobile background recording permission', () => {
  test('requests notification access on Android 13 and newer', async () => {
    let requests = 0;
    await ensureMobileBackgroundRecordingPermission({
      platform: 'android',
      platformVersion: 33,
      requestPermission: async () => {
        requests += 1;
        return { granted: true };
      },
    });
    expect(requests).toBe(1);
  });

  test('does not request notification access on iOS or older Android versions', async () => {
    let requests = 0;
    const requestPermission = async () => {
      requests += 1;
      return { granted: true };
    };
    await ensureMobileBackgroundRecordingPermission({
      platform: 'ios',
      platformVersion: 18,
      requestPermission,
    });
    await ensureMobileBackgroundRecordingPermission({
      platform: 'android',
      platformVersion: 32,
      requestPermission,
    });
    expect(requests).toBe(0);
  });

  test('keeps foreground-service recording available when notification access is denied', async () => {
    await expect(
      ensureMobileBackgroundRecordingPermission({
        platform: 'android',
        platformVersion: 33,
        requestPermission: async () => ({ granted: false, canAskAgain: false }),
      }),
    ).resolves.toBeUndefined();
  });
});
