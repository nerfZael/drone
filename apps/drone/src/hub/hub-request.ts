import type { IncomingMessage, ServerResponse } from 'node:http';

import { describeHubError } from './domain-errors';
import { isHubApiAuthorized } from './hub-auth';
import { errorMessage, sendJson, withCors, type HubJsonResponder } from './hub-http';

export type HubRequestLogger = (
  level: 'error' | 'warn',
  message: string,
  meta: Record<string, unknown>,
) => void;

export function prepareHubHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigins: Set<string>,
  respond: HubJsonResponder = sendJson,
): boolean {
  const corsAllowed = withCors(req, res, allowedOrigins);
  if (String(req.method ?? 'GET').toUpperCase() !== 'OPTIONS') return false;

  if (!corsAllowed) {
    respond(res, 403, { ok: false, error: 'origin not allowed' });
    return true;
  }
  res.statusCode = 204;
  res.end();
  return true;
}

export function rejectUnauthorizedHubApiRequest(opts: {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  apiToken: string;
  log: HubRequestLogger;
  respond?: HubJsonResponder;
}): boolean {
  const { req, res, url, apiToken, log, respond = sendJson } = opts;
  if (!url.pathname.startsWith('/api/') || isHubApiAuthorized(req, apiToken)) return false;

  log('warn', 'unauthorized api request', {
    method: String(req.method ?? 'GET').toUpperCase(),
    path: url.pathname,
    origin: typeof req.headers.origin === 'string' ? req.headers.origin : null,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  });
  res.setHeader('www-authenticate', 'Bearer realm="drone-hub-api"');
  respond(res, 401, { ok: false, error: 'unauthorized' });
  return true;
}

export function handleHubRequestFailure(opts: {
  req: IncomingMessage;
  res: ServerResponse;
  error: unknown;
  log: HubRequestLogger;
  logMessage?: string;
  respond?: HubJsonResponder;
}): void {
  const { req, res, error, log, logMessage = 'request handler crashed', respond = sendJson } = opts;
  log('error', logMessage, {
    method: String(req.method ?? 'GET').toUpperCase(),
    path: String(req.url ?? ''),
    error: errorMessage(error),
  });
  if (res.writableEnded) return;
  if (res.headersSent) {
    res.end();
    return;
  }
  const descriptor = describeHubError(error);
  respond(res, descriptor.statusCode, descriptor.body);
}
