export type DroneBrowserTargets = {
  droneId: string;
  runtime: 'host' | 'container';
  ports: Array<{ port: number }>;
  manualPort: boolean;
};

/** The token is for the native transport only; never expose it to page JavaScript. */
export type DroneBrowserSession = {
  sessionId: string;
  url: string;
  token: string;
  expiresAt: string;
  upstreamAuthority: string;
};

/** A short-lived bearer session for the full-Hub tunnel. Never expose the token to page JavaScript. */
export type HubRemoteSession = {
  sessionId: string;
  /** Origin and path prefix; `api/...` and `port/<n>/...` are appended to it. */
  baseUrl: string;
  token: string;
  expiresAt: string;
};
