import crypto from 'node:crypto';

// Sessions let a sandboxed HTML preview load its own document and local images by
// URL, so the Hub page never holds the file or its images in memory. A session
// grants nothing beyond what the authenticated Hub page that created it could read.
export type HtmlPreviewSession = {
  droneId: string;
  /** The previewed HTML file. Every other path is served only as an image or video. */
  path: string;
  /** Applied with `sandbox allow-scripts` to every response for this session. */
  contentSecurityPolicy: string;
  /** Inserted before the file's markup, ahead of any author script. */
  documentPrefix: string;
  lastUsedAt: number;
};

const MAX_SESSIONS = 64;
const IDLE_MS = 60 * 60 * 1000;
const MAX_POLICY_LENGTH = 4096;
const MAX_PREFIX_LENGTH = 64 * 1024;

export function htmlPreviewResponsePolicy(contentSecurityPolicy: string): string {
  return `sandbox allow-scripts; ${contentSecurityPolicy}`;
}

export function createHtmlPreviewSessions(now: () => number = Date.now) {
  const sessions = new Map<string, HtmlPreviewSession>();
  const prune = () => {
    const cutoff = now() - IDLE_MS;
    for (const [token, session] of sessions) if (session.lastUsedAt < cutoff) sessions.delete(token);
  };
  return {
    create(input: { droneId: string; path: string; contentSecurityPolicy: unknown; documentPrefix: unknown }): string | null {
      const { contentSecurityPolicy, documentPrefix } = input;
      if (typeof contentSecurityPolicy !== 'string' || !contentSecurityPolicy.trim() || contentSecurityPolicy.length > MAX_POLICY_LENGTH || /[\r\n]/.test(contentSecurityPolicy)) return null;
      if (typeof documentPrefix !== 'string' || documentPrefix.length > MAX_PREFIX_LENGTH) return null;
      prune();
      // Map order is least recently used first.
      while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
      const token = crypto.randomBytes(24).toString('base64url');
      sessions.set(token, { droneId: input.droneId, path: input.path, contentSecurityPolicy, documentPrefix, lastUsedAt: now() });
      return token;
    },
    use(token: string, droneId: string): HtmlPreviewSession | null {
      prune();
      const session = sessions.get(token);
      if (!session || session.droneId !== droneId) return null;
      session.lastUsedAt = now();
      sessions.delete(token);
      sessions.set(token, session);
      return session;
    },
    delete(token: string, droneId: string): void {
      if (sessions.get(token)?.droneId === droneId) sessions.delete(token);
    },
  };
}
