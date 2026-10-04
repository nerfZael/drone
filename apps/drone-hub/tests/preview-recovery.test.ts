import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { rememberPreviewRecovery, shouldRecoverPreviewAsSource } from '../src/droneHub/files/preview-recovery';

test('recovered files stay in Source on the next normal launch until Preview is explicitly chosen', () => {
  const dom = new Window({ url: 'http://localhost/?droneRecovery=source' });
  const descriptors = ['window', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.localStorage });
  try {
    expect(shouldRecoverPreviewAsSource('drone:file')).toBe(true);
    dom.location.href = 'http://localhost/';
    expect(shouldRecoverPreviewAsSource('drone:file')).toBe(true);
    expect(shouldRecoverPreviewAsSource('drone:another')).toBe(false);
    rememberPreviewRecovery('drone:file', false);
    expect(shouldRecoverPreviewAsSource('drone:file')).toBe(false);
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
  }
});
