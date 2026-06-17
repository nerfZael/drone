import type { FleetRequestState, FleetRequestType } from '../fleet/contracts';

export type DroneClient = {
  baseUrl: string;
  token: string;
};

function resolveTimeoutMs(): number {
  const raw = process.env.DRONE_HTTP_TIMEOUT_MS;
  if (!raw) return 5000;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 5000;
}

async function req(client: DroneClient, method: string, pathname: string, body?: any): Promise<any> {
  const url = new URL(pathname, client.baseUrl).toString();
  const timeoutMs = resolveTimeoutMs();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${client.token}`,
        'content-type': body ? 'application/json' : 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`request timeout after ${timeoutMs}ms: ${method} ${pathname}`);
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }
  if (!res.ok) {
    const msg = json?.error ?? text ?? `${method} ${pathname} failed`;
    throw new Error(msg);
  }
  return json;
}

export async function health(client: DroneClient) {
  return await req(client, 'GET', '/v1/health');
}

export async function status(client: DroneClient) {
  return await req(client, 'GET', '/v1/status');
}

export async function procStart(
  client: DroneClient,
  payload: { cmd: string; args?: string[]; cwd?: string; env?: Record<string, string>; session?: string; force?: boolean; terminal?: boolean }
) {
  return await req(client, 'POST', '/v1/process/start', payload);
}

export async function procStop(client: DroneClient, payload: { session?: string } = {}) {
  return await req(client, 'POST', '/v1/process/stop', payload);
}

export async function sendInput(client: DroneClient, payload: { text: string; enter?: boolean; session?: string }) {
  return await req(client, 'POST', '/v1/input', payload);
}

export async function sendKeys(client: DroneClient, payload: { keys: string[]; session?: string }) {
  return await req(client, 'POST', '/v1/keys', payload);
}

export async function readOutput(client: DroneClient, payload: { since?: number; max?: number } = {}) {
  const since = payload.since ?? 0;
  const max = payload.max ?? 65536;
  return await req(client, 'GET', `/v1/output?since=${encodeURIComponent(String(since))}&max=${encodeURIComponent(String(max))}`);
}

export async function promptEnqueue(
  client: DroneClient,
  payload: { id: string; kind?: string; cmd: string; args?: string[]; cwd?: string; env?: Record<string, string>; prompt?: string }
) {
  return await req(client, 'POST', '/v1/prompts/enqueue', payload);
}

export async function promptGet(client: DroneClient, id: string) {
  return await req(client, 'GET', `/v1/prompts/${encodeURIComponent(id)}`);
}

export async function promptCancel(client: DroneClient, id: string) {
  return await req(client, 'POST', `/v1/prompts/${encodeURIComponent(id)}/cancel`);
}

export async function fleetCapabilities(client: DroneClient) {
  return await req(client, 'GET', '/v1/fleet/capabilities');
}

export async function fleetHelp(client: DroneClient) {
  return await req(client, 'GET', '/v1/fleet/help');
}

export async function fleetPolicySet(
  client: DroneClient,
  payload: {
    apiVersion?: string;
    enabled: boolean;
    actor: { id?: string | null; name?: string | null };
    relationships?: {
      children?: Array<{ id?: string | null; name?: string | null }>;
      assigned?: Array<{ id?: string | null; name?: string | null }>;
    };
    capabilities: string[];
    readScopes?: string[];
    sendScopes?: string[];
    limits?: Record<string, number>;
  },
) {
  return await req(client, 'POST', '/v1/fleet/policy', payload);
}

export async function fleetRequestCreate(
  client: DroneClient,
  payload: {
    idempotencyKey?: string;
    type: FleetRequestType;
    payload: Record<string, unknown>;
  },
) {
  return await req(client, 'POST', '/v1/fleet/requests', payload);
}

export async function fleetRequestList(client: DroneClient, input?: { state?: FleetRequestState }) {
  const qs = input?.state ? `?state=${encodeURIComponent(input.state)}` : '';
  return await req(client, 'GET', `/v1/fleet/requests${qs}`);
}

export async function fleetRequestGet(client: DroneClient, id: string) {
  return await req(client, 'GET', `/v1/fleet/requests/${encodeURIComponent(id)}`);
}

export async function fleetRequestClaim(client: DroneClient, id: string) {
  return await req(client, 'POST', `/v1/fleet/requests/${encodeURIComponent(id)}/claim`);
}

export async function fleetRequestResolve(
  client: DroneClient,
  id: string,
  payload: { state: 'done' | 'failed'; result?: unknown; error?: string },
) {
  return await req(client, 'POST', `/v1/fleet/requests/${encodeURIComponent(id)}/resolve`, payload);
}

export async function tasksStateSet(
  client: DroneClient,
  payload: {
    enabled: boolean;
    actor?: { id?: string | null; name?: string | null };
    playbook?: { id?: string | null; label?: string | null } | null;
    repoPath?: string | null;
    taskTypes?: Array<{
      id?: string;
      label?: string;
      active?: boolean;
    }>;
    tasks?: Array<{
      id?: string;
      title?: string;
      description?: string;
      typeId?: string;
      typeLabel?: string;
      laneId?: string;
      laneTitle?: string;
      createdAt?: string;
      updatedAt?: string;
      droneId?: string;
      droneName?: string;
      playbookId?: string;
      playbookLabel?: string;
      chatName?: string;
      prompt?: string;
      promptId?: string;
      messageId?: string;
    }>;
    updatedAt?: string;
  },
) {
  return await req(client, 'POST', '/v1/tasks/state', payload);
}

export async function tasksList(client: DroneClient, input?: { typeIds?: string[] }) {
  const typeIds = Array.isArray(input?.typeIds) ? input.typeIds.map(String).map((item) => item.trim()).filter(Boolean) : [];
  const qs =
    typeIds.length > 0
      ? `?${typeIds.map((item) => `type=${encodeURIComponent(item)}`).join('&')}`
      : '';
  return await req(client, 'GET', `/v1/tasks${qs}`);
}

export async function tasksSearch(client: DroneClient, input: { query: string; typeIds?: string[] }) {
  const query = String(input?.query ?? '').trim();
  const typeIds = Array.isArray(input?.typeIds) ? input.typeIds.map(String).map((item) => item.trim()).filter(Boolean) : [];
  const params = [`q=${encodeURIComponent(query)}`, ...typeIds.map((item) => `type=${encodeURIComponent(item)}`)];
  return await req(client, 'GET', `/v1/tasks/search?${params.join('&')}`);
}

export async function tasksGet(client: DroneClient, taskId: string) {
  const normalized = String(taskId ?? '').trim();
  return await req(client, 'GET', `/v1/tasks/${encodeURIComponent(normalized)}`);
}

export async function tasksDelete(client: DroneClient, taskId: string) {
  const normalized = String(taskId ?? '').trim();
  return await req(client, 'DELETE', `/v1/tasks/${encodeURIComponent(normalized)}`);
}

export async function tasksCreate(
  client: DroneClient,
  payload: {
    title: string;
    typeId: string;
    description?: string;
  },
) {
  return await req(client, 'POST', '/v1/tasks', payload);
}

export async function tasksPendingCreateList(client: DroneClient) {
  return await req(client, 'GET', '/v1/tasks/pending-creates');
}

export async function tasksPendingCreateAck(
  client: DroneClient,
  id: string,
  payload?: { taskId?: string | null },
) {
  return await req(client, 'POST', `/v1/tasks/pending-creates/${encodeURIComponent(id)}/ack`, payload ?? {});
}

export async function tasksPendingDeleteList(client: DroneClient) {
  return await req(client, 'GET', '/v1/tasks/pending-deletes');
}

export async function tasksPendingDeleteAck(
  client: DroneClient,
  id: string,
  payload?: { taskId?: string | null },
) {
  return await req(client, 'POST', `/v1/tasks/pending-deletes/${encodeURIComponent(id)}/ack`, payload ?? {});
}

export async function terminalInput(client: DroneClient, payload: { session: string; data: string }) {
  return await req(client, 'POST', '/v1/terminal/input', payload);
}

export async function terminalOutput(
  client: DroneClient,
  payload: { session: string; since?: number; max?: number; view?: 'log' | 'screen'; tail?: number },
) {
  const since = payload.since ?? 0;
  const max = payload.max ?? 65536;
  const view = payload.view === 'screen' ? 'screen' : 'log';
  const tail = payload.tail ?? 200;
  return await req(
    client,
    'GET',
    `/v1/terminal/output?session=${encodeURIComponent(payload.session)}&since=${encodeURIComponent(String(since))}&max=${encodeURIComponent(String(max))}&view=${encodeURIComponent(view)}&tail=${encodeURIComponent(String(tail))}`,
  );
}

export async function terminalPrompt(client: DroneClient, payload: { session: string }) {
  return await req(client, 'GET', `/v1/terminal/prompt?session=${encodeURIComponent(payload.session)}`);
}
