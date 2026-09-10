import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { TerminalRouteService } from '../../src/hub/terminal-route-service';

test('host and container shell opens use the ready daemon without Docker or drone-wide locks', async (t) => {
  const daemonRequests: Array<{ path: string; body: any }> = [];
  const daemon = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test-token');
    let body = '';
    for await (const chunk of req) body += chunk;
    daemonRequests.push({ path: req.url!, body: body ? JSON.parse(body) : null });
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        ok: true,
        session: 'drone-hub-shell',
        reused: true,
        transport: 'terminal-control-v1',
      }),
    );
  });
  await new Promise<void>((r) => daemon.listen(0, '127.0.0.1', r));
  const port = (daemon.address() as any).port;
  let runtime = 'host';
  let droneId = 'test';
  const fail = () => {
    throw new Error('unexpected expensive terminal dependency');
  };
  const route = new TerminalRouteService({
    resolveDroneOrRespond: async () => ({
      id: droneId,
      drone: { id: droneId, name: droneId, runtime, token: 'test-token', hostPort: port },
    }),
    droneRuntime: (drone: any) => drone.runtime,
    normalizeChatName: (name: string) => name,
    normalizeDroneUiCwdForRuntime: (_: any, cwd: string) => cwd || '/tmp',
    loadRegistry: fail,
    resolveDroneEnvironmentConfig: fail,
    resolveCanonicalDroneEnvironmentConfig: async (drone: any) => {
      assert.equal(drone.id, droneId);
      assert.equal(drone.runtime, runtime);
      return { resolvedVars: { TEST: 'value' } };
    },
    resolveContainerManagedEnvVars: (_: any, env: any) => env,
    buildEnvExportLines: () => [],
    resolveHostTerminalShellCommand: () => 'bash -i',
    resolveHubTerminalShellCommand: () => 'bash -i',
    isSafeTmuxSessionName: () => true,
    syncSkillLibraryForDrone: fail,
    syncMcpServersForDrone: fail,
    syncRepoAgentsInstructionsForDrone: fail,
    withLockedDroneContainer: fail,
    dvmExec: fail,
    dvmSessionStart: fail,
    ensureHubSessionRunning: fail,
    resolveDroneDaemonClientForEntry: fail,
    waitForDroneDaemonReady: fail,
  } as any);
  const hub = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    await route.handle({
      req,
      res,
      url,
      method: req.method!,
      parts: url.pathname.split('/').filter(Boolean),
    });
  });
  await new Promise<void>((r) => hub.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await Promise.all([
      new Promise<void>((r) => hub.close(() => r())),
      new Promise<void>((r) => daemon.close(() => r())),
    ]);
  });
  const sessions: string[] = [];
  for (const [nextRuntime, nextId] of [
    ['host', 'test'],
    ['host', 'second'],
    ['container', 'test'],
  ]) {
    runtime = nextRuntime;
    droneId = nextId;
    const response = await fetch(
      `http://127.0.0.1:${(hub.address() as any).port}/api/drones/${droneId}/terminal/open?mode=shell&cwd=/tmp`,
      { method: 'POST' },
    );
    assert.equal(response.status, 200);
    const data = (await response.json()) as any;
    sessions.push(data.sessionName);
    assert.equal(data.sessionName, daemonRequests[daemonRequests.length - 1].body.session);
    assert.equal(data.reused, true);
    assert.equal(data.diagnostics.runtime, runtime);
    assert.equal(data.diagnostics.path, 'daemon');
    assert.ok(data.diagnostics.phases.some((phase: any) => phase.phase === 'terminal-ensure'));
    assert.ok(data.diagnostics.phases.some((phase: any) => phase.phase === 'load-environment'));
    assert.ok(!JSON.stringify(data.diagnostics).includes('test-token'));
    assert.match(response.headers.get('server-timing')!, /terminal_ensure;dur=/);
  }
  assert.equal(daemonRequests.length, 3);
  assert.match(sessions[0], /^drone-hub-shell-host-/);
  assert.notEqual(sessions[0], sessions[1], 'Host drones must not share their default shell');
  assert.equal(sessions[2], 'drone-hub-shell');
  assert.ok(daemonRequests.every((r) => r.path === '/v1/terminal/ensure'));
  assert.equal(daemonRequests[1].body.cwd, '/tmp');
  assert.equal(daemonRequests[1].body.env.TEST, 'value');
});

test('legacy container opens report fallback, lock wait and session preparation separately', async (t) => {
  const daemon = http.createServer((_req, res) => {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":"unsupported"}');
  });
  await new Promise<void>((resolve) => daemon.listen(0, '127.0.0.1', resolve));
  let env: Record<string, string> | undefined;
  const route = new TerminalRouteService({
    resolveDroneOrRespond: async () => ({
      id: 'test',
      drone: {
        id: 'test',
        name: 'test',
        runtime: 'container',
        token: 'secret',
        hostPort: (daemon.address() as any).port,
      },
    }),
    droneRuntime: () => 'container',
    normalizeChatName: (name: string) => name,
    normalizeDroneUiCwdForRuntime: () => '/tmp',
    resolveCanonicalDroneEnvironmentConfig: async () => ({ resolvedVars: {} }),
    resolveContainerManagedEnvVars: () => ({}),
    buildEnvExportLines: () => [],
    resolveHubTerminalShellCommand: () => 'bash -i',
    withLockedDroneContainer: async (options: any, callback: any) => {
      const started = performance.now();
      await new Promise((resolve) => setTimeout(resolve, 20));
      options.onTiming('container-lock-wait', started);
      return callback({ containerName: 'fixture', droneEntry: {}, droneId: 'test' });
    },
    normalizeDroneIdentity: (id: string) => id,
    ensureHubSessionRunning: async (options: any) => {
      env = options.envVars;
    },
  } as any);
  const hub = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    await route.handle({
      req,
      res,
      url,
      method: req.method!,
      parts: url.pathname.split('/').filter(Boolean),
    });
  });
  await new Promise<void>((resolve) => hub.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await Promise.all([
      new Promise<void>((resolve) => hub.close(() => resolve())),
      new Promise<void>((resolve) => daemon.close(() => resolve())),
    ]);
  });
  const response = await fetch(
    `http://127.0.0.1:${(hub.address() as any).port}/api/drones/test/terminal/open?mode=shell`,
    { method: 'POST' },
  );
  const result = (await response.json()) as any;
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.transport, 'legacy');
  assert.equal(result.diagnostics.fallback, 'daemon-unsupported');
  assert.ok(
    result.diagnostics.phases.find((phase: any) => phase.phase === 'container-lock-wait').ms >= 15,
  );
  assert.ok(
    result.diagnostics.phases.some((phase: any) => phase.phase === 'ensure-container-session'),
  );
  assert.equal(env?.TERM, 'xterm-256color');
  assert.equal(env?.COLORTERM, 'truecolor');
});
