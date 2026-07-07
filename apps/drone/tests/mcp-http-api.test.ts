import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { resetDroneRootDirForTests } from '../src/host/paths';
import { startDroneHubApiServer } from '../src/hub/server';
import { authenticateMcpBearerToken, ensureDroneMcpAccessToken, revokeMcpAccessTokensForDrone } from '../src/hub/mcp-tokens';
import { getSocketListenSupport } from './socket-listen-support';

const listenSupport = getSocketListenSupport();
const describeSocketSuite = listenSupport.ok ? describe : describe.skip;

describeSocketSuite('Drone Hub MCP HTTP endpoint', () => {
  const apiToken = 'api-token';
  const mcpToken = 'mcp-token';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-mcp-http-api-'));
  const prevDroneDataDir = process.env.DRONE_DATA_DIR;
  const droneDataDir = path.join(tempRoot, 'data', 'drone');
  let server: Awaited<ReturnType<typeof startDroneHubApiServer>> | null = null;
  let baseUrl = '';

  beforeAll(async () => {
    fs.mkdirSync(droneDataDir, { recursive: true });
    process.env.DRONE_DATA_DIR = droneDataDir;
    resetDroneRootDirForTests();
    server = await startDroneHubApiServer({ port: 0, apiToken, mcpToken });
    baseUrl = `http://${server.host}:${server.port}`;
  });

  afterAll(async () => {
    if (server) await server.close();
    if (prevDroneDataDir == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = prevDroneDataDir;
    resetDroneRootDirForTests();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('uses a separate bearer token from the Hub API token', async () => {
    const noAuth = await fetch(`${baseUrl}/mcp`);
    expect(noAuth.status).toBe(401);

    const apiAuth = await fetch(`${baseUrl}/mcp`, {
      headers: { authorization: `Bearer ${apiToken}` },
    });
    expect(apiAuth.status).toBe(401);

    const init = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${mcpToken}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'drone-test', version: '0.1.0' },
        },
      }),
    });

    expect(init.status).toBe(200);
    expect(init.headers.get('mcp-session-id')).toBeTruthy();
  });

  test('upserts a Drone Hub HTTP MCP server preset with a named host token', async () => {
    const upsert = await fetch(`${baseUrl}/api/mcp-servers/drone-hub-preset`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiToken}` },
    });
    expect(upsert.status).toBe(200);
    const data: any = await upsert.json();
    expect(data.server.name).toBe('drone-hub');
    expect(data.server.transport).toBe('http');
    expect(data.server.url).toBe(`http://127.0.0.1:${server?.port}/mcp`);
    expect(data.server.headers.Authorization).toStartWith('Bearer dhmcp_');
    expect(data.server.headers.Authorization).not.toBe(`Bearer ${mcpToken}`);

    const presetToken = String(data.server.headers.Authorization).replace(/^Bearer\s+/, '');
    const init = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${presetToken}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'drone-test-host-token', version: '0.1.0' },
        },
      }),
    });
    expect(init.status).toBe(200);

    const tokensResponse = await fetch(`${baseUrl}/api/mcp-tokens`, {
      headers: { authorization: `Bearer ${apiToken}` },
    });
    expect(tokensResponse.status).toBe(200);
    const tokensData: any = await tokensResponse.json();
    const token = tokensData.tokens.find((entry: any) => entry.name === 'Drone Hub host token');
    expect(token.kind).toBe('host');
    expect(token.secretSeed).toBeUndefined();
  });

  test('creates and revokes named host MCP tokens', async () => {
    const createdResponse = await fetch(`${baseUrl}/api/mcp-tokens`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'host codex', kind: 'host' }),
    });
    expect(createdResponse.status).toBe(201);
    const created: any = await createdResponse.json();
    expect(created.token.name).toBe('host codex');
    expect(created.token.kind).toBe('host');
    expect(created.token.secretSeed).toBeUndefined();
    expect(created.tokenValue).toStartWith('dhmcp_');

    const authed = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${created.tokenValue}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'drone-test-created-token', version: '0.1.0' },
        },
      }),
    });
    expect(authed.status).toBe(200);

    const revokedResponse = await fetch(`${baseUrl}/api/mcp-tokens/${encodeURIComponent(created.token.id)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${apiToken}` },
    });
    expect(revokedResponse.status).toBe(200);

    const rejected = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${created.tokenValue}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'drone-test-revoked-token', version: '0.1.0' },
        },
      }),
    });
    expect(rejected.status).toBe(401);
  });

  test('does not allow public token creation to mint drone identities', async () => {
    const response = await fetch(`${baseUrl}/api/mcp-tokens`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'fake drone', kind: 'drone', droneId: 'drone-a' }),
    });
    expect(response.status).toBe(400);
  });

  test('generates separate random token values for separate drones', async () => {
    const first = await ensureDroneMcpAccessToken({ droneId: 'drone-a', droneName: 'Drone A', signingSecret: mcpToken });
    const second = await ensureDroneMcpAccessToken({ droneId: 'drone-b', droneName: 'Drone B', signingSecret: mcpToken });

    expect(first.token.kind).toBe('drone');
    expect(first.token.droneId).toBe('drone-a');
    expect(second.token.droneId).toBe('drone-b');
    expect(first.tokenValue).not.toBe(second.tokenValue);
    expect(first.tokenValue.includes('drone-a')).toBe(false);
    expect(second.tokenValue.includes('drone-b')).toBe(false);

    const identity = await authenticateMcpBearerToken(first.tokenValue, mcpToken);
    expect(identity?.kind).toBe('drone');
    expect(identity?.droneId).toBe('drone-a');

    const regenerateDrone = await fetch(`${baseUrl}/api/mcp-tokens/${encodeURIComponent(first.token.id)}/regenerate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiToken}` },
    });
    expect(regenerateDrone.status).toBe(400);

    const revoked = await revokeMcpAccessTokensForDrone('drone-a');
    expect(revoked).toHaveLength(1);
    const rejected = await authenticateMcpBearerToken(first.tokenValue, mcpToken);
    expect(rejected).toBeNull();
  });
});
