import type http from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { readJsonBody, sendJson } from './hub-http';
import { createDroneHubMcpServer } from './mcp-server';
import type { HubServices } from './application/hub-services';
import {
  authenticateMcpBearerToken,
  bearerTokenFromAuthorizationHeader,
} from './mcp-tokens';

export class DroneHubMcpHttpTransport {
  // This tracks only currently executing POST requests so Hub shutdown can close them.
  // It is never keyed by, or retained for, an MCP client session.
  private readonly activeServers = new Set<ReturnType<typeof createDroneHubMcpServer>>();

  constructor(
    private readonly opts: {
      signingSecret: string;
      log: (level: 'warn', message: string, details?: Record<string, unknown>) => void;
      speechEnabled?: boolean;
      hubServices: HubServices;
    },
  ) {}

  setSpeechEnabled(enabled: boolean): void {
    this.opts.speechEnabled = enabled;
    for (const server of this.activeServers) server.setSpeechEnabled(enabled);
  }

  async close(): Promise<void> {
    const servers = [...this.activeServers];
    this.activeServers.clear();
    await Promise.allSettled(servers.map(async (server) => await server.close()));
  }

  async handle(req: http.IncomingMessage, res: http.ServerResponse, method: string): Promise<void> {
    if (!this.opts.signingSecret) {
      sendJson(res, 404, { ok: false, error: 'MCP endpoint is not enabled' });
      return;
    }

    const identity = await authenticateMcpBearerToken(
      bearerTokenFromAuthorizationHeader(req.headers.authorization),
      this.opts.signingSecret,
    );
    if (!identity) {
      this.opts.log('warn', 'unauthorized mcp request', {
        method,
        origin: typeof req.headers.origin === 'string' ? req.headers.origin : null,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      });
      res.setHeader('www-authenticate', 'Bearer realm="drone-hub-mcp"');
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }

    if (method !== 'POST') {
      res.setHeader('allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'method not allowed' });
      return;
    }

    let server: ReturnType<typeof createDroneHubMcpServer> | null = null;

    try {
      const body = await readJsonBody(req);
      server = createDroneHubMcpServer({
        principal: identity,
        speechEnabled: this.opts.speechEnabled !== false,
        hubServices: this.opts.hubServices,
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      this.activeServers.add(server);
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error: any) {
      this.opts.log('warn', 'mcp request failed', {
        method,
        error: String(error?.message ?? error ?? ''),
      });
      if (!res.headersSent && !res.writableEnded) {
        sendJson(res, 500, { ok: false, error: error?.message ?? String(error) });
      }
    } finally {
      if (server && this.activeServers.delete(server)) {
        await Promise.resolve(server.close()).catch(() => {});
      }
    }
  }
}
