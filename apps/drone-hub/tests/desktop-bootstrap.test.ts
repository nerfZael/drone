import { afterEach, expect, test } from 'bun:test';
import { prepareDesktopProfile } from '../src/desktop-bootstrap';

const originalWindow = globalThis.window;
const originalStorage = globalThis.localStorage;
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.localStorage = originalStorage;
  globalThis.fetch = originalFetch;
});

for (const profile of ['work', null]) {
  test(`resolves desktop profile ${profile} before loading profile-scoped state`, async () => {
    const values = new Map([['droneHub.activeProfileOverride', 'old']]);
    globalThis.window = { __DRONE_HUB_RUNTIME_CONFIG__: { desktop: true } } as any;
    globalThis.localStorage = {
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    } as any;
    globalThis.fetch = (async () => Response.json({ activeProfile: profile })) as any;
    await prepareDesktopProfile();
    expect(values.get('droneHub.activeProfileOverride')).toBe(profile ?? undefined);
  });
}

test('browser startup does not fetch desktop profile configuration', async () => {
  globalThis.window = {} as any;
  globalThis.fetch = (() => { throw new Error('unexpected fetch'); }) as any;
  await prepareDesktopProfile();
});
