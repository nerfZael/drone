import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';
import { getSocketListenSupport } from './socket-listen-support';

const listenSupport = getSocketListenSupport();
if (!listenSupport.ok && process.env.CI) {
  throw new Error(`fleet daemon tests require local socket binding support: ${listenSupport.detail}`);
}
if (!listenSupport.ok) {
  // eslint-disable-next-line no-console
  console.warn(`Skipping fleet daemon tests: ${listenSupport.detail}`);
}

const describeSocketSuite = listenSupport.ok ? describe : describe.skip;
const daemonEntry = path.resolve(__dirname, '..', 'src', 'daemon.ts');

async function allocatePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('failed to allocate test port'));
        return;
      }
      const { port } = addr;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function waitForHealth(baseUrl: string, token: string, daemon: ReturnType<typeof Bun.spawn>) {
  const startedAt = Date.now();
  let lastError = '';
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const response = await fetch(`${baseUrl}/v1/health`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (response.ok) return;
      lastError = await response.text();
    } catch (error: any) {
      lastError = error?.message ?? String(error);
    }
    if (Date.now() - startedAt > 10_000) {
      const stderr = await new Response(daemon.stderr).text().catch(() => '');
      throw new Error(`timed out waiting for daemon health: ${lastError || stderr || 'unknown error'}`);
    }
    await Bun.sleep(100);
  }
}

