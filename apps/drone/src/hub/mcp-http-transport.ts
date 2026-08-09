import crypto from 'node:crypto';
import type http from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { readJsonBody, sendJson } from './hub-http';
import { createDroneHubMcpServer } from './mcp-server';
import type { RenameDroneCommand } from './drone-rename-command';
import type { HubApplication } from './application/create-hub-application';
import {
  authenticateMcpBearerToken,
  bearerTokenFromAuthorizationHeader,
  type McpTokenIdentity,
} from './mcp-tokens';

type McpSession = {
  transport: StreamableHTTPServerTransport;
  server: ReturnType<typeof createDroneHubMcpServer>;
  tokenId: string;
};

export class DroneHubMcpHttpTransport {
  private readonly sessions = new Map<string, McpSession>();

  constructor(
    private readonly opts: {
      signingSecret: string;
      log: (level: 'warn', message: string, details?: Record<string, unknown>) => void;
      speechEnabled?: boolean;
      renameDrone?: RenameDroneCommand;
      hubApplication?: HubApplication;
    },
  ) {}

  setSpeechEnabled(enabled: boolean): void {
    this.opts.speechEnabled = enabled;
    for (const session of this.sessions.values()) {
      session.server.setSpeechEnabled(enabled);
    }
  }

  private async closeSession(sessionId: string | undefined): Promise<void> {
    if (!sessionId) return;
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    this.sessions.delete(sessionId);
    await Promise.resolve(entry.server.close()).catch(() => {});
  }

  private refreshSessionIdentity(
    session: McpSession,
    identity: McpTokenIdentity,
    res: http.ServerResponse,
  ): boolean {
    if (session.tokenId !== identity.tokenId) {
      sendJson(res, 403, { ok: false, error: 'MCP session belongs to another token' });
      return false;
    }
    session.server.setPrincipal(identity);
    return true;
  }

  async close(): Promise<void> {
    await Promise.all(
      Array.from(this.sessions.keys()).map(async (sessionId) => {
        await this.closeSession(sessionId);
      }),
    ).catch(() => {});
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

    const sessionIdHeader = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

    try {
      if (method === 'POST') {
        const existing = sessionId ? this.sessions.get(sessionId) : null;
        if (existing) {
          if (!this.refreshSessionIdentity(existing, identity, res)) return;
          await existing.transport.handleRequest(req, res);
          return;
        }
        if (sessionId) {
          sendJson(res, 404, { ok: false, error: 'unknown MCP session' });
          return;
        }

        const body = await readJsonBody(req);
        if (!isInitializeRequest(body)) {
          sendJson(res, 400, { ok: false, error: 'MCP session must start with initialize' });
          return;
        }

        let transport: StreamableHTTPServerTransport;
        const server = createDroneHubMcpServer({
          principal: identity,
          speechEnabled: this.opts.speechEnabled !== false,
          renameDrone: this.opts.renameDrone,
          hubApplication: this.opts.hubApplication,
        });
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (nextSessionId) => {
            this.sessions.set(nextSessionId, { transport, server, tokenId: identity.tokenId });
          },
        });
        transport.onclose = () => void this.closeSession(transport.sessionId);
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }

      if (method === 'GET' || method === 'DELETE') {
        const existing = sessionId ? this.sessions.get(sessionId) : null;
        if (!existing) {
          sendJson(res, 400, { ok: false, error: 'invalid or missing MCP session' });
          return;
        }
        if (!this.refreshSessionIdentity(existing, identity, res)) return;
        await existing.transport.handleRequest(req, res);
        return;
      }

      res.setHeader('allow', 'GET, POST, DELETE');
      sendJson(res, 405, { ok: false, error: 'method not allowed' });
    } catch (error: any) {
      this.opts.log('warn', 'mcp request failed', {
        method,
        error: String(error?.message ?? error ?? ''),
      });
      if (!res.headersSent && !res.writableEnded) {
        sendJson(res, 500, { ok: false, error: error?.message ?? String(error) });
      }
    }
  }
}
