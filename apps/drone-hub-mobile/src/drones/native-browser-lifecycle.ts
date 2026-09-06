import type { DroneBrowserSession } from '@drone/device-protocol';

export type NativeBrowserGateway = { sessionId: string; origin: string; url: string };
export type BrowserNative = {
  start(
    sessionId: string,
    url: string,
    token: string,
    authority: string,
    path: string,
    targetPort: number,
  ): Promise<NativeBrowserGateway>;
  stop(sessionId: string): Promise<void>;
};

// Expo async calls and React screen lifetimes can overlap. Serialize native ownership
// across all browser screens, and discard stale starts before they can replace a gateway.
let pending: Promise<unknown> = Promise.resolve();
function serialize<T>(action: () => Promise<T>): Promise<T> {
  const next = pending.catch(() => undefined).then(action);
  pending = next;
  return next;
}

export function startNativeBrowser(
  native: BrowserNative,
  session: DroneBrowserSession,
  path: string,
  port: number,
  isCurrent: () => boolean,
) {
  return serialize(async () => {
    if (!isCurrent()) return null;
    const gateway = await native.start(
      session.sessionId,
      session.url,
      session.token,
      session.upstreamAuthority,
      path,
      port,
    );
    if (isCurrent()) return gateway;
    await native.stop(session.sessionId);
    return null;
  });
}

export function stopNativeBrowser(native: BrowserNative, sessionId: string) {
  return serialize(() => native.stop(sessionId));
}