describeSocketSuite('fleet daemon', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-fleet-daemon-'));
  const processes: Array<ReturnType<typeof Bun.spawn>> = [];

  afterAll(async () => {
    for (const daemon of processes) {
      daemon.kill();
      await daemon.exited.catch(() => {});
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('rejects invalid fleet request state filters', async () => {
    const port = await allocatePort();
    const dataDir = path.join(tempRoot, `daemon-${port}`);
    fs.mkdirSync(dataDir, { recursive: true });
    const token = 'daemon-token';
    const daemon = Bun.spawn([process.execPath, daemonEntry, '--host', '127.0.0.1', '--port', String(port), '--data-dir', dataDir, '--token', token], {
      cwd: process.cwd(),
      stdout: 'ignore',
      stderr: 'pipe',
    });
    processes.push(daemon);
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, token, daemon);

    await fetch(`${baseUrl}/v1/fleet/requests`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: 'create_child', payload: { name: 'child-one' } }),
    });

    const response = await fetch(`${baseUrl}/v1/fleet/requests?state=bogus`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const data: any = await response.json();
    expect(response.status).toBe(400);
    expect(String(data?.error ?? '')).toContain('invalid state');
  });

  test('clears stale terminal fields when a fleet request is re-resolved', async () => {
    const port = await allocatePort();
    const dataDir = path.join(tempRoot, `daemon-${port}`);
    fs.mkdirSync(dataDir, { recursive: true });
    const token = 'daemon-token';
    const daemon = Bun.spawn([process.execPath, daemonEntry, '--host', '127.0.0.1', '--port', String(port), '--data-dir', dataDir, '--token', token], {
      cwd: process.cwd(),
      stdout: 'ignore',
      stderr: 'pipe',
    });
    processes.push(daemon);
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, token, daemon);

    const createResponse = await fetch(`${baseUrl}/v1/fleet/requests`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: 'create_child', payload: { name: 'child-two' } }),
    });
    const created: any = await createResponse.json();
    const requestId = String(created?.request?.id ?? '');
    expect(requestId).toBeTruthy();

    const failedResponse = await fetch(`${baseUrl}/v1/fleet/requests/${encodeURIComponent(requestId)}/resolve`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ state: 'failed', error: 'boom' }),
    });
    const failed: any = await failedResponse.json();
    expect(failed?.request?.error).toBe('boom');
    expect(failed?.request?.result).toBeUndefined();

    const doneResponse = await fetch(`${baseUrl}/v1/fleet/requests/${encodeURIComponent(requestId)}/resolve`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ state: 'done', result: { ok: true } }),
    });
    const done: any = await doneResponse.json();
    expect(done?.request?.state).toBe('done');
    expect(done?.request?.result).toEqual({ ok: true });
    expect(done?.request?.error).toBeUndefined();
  });

  test('accepts stop_chat requests and advertises the stop command in help', async () => {
    const port = await allocatePort();
    const dataDir = path.join(tempRoot, `daemon-${port}`);
    fs.mkdirSync(dataDir, { recursive: true });
    const token = 'daemon-token';
    const daemon = Bun.spawn([process.execPath, daemonEntry, '--host', '127.0.0.1', '--port', String(port), '--data-dir', dataDir, '--token', token], {
      cwd: process.cwd(),
      stdout: 'ignore',
      stderr: 'pipe',
    });
    processes.push(daemon);
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, token, daemon);

    const helpResponse = await fetch(`${baseUrl}/v1/fleet/help`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const helpData: any = await helpResponse.json();
    expect(helpResponse.status).toBe(200);
    expect(Array.isArray(helpData?.commands)).toBe(true);
    expect((helpData?.commands ?? []).includes('fleet create --name <child> [--group <group>] [--clone-parent] [--idempotency-key <key>]')).toBe(true);
    expect((helpData?.commands ?? []).includes('fleet stop --to <drone> --chat <chat>')).toBe(true);
    expect((helpData?.commands ?? []).includes('fleet status')).toBe(true);
    expect((helpData?.commands ?? []).includes('fleet assigned')).toBe(true);

    const stopResponse = await fetch(`${baseUrl}/v1/fleet/requests`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: 'stop_chat', payload: { to: 'child-one', chat: 'default' } }),
    });
    const stopData: any = await stopResponse.json();
    expect(stopResponse.status).toBe(202);
    expect(stopData?.request?.type).toBe('stop_chat');
    expect(stopData?.request?.state).toBe('queued');
  });

  test('persists relationship snapshots in local fleet capabilities', async () => {
    const port = await allocatePort();
    const dataDir = path.join(tempRoot, `daemon-${port}`);
    fs.mkdirSync(dataDir, { recursive: true });
    const token = 'daemon-token';
    const daemon = Bun.spawn([process.execPath, daemonEntry, '--host', '127.0.0.1', '--port', String(port), '--data-dir', dataDir, '--token', token], {
      cwd: process.cwd(),
      stdout: 'ignore',
      stderr: 'pipe',
    });
    processes.push(daemon);
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, token, daemon);

    const policyResponse = await fetch(`${baseUrl}/v1/fleet/policy`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        enabled: true,
        actor: { id: 'alpha', name: 'Alpha' },
        relationships: {
          children: [{ id: 'bravo', name: 'Bravo' }],
          assigned: [{ id: 'charlie', name: 'Charlie' }],
        },
        capabilities: ['drone:create', 'drone:message:send', 'drone:message:read'],
        readScopes: ['children', 'assigned', 'self'],
        sendScopes: ['children', 'assigned'],
      }),
    });
    expect(policyResponse.status).toBe(200);

    const capabilitiesResponse = await fetch(`${baseUrl}/v1/fleet/capabilities`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const capabilitiesData: any = await capabilitiesResponse.json();
    expect(capabilitiesResponse.status).toBe(200);
    expect(capabilitiesData?.actor).toEqual({ id: 'alpha', name: 'Alpha' });
    expect(capabilitiesData?.relationships?.children).toEqual([{ id: 'bravo', name: 'Bravo' }]);
    expect(capabilitiesData?.relationships?.assigned).toEqual([{ id: 'charlie', name: 'Charlie' }]);
  });

  test('persists scoped task snapshots for local listing and create queueing', async () => {
    const port = await allocatePort();
    const dataDir = path.join(tempRoot, `daemon-${port}`);
    fs.mkdirSync(dataDir, { recursive: true });
    const token = 'daemon-token';
    const daemon = Bun.spawn([process.execPath, daemonEntry, '--host', '127.0.0.1', '--port', String(port), '--data-dir', dataDir, '--token', token], {
      cwd: process.cwd(),
      stdout: 'ignore',
      stderr: 'pipe',
    });
    processes.push(daemon);
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, token, daemon);

    const setResponse = await fetch(`${baseUrl}/v1/tasks/state`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        enabled: true,
        actor: { id: 'drone-alpha', name: 'Drone Alpha' },
        playbook: { id: 'bug-sweep', label: 'Bug sweep' },
        repoPath: '/tmp/repo-under-test',
        taskTypes: [
          { id: 'bug', label: 'Bug', active: true },
          { id: 'feature', label: 'Feature', active: true },
        ],
        tasks: [
          {
            id: 'task-1',
            title: 'Crash when saving an empty draft',
            description: 'Repro: open the editor and press save immediately.',
            typeId: 'bug',
            typeLabel: 'Bug',
            laneId: 'lane-1',
            laneTitle: 'To do',
            messageId: 'message-1',
            createdAt: '2026-03-24T00:00:00.000Z',
            updatedAt: '2026-03-24T00:00:00.000Z',
            droneId: 'drone-alpha',
            droneName: 'Drone Alpha',
          },
        ],
      }),
    });
    expect(setResponse.status).toBe(200);

    const listResponse = await fetch(`${baseUrl}/v1/tasks`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const listData: any = await listResponse.json();
    expect(listResponse.status).toBe(200);
    expect(listData?.playbook).toEqual({ id: 'bug-sweep', label: 'Bug sweep' });
    expect(listData?.repoPath).toBe('/tmp/repo-under-test');
    expect(listData?.tasks).toMatchObject([
      {
        id: 'task-1',
        title: 'Crash when saving an empty draft',
        typeId: 'bug',
        messageId: 'message-1',
      },
    ]);

    const searchResponse = await fetch(`${baseUrl}/v1/tasks/search?q=${encodeURIComponent('save draft crash')}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const searchData: any = await searchResponse.json();
    expect(searchResponse.status).toBe(200);
    expect(searchData?.tasks?.[0]).toMatchObject({
      id: 'task-1',
      title: 'Crash when saving an empty draft',
      typeId: 'bug',
    });

    const getResponse = await fetch(`${baseUrl}/v1/tasks/${encodeURIComponent('task-1')}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const getData: any = await getResponse.json();
    expect(getResponse.status).toBe(200);
    expect(getData?.task).toMatchObject({
      id: 'task-1',
      title: 'Crash when saving an empty draft',
      typeId: 'bug',
      messageId: 'message-1',
    });

    const deleteResponse = await fetch(`${baseUrl}/v1/tasks/${encodeURIComponent('task-1')}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    const deleteData: any = await deleteResponse.json();
    expect(deleteResponse.status).toBe(202);
    expect(deleteData?.queued).toBe(true);
    expect(deleteData?.request?.taskId).toBe('task-1');

    const pendingDeleteResponse = await fetch(`${baseUrl}/v1/tasks/pending-deletes`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const pendingDeleteData: any = await pendingDeleteResponse.json();
    expect(pendingDeleteResponse.status).toBe(200);
    expect(pendingDeleteData?.requests).toMatchObject([{ taskId: 'task-1' }]);

    const pendingDeleteRequestId = String(pendingDeleteData?.requests?.[0]?.id ?? '');
    expect(pendingDeleteRequestId).toBeTruthy();

    const ackDeleteResponse = await fetch(`${baseUrl}/v1/tasks/pending-deletes/${encodeURIComponent(pendingDeleteRequestId)}/ack`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    const ackDeleteData: any = await ackDeleteResponse.json();
    expect(ackDeleteResponse.status).toBe(200);
    expect(ackDeleteData?.removed).toBe(true);

    const createResponse = await fetch(`${baseUrl}/v1/tasks`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Toolbar button overlaps on mobile',
        typeId: 'bug',
        description: 'Seen at 390px width in Safari.',
      }),
    });
    const createData: any = await createResponse.json();
    expect(createResponse.status).toBe(202);
    expect(createData?.queued).toBe(true);

    const pendingResponse = await fetch(`${baseUrl}/v1/tasks/pending-creates`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const pendingData: any = await pendingResponse.json();
    expect(pendingResponse.status).toBe(200);
    expect(pendingData?.requests).toMatchObject([{ title: 'Toolbar button overlaps on mobile', typeId: 'bug' }]);
  });
});
