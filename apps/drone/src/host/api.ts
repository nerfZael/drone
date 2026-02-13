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
  payload: { cmd: string; args?: string[]; cwd?: string; env?: Record<string, string>; session?: string; force?: boolean }
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
  payload: { id: string; kind?: string; cmd: string; args?: string[]; cwd?: string; env?: Record<string, string> }
) {
  return await req(client, 'POST', '/v1/prompts/enqueue', payload);
}

export async function promptGet(client: DroneClient, id: string) {
  return await req(client, 'GET', `/v1/prompts/${encodeURIComponent(id)}`);
}

export async function terminalInput(client: DroneClient, payload: { session: string; data: string }) {
  return await req(client, 'POST', '/v1/terminal/input', payload);
}

export async function terminalOutput(client: DroneClient, payload: { session: string; since?: number; max?: number }) {
  const since = payload.since ?? 0;
  const max = payload.max ?? 65536;
  return await req(
    client,
    'GET',
    `/v1/terminal/output?session=${encodeURIComponent(payload.session)}&since=${encodeURIComponent(String(since))}&max=${encodeURIComponent(String(max))}`,
  );
}

export async function terminalPrompt(client: DroneClient, payload: { session: string }) {
  return await req(client, 'GET', `/v1/terminal/prompt?session=${encodeURIComponent(payload.session)}`);
}

