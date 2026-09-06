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
